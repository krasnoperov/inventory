import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

test('space page overlay chrome stays flat', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 720 });
  await mountComponent(page, 'SpacePageOverlayChrome', {});

  const chatPanel = page.getByRole('complementary', { name: 'Chat panel preview' });
  await expect(chatPanel).toBeVisible();
  await expect(chatPanel).toHaveCSS('box-shadow', 'none');

  const firstJobCard = page.locator('[class*="jobCard"]').first();
  await expect(firstJobCard).toBeVisible();
  await expect(firstJobCard).toHaveCSS('box-shadow', 'none');

  await screenshot(page, 'space-page-flat-overlay-chrome', { fullPage: true });
});
