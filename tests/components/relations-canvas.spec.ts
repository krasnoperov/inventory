import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const imageSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#dde5ff"/><path d="M20 68 42 42l14 16 10-12 12 22z" fill="#6f6ce8"/></svg>';

async function mockImages(page: Page) {
  await page.route('**/api/images/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: imageSvg,
  }));
}

test('relations canvas dock uses shared controls for graph options', async ({ page }) => {
  await mockImages(page);
  await page.setViewportSize({ width: 980, height: 760 });
  await mountComponent(page, 'RelationsCanvas', {});

  await expect(page.getByRole('toolbar', { name: 'Relations canvas controls' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Story' })).toBeVisible();

  await page.getByRole('button', { name: 'Graph' }).click();
  await expect(page.getByRole('button', { name: 'Clusters' })).toBeVisible();

  await page.getByRole('button', { name: 'Flow' }).click();
  await page.getByRole('button', { name: 'Type' }).click();
  await page.getByRole('button', { name: /Relation/ }).click();

  await screenshot(page, 'relations-canvas-shared-dock', { fullPage: true });

  await expect(page.getByRole('button', { name: 'Flow' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Type' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Relation/ })).toBeVisible();
});
