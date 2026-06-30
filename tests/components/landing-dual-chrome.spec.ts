import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

test('landing dual seam chrome stays flat', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 560 });
  await mountComponent(page, 'LandingDualChrome', {});

  const pill = page.getByText('space://forest-tactics');
  await expect(pill).toBeVisible();
  await expect(pill).toHaveCSS('box-shadow', 'none');
  await expect(pill).toHaveCSS('border-top-width', '1px');

  await screenshot(page, 'landing-dual-flat-seam-chrome', { fullPage: true });
});
