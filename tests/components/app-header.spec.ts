import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

test('app header uses flat shared chrome', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 160 });
  await mountComponent(page, 'AppHeaderPreview', {});

  const header = page.locator('nav').first();
  await expect(header).toBeVisible();
  await expect(header).toHaveCSS('box-shadow', 'none');
  await expect(header).toHaveCSS('border-bottom-width', '1px');
  const brandBox = await page.getByText('MakeFX').boundingBox();
  const titleBox = await page.getByText('Crystal Gate').boundingBox();
  expect(brandBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  if (!brandBox || !titleBox) {
    throw new Error('header slot bounds missing');
  }
  expect(titleBox.x - (brandBox.x + brandBox.width)).toBeGreaterThanOrEqual(8);
  await screenshot(page, 'app-header-flat-chrome', { fullPage: true });
});
