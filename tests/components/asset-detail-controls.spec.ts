import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const baseTime = 1_700_000_000_000;

const collections = [
  collection('cast', 'Cast', 'cast'),
  collection('style', 'Style refs', 'style_refs'),
];

const variants = [
  { id: 'variant-1', asset_id: 'asset-1', media_kind: 'image', starred: false },
  { id: 'variant-2', asset_id: 'asset-1', media_kind: 'image', starred: true },
];

const selectedVariant = variants[1];

const collectionItems = [
  {
    id: 'item-asset',
    collection_id: 'cast',
    subject_type: 'asset',
    asset_id: 'asset-1',
    variant_id: null,
    role: 'hero',
    pinned_variant_id: null,
    sort_index: 0,
    created_by: 'user-1',
    created_at: baseTime,
    updated_at: baseTime,
  },
  {
    id: 'item-variant',
    collection_id: 'style',
    subject_type: 'variant',
    asset_id: null,
    variant_id: 'variant-2',
    role: 'style_ref',
    pinned_variant_id: null,
    sort_index: 1,
    created_by: 'user-1',
    created_at: baseTime,
    updated_at: baseTime,
  },
];

function collection(id: string, name: string, kind: string) {
  return {
    id,
    name,
    kind,
    color: null,
    description: null,
    sort_index: 0,
    item_count: 0,
    created_by: 'user-1',
    created_at: baseTime,
    updated_at: baseTime,
  };
}

async function selectDropdown(page: import('@playwright/test').Page, label: string, optionName: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: optionName, exact: true }).click();
}

test('asset detail controls use shared selects and collection buttons', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await mountComponent(page, 'AssetDetailControls', {
    value: 'character',
    disabled: false,
    collections,
    collectionItems,
    variants,
    selectedVariant,
    assetPlacementDrafts: [{
      collectionId: 'style',
      role: 'style_ref',
      subjectType: 'asset',
      pinToCreatedVariant: true,
    }],
    variantPlacementDrafts: [{
      collectionId: 'cast',
      role: 'thumbnail',
      subjectType: 'variant',
    }],
    onChange: '__record__:type',
    onApplyAssetPlacements: '__record__:applyAsset',
    onApplyVariantPlacements: '__record__:applyVariant',
    onAssetPlacementDraftsChange: '__record__:assetDrafts',
    onDeleteCollectionItem: '__record__:deleteItem',
    onUpdateCollectionItem: '__record__:updateItem',
    onVariantPlacementDraftsChange: '__record__:variantDrafts',
  });

  await expect(page.getByRole('combobox', { name: 'Asset type' })).toBeVisible();
  await expect(page.getByText('Asset collections')).toBeVisible();
  await selectDropdown(page, 'Asset type', 'Environment');
  await selectDropdown(page, 'Pinned variant in Cast', 'Variant 2 star');
  await page.getByLabel('Role in Cast').fill('lead');
  await page.getByRole('button', { name: 'Remove' }).first().click();
  await page.getByRole('button', { name: 'Add asset placement' }).click();
  await page.getByRole('button', { name: 'Add variant placement' }).click();

  await screenshot(page, 'asset-detail-controls', { fullPage: true });

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ eventName: 'type', args: ['environment'] }),
    expect.objectContaining({ eventName: 'updateItem', args: ['cast', 'item-asset', { pinnedVariantId: 'variant-2' }] }),
    expect.objectContaining({ eventName: 'updateItem', args: ['cast', 'item-asset', { role: 'lead' }] }),
    expect.objectContaining({ eventName: 'deleteItem', args: ['cast', 'item-asset'] }),
    expect.objectContaining({ eventName: 'applyAsset', args: [] }),
    expect.objectContaining({ eventName: 'applyVariant', args: [] }),
  ]));
});
