import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

test('landing card hover chrome stays flat', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 720 });
  await mountComponent(page, 'LandingCardHoverChrome', {});

  const featureCard = page.locator('[class*="featureItem"]').first();
  await featureCard.hover();
  await expect(featureCard).toHaveCSS('transform', 'none');
  await expect(featureCard).toHaveCSS('box-shadow', 'none');

  const spaceCard = page.getByRole('link', { name: /Market scene board/ });
  await spaceCard.hover();
  await expect(spaceCard).toHaveCSS('transform', 'none');
  await expect(spaceCard).toHaveCSS('box-shadow', 'none');

  await screenshot(page, 'landing-card-flat-hover-chrome', { fullPage: true });
});
