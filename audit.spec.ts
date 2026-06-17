import { test, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';

// Inventory Forge — page audit.
//
// Public shots (@shots) capture unauthenticated pages. Auth-gated routes are
// also captured here as-is (redirect / login prompt / empty state) — useful too.
//
// Authenticated shots (@shots-authed) capture private pages with a real session.
// They only run when auth is requested, and mint a short-lived session token via
// scripts/auth/mint-session.mjs (same capability used for curl / Playwright):
//
//   # against a deployed env (requires `pnpm cli login --env stage` first):
//   AUDIT_AUTH=1 AUDIT_BASE_URL=https://inventory-stage.krasnoperov.me \
//     pnpm exec playwright test -c playwright.audit.config.ts --grep @shots-authed
//
//   # against local (no login needed — reuse the dev-auth bypass token):
//   AUDIT_AUTH_TOKEN=inventory-dev-token AUDIT_BASE_URL=http://localhost:3001 \
//     pnpm exec playwright test -c playwright.audit.config.ts --grep @shots-authed

type Shot = { name: string; path: string; waitFor?: string };

const SHOTS: Shot[] = [
  { name: 'landing', path: '/' },
  { name: 'login', path: '/login' },
  { name: 'dashboard-unauth', path: '/dashboard' },
  { name: 'profile-unauth', path: '/profile' },
  { name: 'oauth-approve-empty', path: '/oauth/approve' },
  { name: 'space-unknown', path: '/spaces/does-not-exist' },
  { name: 'asset-unknown', path: '/spaces/does-not-exist/assets/nope' },
  { name: 'unknown-route', path: '/some/nonexistent/path' },
];

// Private pages worth capturing once a real session is injected.
const AUTHED_SHOTS: Shot[] = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'profile', path: '/profile' },
  { name: 'spaces', path: '/spaces' },
];

// ─── Auth injection ──────────────────────────────────────────────────────────

function auditAuthRequested(): boolean {
  return Boolean(
    process.env.AUDIT_AUTH === '1' ||
      process.env.AUDIT_AUTH_ENV ||
      process.env.AUDIT_AUTH_TOKEN ||
      process.argv.some((arg) => arg.includes('@shots-authed')),
  );
}

function inferAuditAuthEnv(baseUrl: URL): string {
  if (process.env.AUDIT_AUTH_ENV) return process.env.AUDIT_AUTH_ENV;
  if (baseUrl.hostname === 'inventory.krasnoperov.me') return 'production';
  if (baseUrl.hostname === 'inventory-stage.krasnoperov.me' || baseUrl.hostname.includes('stage')) {
    return 'stage';
  }
  return 'local';
}

function cliLoginCommand(env: string): string {
  return env === 'local' ? 'pnpm cli login --local' : `pnpm cli login --env ${env}`;
}

function tokenFromStorageState(storageJson: string): string | null {
  const state = JSON.parse(storageJson) as { cookies?: Array<{ name?: string; value?: string }> };
  return state.cookies?.find((cookie) => cookie.name === 'auth_token')?.value ?? null;
}

function baseUrlFromInfo(info: TestInfo): URL {
  const configured = (info.project.use as { baseURL?: string }).baseURL ?? 'http://localhost:3001';
  return new URL(configured);
}

let cachedAuditAuthToken: string | null | undefined;

function resolveAuditAuthToken(info: TestInfo): string | null {
  // Direct override — also the local shortcut: AUDIT_AUTH_TOKEN=inventory-dev-token.
  if (process.env.AUDIT_AUTH_TOKEN) return process.env.AUDIT_AUTH_TOKEN;
  if (!auditAuthRequested()) return null;
  if (cachedAuditAuthToken !== undefined) return cachedAuditAuthToken;

  const baseUrl = baseUrlFromInfo(info);
  const env = inferAuditAuthEnv(baseUrl);
  try {
    const storage = execFileSync(
      process.execPath,
      ['scripts/auth/mint-session.mjs', '--env', env, '--base-url', baseUrl.origin, '--format', 'storage'],
      { cwd: process.cwd(), encoding: 'utf8', env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    cachedAuditAuthToken = tokenFromStorageState(storage);
  } catch (error) {
    cachedAuditAuthToken = null;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not mint audit auth storageState. Run ${cliLoginCommand(env)} first, ` +
        `or set AUDIT_AUTH_TOKEN (locally: inventory-dev-token). ${detail}`,
    );
  }
  if (!cachedAuditAuthToken) {
    throw new Error(`Minted storageState had no auth_token. Run ${cliLoginCommand(env)} first.`);
  }
  return cachedAuditAuthToken;
}

async function injectAuth(page: Page, info: TestInfo): Promise<void> {
  const token = resolveAuditAuthToken(info);
  if (!token) return;
  const baseUrl = baseUrlFromInfo(info);
  await page.context().addCookies([
    {
      name: 'auth_token',
      value: token,
      domain: baseUrl.hostname,
      path: '/',
      httpOnly: true,
      secure: baseUrl.protocol === 'https:',
      sameSite: 'Lax',
    },
  ]);
}

// ─── Capture ───────────────────────────────────────────────────────────────

async function captureShot(page: Page, info: TestInfo, shot: Shot): Promise<void> {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  // Track stylesheet (and other asset) requests + their HTTP status.
  const cssResponses: string[] = [];
  page.on('response', (r) => {
    const u = r.url();
    if (/\.css(\?|$)/.test(u) || r.request().resourceType() === 'stylesheet') {
      cssResponses.push(`${r.status()} ${u}`);
    }
  });

  const resp = await page.goto(shot.path, { waitUntil: 'networkidle' });
  if (shot.waitFor) await page.waitForSelector(shot.waitFor);

  // Inspect what CSS actually applied in the document.
  const cssState = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(
      (l) => (l as HTMLLinkElement).href,
    );
    const styleTags = document.querySelectorAll('style').length;
    let totalRules = 0;
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        totalRules += sheet.cssRules.length;
      } catch {
        totalRules += -1; // cross-origin / blocked
      }
    }
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    return {
      linkCount: links.length,
      links,
      styleTagCount: styleTags,
      styleSheetCount: document.styleSheets.length,
      totalRules,
      bodyBg,
    };
  });

  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const outDir = path.resolve('audit-out');
  await fs.mkdir(outDir, { recursive: true });
  const base = `${shot.name}-${info.project.name}`;
  await fs.writeFile(path.join(outDir, `${base}.png`), await page.screenshot({ fullPage: true }));
  await fs.writeFile(
    path.join(outDir, `${base}.meta.txt`),
    [
      `URL: ${page.url()}`,
      `Status: ${resp?.status() ?? 'n/a'}`,
      `Title: ${await page.title()}`,
      ``,
      `--- CSS diagnostics ---`,
      `<link rel=stylesheet> in DOM: ${cssState.linkCount}`,
      ...cssState.links.map((l) => `  link: ${l}`),
      `<style> tags: ${cssState.styleTagCount}`,
      `document.styleSheets: ${cssState.styleSheetCount}`,
      `total CSS rules (sum; -1 per blocked sheet): ${cssState.totalRules}`,
      `computed body background-color: ${cssState.bodyBg}`,
      `stylesheet responses (${cssResponses.length}):`,
      ...cssResponses.map((e) => `  - ${e}`),
      ``,
      `Console errors (${consoleErrors.length}):`,
      ...consoleErrors.map((e) => `  - ${e}`),
      `Page errors (${pageErrors.length}):`,
      ...pageErrors.map((e) => `  - ${e}`),
    ].join('\n'),
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('@shots', () => {
  for (const shot of SHOTS) {
    test(`shot: ${shot.name}`, async ({ page }, info) => {
      await captureShot(page, info, shot);
    });
  }
});

test.describe('@shots-authed', () => {
  test.skip(() => !auditAuthRequested(), 'auth not requested (set AUDIT_AUTH=1 or AUDIT_AUTH_TOKEN)');

  for (const shot of AUTHED_SHOTS) {
    test(`authed shot: ${shot.name}`, async ({ page }, info) => {
      await injectAuth(page, info);
      await captureShot(page, info, shot);
    });
  }
});
