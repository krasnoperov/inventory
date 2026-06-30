import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

test('landing create-space dialog uses shared name field', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 560 });
  await mountComponent(page, 'LandingCreateSpaceDialog', {
    isCreating: false,
    newSpaceName: 'Production board',
    onClose: '__record__:close',
    onNameChange: '__record__:name',
    onSubmit: '__record__:submit',
  });

  await expect(page.getByRole('heading', { name: 'Create New Space' })).toBeVisible();
  await expect(page.locator('[class*="modalOverlay"]')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('[class*="modalOverlay"]')).toHaveCSS('backdrop-filter', 'none');
  await expect(page.locator('[class*="_modal_"]').first()).toHaveCSS('box-shadow', 'none');
  await expect(page.getByLabel('Space Name *')).toBeFocused();
  await page.getByLabel('Space Name *').fill('Launch assets');
  await screenshot(page, 'landing-create-space-shared-field', { fullPage: true });
  await page.getByRole('button', { name: 'Create Space' }).click();

  const calls = await page.evaluate(() => window.__componentHarnessCalls ?? []);
  expect(calls).toEqual(expect.arrayContaining([
    'name:["Launch assets"]',
    'submit',
  ]));
});
