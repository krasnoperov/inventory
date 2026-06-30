import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

test('space page overlay chrome stays flat', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 720 });
  await mountComponent(page, 'SpacePageOverlayChrome', {});

  const firstJobCard = page.locator('[class*="jobCard"]').first();
  await expect(firstJobCard).toBeVisible();
  await expect(firstJobCard).toHaveCSS('box-shadow', 'none');
  await expect(firstJobCard).toHaveCSS('transform', 'none');
  await expect(firstJobCard).not.toHaveCSS('animation-name', /slideIn/);
  await expect(page.getByLabel('Generating job')).toBeVisible();
  await expect(page.getByLabel('Done job')).toBeVisible();
  await expect(firstJobCard).not.toContainText('↻');
  await expect(page.locator('[class*="jobCard"]').nth(1)).not.toContainText('✓');

  await screenshot(page, 'space-page-flat-overlay-chrome', { fullPage: true });
});
