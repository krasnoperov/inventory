import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

test('dashboard create-space dialog uses shared name field', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 560 });
  await mountComponent(page, 'CreateSpaceDialog', {
    isCreating: false,
    newSpaceName: 'Gameplay ideas',
    onClose: '__record__:close',
    onNameChange: '__record__:name',
    onSubmit: '__record__:submit',
  });

  await expect(page.getByRole('heading', { name: 'Create New Space' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Create New Space' })).toBeVisible();
  await expect(page.locator('[class*="modalOverlay"]')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('[class*="modalOverlay"]')).toHaveCSS('backdrop-filter', 'none');
  await expect(page.locator('[class*="_modal_"]').first()).toHaveCSS('box-shadow', 'none');
  await expect(page.locator('[class*="_modal_"]').first()).toHaveCSS('border-radius', '8px');
  await expect(page.getByRole('button', { name: 'Close' })).toHaveCSS('width', '24px');
  await expect(page.getByRole('button', { name: 'Close' })).toHaveCSS('min-height', '24px');
  await expect(page.getByLabel('Space Name *')).toBeFocused();
  await page.getByLabel('Space Name *').fill('Gameplay board');
  await screenshot(page, 'dashboard-create-space-shared-field', { fullPage: true });
  await page.getByRole('button', { name: 'Create Space' }).click();

  const calls = await page.evaluate(() => window.__componentHarnessCalls ?? []);
  expect(calls).toEqual(expect.arrayContaining([
    'name:["Gameplay board"]',
    'submit',
  ]));
});

test('dashboard create-space dialog fits compact mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await mountComponent(page, 'CreateSpaceDialog', {
    isCreating: false,
    newSpaceName: 'Mobile ideas',
    onClose: '__record__:close',
    onNameChange: '__record__:name',
    onSubmit: '__record__:submit',
  });

  const metrics = await page.getByRole('dialog', { name: 'Create New Space' }).evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width, viewport: window.innerWidth };
  });
  expect(metrics.left).toBeGreaterThanOrEqual(16);
  expect(metrics.right).toBeLessThanOrEqual(metrics.viewport - 16);
  const cancelWidth = await page.getByRole('button', { name: 'Cancel' }).evaluate((button) => {
    return button.getBoundingClientRect().width;
  });
  expect(cancelWidth).toBeGreaterThanOrEqual(metrics.width - 32);
  expect(cancelWidth).toBeLessThanOrEqual(metrics.width);
});
