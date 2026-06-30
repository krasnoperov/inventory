import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

test('dashboard hover chrome stays flat', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 420 });
  await mountComponent(page, 'DashboardHoverChrome', {});

  const card = page.getByRole('link', { name: /Gameplay board/ });
  await card.hover();
  await expect(card).toHaveCSS('box-shadow', 'none');
  await expect(card).toHaveCSS('transform', 'none');

  const profile = page.getByRole('link', { name: 'Profile' });
  await profile.hover();
  await expect(profile).toHaveCSS('transform', 'none');

  await screenshot(page, 'dashboard-flat-hover-chrome', { fullPage: true });
});
