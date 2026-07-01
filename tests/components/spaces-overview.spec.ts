import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

test('spaces overview renders empty state with shared action chrome', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 520 });
  await mountComponent(page, 'SpacesOverview', { empty: true });

  await expect(page.getByRole('heading', { name: 'No spaces yet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Your First Space' })).toBeVisible();
  await screenshot(page, 'spaces-overview-empty');
});

test('spaces overview keeps space cards flat on hover', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 560 });
  await mountComponent(page, 'SpacesOverview', {});

  const spaceCard = page.getByRole('link', { name: /Market scene board/ });
  await expect(spaceCard).toBeVisible();
  await spaceCard.hover();
  await expect(spaceCard).toHaveCSS('transform', 'none');
  await expect(spaceCard).toHaveCSS('box-shadow', 'none');
  await screenshot(page, 'spaces-overview-list');
});
