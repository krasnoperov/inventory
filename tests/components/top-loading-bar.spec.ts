import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

test('top loading bar uses tokenized progress chrome', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 160 });
  await mountComponent(page, 'TopLoadingBar', { isLoading: true });

  const bar = page.locator('[class*="bar"]').first();
  await expect(bar).toBeVisible();
  await expect(bar).toHaveCSS('height', '4px');
  await expect
    .poll(() => bar.evaluate((node) => getComputedStyle(node).backgroundImage))
    .toContain('linear-gradient');
  await expect
    .poll(() => bar.evaluate((node) => getComputedStyle(node).boxShadow))
    .toBe('none');

  await screenshot(page, 'top-loading-bar-tokenized-progress', { fullPage: true });
});
