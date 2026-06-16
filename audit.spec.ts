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

      // Track stylesheet (and other asset) requests + their HTTP status.
      const cssResponses: string[] = [];
      page.on('response', (r) => {
        const u = r.url();
        if (/\.css(\?|$)/.test(u) || r.request().resourceType() === 'stylesheet') {
          cssResponses.push(`${r.status()} ${u}`);
        }
      });

      const resp = await page.goto(shotPath, { waitUntil: 'networkidle' });
      if (waitFor) await page.waitForSelector(waitFor);

      // Inspect what CSS actually applied in the document.
      const cssState = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(
          (l) => (l as HTMLLinkElement).href
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
        ].join('\n')
      );
    });
  }
});
