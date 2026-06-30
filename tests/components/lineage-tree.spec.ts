import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const imageSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#eef2ff"/><circle cx="48" cy="42" r="22" fill="#7c83db"/><path d="M20 78c7-18 49-18 56 0z" fill="#27305f"/></svg>';

async function mockImages(page: Page) {
  await page.route('**/api/images/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: imageSvg,
  }));
}

test('lineage tree uses shared controls for graph toggle and sever actions', async ({ page }) => {
  await mockImages(page);
  await page.setViewportSize({ width: 760, height: 640 });
  await mountComponent(page, 'LineageTree', { onSeverLineage: '__record__:severLineage' });

  await expect(page.getByRole('heading', { name: 'Lineage' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show Full Graph' })).toBeVisible();

  const severAction = page.getByRole('button', { name: 'Sever this lineage link' }).first();
  await expect(severAction).toBeVisible();
  await severAction.click();
  await expect.poll(() => page.evaluate(() => window.__componentHarnessCalls ?? [])).toContain('severLineage');

  await screenshot(page, 'lineage-tree-shared-controls');
});
