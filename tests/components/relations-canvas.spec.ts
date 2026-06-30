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

async function boxShadow(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((node) => getComputedStyle(node).boxShadow);
}

test('relations canvas dock uses shared controls for graph options', async ({ page }) => {
  await mockImages(page);
  await page.setViewportSize({ width: 980, height: 760 });
  await mountComponent(page, 'RelationsCanvas', {
    onAssetClick: '__record__:assetClick',
  });

  await expect(page.getByRole('toolbar', { name: 'Relations canvas controls' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Story' })).toBeVisible();

  await page.getByRole('button', { name: 'Graph' }).click();
  await expect(page.getByRole('button', { name: 'Clusters' })).toBeVisible();

  await page.getByRole('button', { name: 'Flow' }).click();
  await page.getByRole('button', { name: 'Type' }).click();
  await page.getByRole('button', { name: /Relation/ }).click();

  const heroName = page.getByRole('button', { name: 'Hero Character' }).first();
  await expect(heroName).toBeVisible();
  await expect(heroName).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await heroName.click();
  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toHaveLength(1);
  expect(calls[0].eventName).toBe('assetClick');
  expect((calls[0].args[0] as { id: string }).id).toBe('hero');

  await page.locator('.react-flow__controls-zoomin').click();
  await page.locator('.react-flow__controls-zoomin').click();
  await screenshot(page, 'relations-canvas-shared-dock', { fullPage: true });

  await expect(page.getByRole('button', { name: 'Flow' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Type' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Relation/ })).toBeVisible();
});

test('relations canvas focused chrome stays flat', async ({ page }) => {
  await mockImages(page);
  await page.setViewportSize({ width: 980, height: 760 });
  await mountComponent(page, 'RelationsCanvas', {
    onAssetClick: '__record__:assetClick',
  });

  const specimen = page.locator('[class*="specimen"]').first();
  await expect(specimen).toBeVisible();
  await specimen.click({ position: { x: 12, y: 12 } });
  await expect(page.getByText('Lineage of')).toBeVisible();

  await expect.poll(() => boxShadow(page, '[class*="specimen"][class*="focused"]')).not.toContain('24px');
  await screenshot(page, 'relations-canvas-flat-focused-chrome', { fullPage: true });
});
