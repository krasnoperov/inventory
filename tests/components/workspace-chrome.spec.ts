import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

test('workspace chrome uses flat shared header chrome', async ({ page }) => {
  await page.setViewportSize({ width: 860, height: 180 });
  await mountComponent(page, 'WorkspaceChromePreview', {});

  const chrome = page.locator('header').first();
  await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible();
  await expect(chrome).toHaveCSS('box-shadow', 'none');
  await expect(chrome).toHaveCSS('border-bottom-width', '1px');
  await screenshot(page, 'workspace-chrome-flat-header', { fullPage: true });
});
