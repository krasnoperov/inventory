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

function asset(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asset-1',
    name: 'Hero reveal video',
    type: 'animation',
    media_kind: 'video',
    tags: '',
    parent_asset_id: null,
    active_variant_id: 'variant-video',
    created_by: 'user-1',
    created_at: baseTime,
    updated_at: baseTime,
    ...overrides,
  };
}

function fullVariant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'variant-video',
    asset_id: 'asset-1',
    media_kind: 'video',
    workflow_id: null,
    status: 'completed',
    error_message: null,
    image_key: null,
    thumb_key: 'thumbs/hero-reveal.webp',
    media_key: 'videos/hero-reveal.mp4',
    media_mime_type: 'video/mp4',
    media_size_bytes: 1200000,
    media_width: 1920,
    media_height: 1080,
    media_duration_ms: 8000,
    recipe: '{}',
    starred: false,
    created_by: 'user-1',
    created_at: baseTime,
    updated_at: baseTime,
    description: null,
    quality_rating: null,
    rated_at: null,
    ...overrides,
  };
}

async function selectDropdown(page: import('@playwright/test').Page, label: string, optionName: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: optionName, exact: true }).click();
}

test('asset detail title rename uses shared inline field', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 180 });
  await mountComponent(page, 'AssetTitleInlineEditor', {
    assetName: 'Hero Character',
    editingName: false,
    editNameValue: '',
    onEditNameValueChange: '__record__:editName',
    onNameKeyDown: '__noop__',
    onSaveName: '__record__:saveName',
    onStartEditName: '__record__:startEdit',
  });

  await expect(page.getByRole('button', { name: 'Rename Hero Character' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hero Character' })).toBeVisible();
  await screenshot(page, 'asset-title-rename-trigger', { fullPage: true });

  await mountComponent(page, 'AssetTitleInlineEditor', {
    assetName: 'Hero Character',
    editingName: true,
    editNameValue: 'Hero Character',
    onEditNameValueChange: '__record__:editName',
    onNameKeyDown: '__noop__',
    onSaveName: '__record__:saveName',
    onStartEditName: '__record__:startEdit',
  });

  const input = page.getByLabel('Asset name');
  await expect(input).toBeFocused();
  await input.fill('Hero Portrait');
  await screenshot(page, 'asset-title-inline-editor', { fullPage: true });
  await input.blur();

  const calls = await page.evaluate(() => window.__componentHarnessCalls ?? []);
  expect(calls).toEqual(expect.arrayContaining([
    'editName:["Hero Portrait"]',
  ]));
});

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

test('asset collection membership is compact until management is requested', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 540 });
  await mountComponent(page, 'AssetDetailControls', {
    value: 'character',
    disabled: false,
    collections,
    collectionItems,
    variants,
    selectedVariant,
    assetPlacementDrafts: [],
    variantPlacementDrafts: [],
    onChange: '__record__:type',
    onApplyAssetPlacements: '__record__:applyAsset',
    onApplyVariantPlacements: '__record__:applyVariant',
    onAssetPlacementDraftsChange: '__record__:assetDrafts',
    onDeleteCollectionItem: '__record__:deleteItem',
    onUpdateCollectionItem: '__record__:updateItem',
    onVariantPlacementDraftsChange: '__record__:variantDrafts',
  });

  await expect(page.getByText('Collections', { exact: true })).toBeVisible();
  await expect(page.getByText('Cast')).toBeVisible();
  await expect(page.getByText('Asset')).toBeVisible();
  await expect(page.getByText('hero')).toBeVisible();
  await expect(page.getByText('Style refs')).toBeVisible();
  await expect(page.getByText('Selected variant')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manage collections' })).toBeVisible();
  await expect(page.getByLabel('Role in Cast')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  await expect(page.getByText('Add asset to collections', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Add selected variant to collections', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add asset to collection' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add variant to collection' })).toHaveCount(0);

  await screenshot(page, 'collection-membership-compact', { fullPage: true });

  await page.getByRole('button', { name: 'Manage collections' }).click();
  await expect(page.getByLabel('Role in Cast')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add asset to collection' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add variant to collection' })).toBeVisible();
  await page.getByRole('button', { name: 'Add asset to collection' }).click();
  await expect(page.getByText('Add asset to collections', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Add to Style refs')).toBeVisible();

  await page.getByRole('button', { name: 'Hide' }).click();
  await expect(page.getByText('Add asset to collections', { exact: true })).toHaveCount(0);
});

test('asset collection placement shortcut opens selected variant picker', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 540 });
  await mountComponent(page, 'AssetDetailControls', {
    value: 'character',
    disabled: false,
    collections,
    collectionItems,
    variants,
    selectedVariant,
    assetPlacementDrafts: [],
    variantPlacementControlsOpen: true,
    variantPlacementDrafts: [],
    onChange: '__record__:type',
    onApplyAssetPlacements: '__record__:applyAsset',
    onApplyVariantPlacements: '__record__:applyVariant',
    onAssetPlacementDraftsChange: '__record__:assetDrafts',
    onDeleteCollectionItem: '__record__:deleteItem',
    onUpdateCollectionItem: '__record__:updateItem',
    onVariantPlacementControlsOpenChange: '__record__:variantPlacementOpen',
    onVariantPlacementDraftsChange: '__record__:variantDrafts',
  });

  await expect(page.getByText('Add asset to collections', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Add selected variant to collections', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Add to Cast')).toBeVisible();
  await page.getByRole('button', { name: 'Hide' }).click();

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toEqual(expect.arrayContaining([
    { eventName: 'variantPlacementOpen', args: [false] },
  ]));
});

test('asset details strip makes video facts and details disclosure visible', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 420 });
  await mountComponent(page, 'AssetDetailsStrip', {
    asset: asset(),
    assetCollectionCount: 1,
    assetTypeDisabled: false,
    fullDetailsOpen: false,
    onAssetTypeChange: '__record__:type',
    onToggleFullDetails: '__record__:toggleFullDetails',
    selectedVariant: fullVariant(),
    selectedVariantCollectionCount: 1,
    variantCount: 3,
  });

  await expect(page.getByRole('region', { name: 'Asset details', exact: true })).toBeVisible();
  await expect(page.getByText('Hero reveal video')).toBeVisible();
  await expect(page.getByText('Video', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Asset type' })).toBeVisible();
  await selectDropdown(page, 'Asset type', 'Environment');
  await expect(page.getByText('Video · Completed')).toBeVisible();
  await expect(page.getByText('1920x1080')).toBeVisible();
  await expect(page.getByText('8.0s')).toBeVisible();
  await expect(page.getByText('Video details')).toBeVisible();

  await page.getByRole('button', { name: 'Show video details' }).click();
  await screenshot(page, 'asset-details-strip-video', { fullPage: true });

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toEqual(expect.arrayContaining([
    { eventName: 'type', args: ['environment'] },
    { eventName: 'toggleFullDetails', args: [] },
  ]));
});

test('asset details strip also exposes image facts without a hidden click target', async ({ page }) => {
  await page.setViewportSize({ width: 620, height: 360 });
  await mountComponent(page, 'AssetDetailsStrip', {
    asset: asset({
      name: 'Hero portrait',
      type: 'character',
      media_kind: 'image',
    }),
    assetCollectionCount: 0,
    fullDetailsOpen: true,
    onToggleFullDetails: '__record__:toggleFullDetails',
    selectedVariant: fullVariant({
      media_kind: 'image',
      media_key: 'images/hero.png',
      media_mime_type: 'image/png',
      media_width: 1024,
      media_height: 1024,
      media_duration_ms: null,
    }),
    selectedVariantCollectionCount: 0,
    variantCount: 1,
  });

  await expect(page.getByRole('region', { name: 'Asset details', exact: true })).toBeVisible();
  await expect(page.getByText('Hero portrait')).toBeVisible();
  await expect(page.getByText('Image', { exact: true })).toBeVisible();
  await expect(page.getByText('Character')).toBeVisible();
  await expect(page.getByText('Image · Completed')).toBeVisible();
  await expect(page.getByText('1024x1024')).toBeVisible();
  await expect(page.getByText('Duration')).toHaveCount(0);
  await expect(page.getByText('Image details')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hide image details' })).toBeVisible();
});

test('asset details strip names audio details explicitly', async ({ page }) => {
  await page.setViewportSize({ width: 620, height: 360 });
  await mountComponent(page, 'AssetDetailsStrip', {
    asset: asset({
      name: 'Narration pass',
      type: 'sound',
      media_kind: 'audio',
    }),
    assetCollectionCount: 0,
    fullDetailsOpen: true,
    onToggleFullDetails: '__record__:toggleFullDetails',
    selectedVariant: fullVariant({
      media_kind: 'audio',
      media_key: 'audio/narration.mp3',
      media_mime_type: 'audio/mpeg',
      media_width: null,
      media_height: null,
      media_duration_ms: 42000,
    }),
    selectedVariantCollectionCount: 0,
    variantCount: 1,
  });

  await expect(page.getByText('Narration pass')).toBeVisible();
  await expect(page.getByText('Audio', { exact: true })).toBeVisible();
  await expect(page.getByText('Audio · Completed')).toBeVisible();
  await expect(page.getByText('42s')).toBeVisible();
  await expect(page.getByText('Audio details')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hide audio details' })).toBeVisible();
});

test('asset details dock renders the real expanded stack above ForgeTray', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 720 });
  await mountComponent(page, 'AssetGenerationDock', {
    asset: asset(),
    assetCollectionCount: 1,
    assetTypeDisabled: false,
    fullDetailsOpen: true,
    onAssetTypeChange: '__record__:type',
    onToggleFullDetails: '__record__:toggleFullDetails',
    selectedVariant: fullVariant(),
    selectedVariantCollectionCount: 1,
    variantCount: 3,
  });

  await expect(page.getByRole('region', { name: 'Asset generation controls' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Asset details', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hide image details' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Expanded asset details' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Collection membership' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Style reference usage' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Manual relations' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Composition usage' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Collection membership' }).getByText('Collections', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Style reference usage' }).getByText('Style usage')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Manual relations' }).getByText('Relations')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Composition usage' }).getByText('Composition usage')).toBeVisible();
  await expect(page.getByLabel('Prompt')).toBeVisible();

  const detailsBeforePrompt = await page.evaluate(() => {
    const details = document.querySelector('[aria-label="Asset details"]');
    const prompt = document.querySelector('[aria-label="Prompt"]');
    return Boolean(details && prompt && details.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(detailsBeforePrompt).toBe(true);

  await screenshot(page, 'asset-details-stack-desktop', { fullPage: true });
});

test('asset details dock keeps the real expanded stack usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await mountComponent(page, 'AssetGenerationDock', {
    asset: asset(),
    assetCollectionCount: 1,
    assetTypeDisabled: false,
    fullDetailsOpen: true,
    onAssetTypeChange: '__record__:type',
    onToggleFullDetails: '__record__:toggleFullDetails',
    selectedVariant: fullVariant(),
    selectedVariantCollectionCount: 1,
    variantCount: 3,
  });

  await expect(page.getByRole('region', { name: 'Asset generation controls' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Asset details', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Collection membership' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Style reference usage' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Manual relations' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Composition usage' })).toBeVisible();
  await expect(page.getByLabel('Prompt')).toBeVisible();

  await screenshot(page, 'asset-details-stack-mobile', { fullPage: true });
});

test('asset detail overlays use flat chrome', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 460 });
  await mountComponent(page, 'AssetDetailOverlayChrome', {});

  await expect(page.getByRole('region', { name: 'Tile grid overlay' })).toHaveCSS('box-shadow', 'none');
  const generationJobs = page.getByRole('region', { name: 'Generation jobs' });
  await expect(generationJobs.locator('[class*="jobCard"]')).toHaveCSS('box-shadow', 'none');
  await expect(generationJobs.getByLabel('Generating job')).toBeVisible();
  await expect(generationJobs).toContainText('Generating');
  await expect(generationJobs).not.toContainText('Creating variant...');

  await screenshot(page, 'asset-detail-flat-overlays', { fullPage: true });
});
