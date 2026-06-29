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
