import { test } from '@playwright/test';

// Inventory Forge — unauthenticated page audit.
// Auth-gated routes (/dashboard, /profile, /spaces/*) are captured as-is
// (redirect / login prompt / empty state) — that's useful too.
const SHOTS: { name: string; path: string; waitFor?: string }[] = [
  { name: 'landing', path: '/' },
  { name: 'login', path: '/login' },
  { name: 'dashboard-unauth', path: '/dashboard' },
  { name: 'profile-unauth', path: '/profile' },
  { name: 'oauth-approve-empty', path: '/oauth/approve' },
  { name: 'space-unknown', path: '/spaces/does-not-exist' },
  { name: 'asset-unknown', path: '/spaces/does-not-exist/assets/nope' },
  { name: 'unknown-route', path: '/some/nonexistent/path' },
];

test.describe('@shots', () => {
  for (const { name, path: shotPath, waitFor } of SHOTS) {
    test(`shot: ${name}`, async ({ page }, info) => {
      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      const resp = await page.goto(shotPath, { waitUntil: 'networkidle' });
      if (waitFor) await page.waitForSelector(waitFor);

      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const outDir = path.resolve('audit-out');
      await fs.mkdir(outDir, { recursive: true });
      const base = `${name}-${info.project.name}`;
      await fs.writeFile(
        path.join(outDir, `${base}.png`),
        await page.screenshot({ fullPage: true })
      );
      await fs.writeFile(
        path.join(outDir, `${base}.meta.txt`),
        [
          `URL: ${page.url()}`,
          `Status: ${resp?.status() ?? 'n/a'}`,
          `Title: ${await page.title()}`,
          `Console errors (${consoleErrors.length}):`,
          ...consoleErrors.map((e) => `  - ${e}`),
          `Page errors (${pageErrors.length}):`,
          ...pageErrors.map((e) => `  - ${e}`),
        ].join('\n')
      );
    });
  }
});
