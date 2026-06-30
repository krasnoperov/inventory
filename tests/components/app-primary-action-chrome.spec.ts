import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

test('app page primary actions stay flat', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 360 });
  await mountComponent(page, 'AppPrimaryActionChrome', {});

  for (const name of ['Dashboard primary', 'Space primary', 'Production primary', 'Asset primary']) {
    const action = page.getByRole('link', { name });
    await expect(action).toBeVisible();
    await expect(action).toHaveCSS('box-shadow', 'none');
  }

  await screenshot(page, 'app-primary-flat-action-chrome', { fullPage: true });
});
