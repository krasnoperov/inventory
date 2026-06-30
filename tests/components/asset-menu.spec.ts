import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

async function resolvedBackground(page: import('@playwright/test').Page, value: string) {
  return page.evaluate((backgroundValue) => {
    const probe = document.createElement('div');
    probe.style.background = backgroundValue;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return resolved;
  }, value);
}

async function resolvedShadow(page: import('@playwright/test').Page, value: string) {
  return page.evaluate((shadowValue) => {
    const probe = document.createElement('div');
    probe.style.boxShadow = shadowValue;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).boxShadow;
    probe.remove();
    return resolved;
  }, value);
}

test('asset context menu actions use shared button styling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 260 });
  await mountComponent(page, 'AssetMenu', {
    asset: {
      id: 'asset-1',
      name: 'Crystal Gate',
      type: 'prop',
      media_kind: 'image',
      tags: '',
      parent_asset_id: null,
      active_variant_id: 'variant-1',
      created_by: 'user-1',
      created_at: 1_700_000_000_000,
      updated_at: 1_700_000_000_000,
    },
    position: { x: 24, y: 24 },
    onClose: '__record__:close',
    onRename: '__record__:rename',
    onCreateRelation: '__record__:relation',
    onDelete: '__record__:delete',
  });

  await expect(page.locator('[class*="menu"]').first()).toHaveCSS(
    'box-shadow',
    await resolvedShadow(page, 'var(--shadow-modal)'),
  );
  await expect(page.getByRole('button', { name: 'Rename' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Relation' })).toBeVisible();
  const deleteAction = page.getByRole('button', { name: 'Delete Asset' });
  await expect(deleteAction).toBeVisible();
  await deleteAction.hover();
  await expect(deleteAction).toHaveCSS(
    'background-color',
    await resolvedBackground(page, 'var(--color-danger-bg)'),
  );
  await screenshot(page, 'asset-menu-shared-buttons', { fullPage: true });

  await page.getByRole('button', { name: 'Rename' }).click();
  await expect
    .poll(() => page.evaluate(() => window.__componentHarnessCalls ?? []))
    .toEqual(['rename', 'close']);
});
