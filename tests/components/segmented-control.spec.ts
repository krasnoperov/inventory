import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

test('segmented control uses shared compact radio chrome', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 160 });
  await mountComponent(page, 'SegmentedControl', {});

  const group = page.getByRole('radiogroup', { name: 'Preview mode' });
  await expect(group).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Story' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: 'Graph' })).toHaveAttribute('aria-checked', 'false');
  await expect(group).toHaveCSS('box-shadow', 'none');
  await screenshot(page, 'segmented-control-shared-chrome', { fullPage: true });
});
