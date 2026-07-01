import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const baseTime = 1_700_000_000_000;

function asset(id: string, name: string, type = 'character') {
  return {
    id,
    name,
    type,
    media_kind: 'image',
    tags: '',
    parent_asset_id: null,
    active_variant_id: `${id}-v1`,
    created_by: 'user-1',
    created_at: baseTime,
    updated_at: baseTime,
  };
}

function variant(assetId: string, suffix = 'v1') {
  return {
    id: `${assetId}-${suffix}`,
    asset_id: assetId,
    media_kind: 'image',
    workflow_id: null,
    status: 'completed',
    error_message: null,
    image_key: `images/space/${assetId}-${suffix}.png`,
    thumb_key: `images/space/${assetId}-${suffix}_thumb.webp`,
    media_key: `images/space/${assetId}-${suffix}.png`,
    media_mime_type: 'image/png',
    media_size_bytes: 123,
    media_width: 100,
    media_height: 100,
    media_duration_ms: null,
    transcript_key: null,
    transcript_mime_type: null,
    transcript_size_bytes: null,
    word_timings_key: null,
    word_timings_mime_type: null,
    word_timings_size_bytes: null,
    render_metadata_key: null,
    render_metadata_mime_type: null,
    render_metadata_size_bytes: null,
    recipe: '{}',
    starred: false,
    created_by: 'user-1',
    created_at: baseTime,
    updated_at: baseTime,
    description: null,
    quality_rating: null,
    rated_at: null,
  };
}

const assets = [
  asset('anna', 'Anna'),
  asset('pilar', 'Pilar'),
  asset('bar', 'Bar Background', 'scene'),
  asset('scene', 'Scene Bar', 'scene'),
];

const variants = [
  variant('anna', 'v1'),
  variant('anna', 'v2'),
  variant('pilar', 'v1'),
  variant('bar', 'v1'),
  variant('scene', 'v1'),
];

const composition = {
  id: 'composition-1',
  name: 'Scene Bar composition',
  description: null,
  status: 'draft',
  output_asset_id: 'scene',
  output_variant_id: 'scene-v1',
  metadata: '{}',
  sort_index: 0,
  created_by: 'user-1',
  created_at: baseTime,
  updated_at: baseTime,
};

function detailProps(overrides: Record<string, unknown> = {}) {
  return {
    spaceId: 'space-1',
    compositions: [composition],
    compositionItems: [],
    assets,
    variants,
    lineage: [],
    collections: [{ id: 'collection-1', name: 'Cast', description: null, sort_index: 0, created_by: 'user-1', created_at: baseTime, updated_at: baseTime }],
    collectionItems: [{
      id: 'collection-item-1',
      collection_id: 'collection-1',
      subject_type: 'asset',
      asset_id: 'anna',
      variant_id: null,
      role: 'member',
      pinned_variant_id: 'anna-v2',
      sort_index: 0,
      created_by: 'user-1',
      created_at: baseTime,
      updated_at: baseTime,
    }],
    selectedCompositionId: 'composition-1',
    canEdit: true,
    onSelectComposition: '__record__:select-composition',
    onCreateComposition: '__record__:create-composition',
    onUpdateComposition: '__record__:update-composition',
    onDeleteComposition: '__record__:delete-composition',
    onCreateItem: '__record__:create-item',
    onUpdateItem: '__record__:update-item',
    onDeleteItem: '__record__:delete-item',
    onReorderItems: '__record__:reorder-items',
    onOpenAsset: '__record__:open-asset',
    onClose: '__record__:close',
    ...overrides,
  };
}

async function calls(page: import('@playwright/test').Page) {
  return page.evaluate(() => window.__componentHarnessCalls ?? []);
}

test('composition detail creates compositions and sets an exact output variant', async ({ page }) => {
  await mountComponent(page, 'CompositionDetail', detailProps({
    compositions: [{ ...composition, output_asset_id: null, output_variant_id: null }],
  }));

  await expect(page.getByRole('button', { name: /Scene Bar composition draft/ }).first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('complementary', { name: 'Composition detail' })).toHaveCSS('box-shadow', 'none');
  await expect(page.getByRole('complementary', { name: 'Composition detail' })).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.getByText('Composition Detail', { exact: true })).toHaveCSS('text-transform', 'none');
  await expect(page.getByText('Compositions', { exact: true })).toHaveCSS('text-transform', 'none');
  await expect(page.getByText('New', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create composition' })).toBeVisible();
  await expect(page.getByText('Add', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Delete', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Output variant' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Background variant' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Characters variant' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete Scene Bar composition' })).toBeVisible();

  await screenshot(page, 'composition-detail-controls', { fullPage: true });

  await page.getByRole('button', { name: 'Create composition' }).click();
  await expect.poll(() => calls(page)).toContain('create-composition');
  await page.getByRole('button', { name: 'Delete Scene Bar composition' }).click();
  await expect.poll(() => calls(page)).toContain('delete-composition:["composition-1"]');

  const output = page.getByRole('heading', { name: 'Output' }).locator('xpath=ancestor::section[1]');
  await output.getByRole('button', { name: 'Add Output variant' }).click();
  await expect(page.locator('[class*="pickerOverlay"]')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.getByLabel('Search exact variants').fill('Scene Bar');
  await expect(
    page.getByRole('dialog', { name: 'Choose exact variant' }).getByRole('button', { name: /Scene Bar/ }).first(),
  ).toHaveCSS('grid-template-columns', /48px /);
  await screenshot(page, 'composition-variant-picker', { fullPage: true });
  await page.getByRole('dialog', { name: 'Choose exact variant' }).getByRole('button', { name: /Scene Bar/ }).click();

  await expect.poll(() => calls(page)).toContainEqual(expect.stringContaining(
    'update-composition:["composition-1",{"outputAssetId":"scene","outputVariantId":"scene-v1"}]',
  ));
});

test('composition detail renames the selected composition from the shared text field', async ({ page }) => {
  await mountComponent(page, 'CompositionDetail', detailProps());

  await page.getByRole('button', { name: 'Scene Bar composition', exact: true }).click();
  await page.getByLabel('Composition name').fill('Scene Bar final');
  await page.keyboard.press('Enter');

  await expect.poll(() => calls(page)).toContainEqual(expect.stringContaining(
    'update-composition:["composition-1",{"name":"Scene Bar final"}]',
  ));
});

test('composition detail adds, replaces, removes, and reorders slot items without deleting sources', async ({ page }) => {
  await mountComponent(page, 'CompositionDetail', detailProps({
    compositionItems: [
      { id: 'item-1', composition_id: 'composition-1', role: 'character', asset_id: 'anna', variant_id: 'anna-v1', metadata: '{}', sort_index: 0, created_by: 'user-1', created_at: baseTime, updated_at: baseTime },
      { id: 'item-2', composition_id: 'composition-1', role: 'character', asset_id: 'pilar', variant_id: 'pilar-v1', metadata: '{}', sort_index: 1, created_by: 'user-1', created_at: baseTime, updated_at: baseTime },
    ],
  }));

  const initialAnnaRow = page.getByText('Exact variant anna-v1').locator('xpath=ancestor::div[contains(@class, "usageRow")]').first();
  await expect(initialAnnaRow.getByText('Open', { exact: true })).toHaveCount(0);
  await expect(initialAnnaRow.getByText('Replace', { exact: true })).toHaveCount(0);
  await expect(initialAnnaRow.getByText('Remove', { exact: true })).toHaveCount(0);
  await expect(initialAnnaRow.getByRole('button', { name: 'Open Anna asset' })).toBeVisible();
  await expect(initialAnnaRow.getByRole('button', { name: 'Replace Anna variant' })).toBeVisible();
  await expect(initialAnnaRow.getByRole('button', { name: 'Remove Anna from composition' })).toBeVisible();
  await initialAnnaRow.getByRole('button', { name: 'Open Anna asset' }).click();
  await expect.poll(() => calls(page)).toContain('open-asset:["anna"]');
  await screenshot(page, 'composition-detail-row-actions', { fullPage: true });
  await page.setViewportSize({ width: 620, height: 720 });
  await expect(initialAnnaRow).toHaveCSS('grid-template-columns', /75px /);
  await screenshot(page, 'composition-detail-row-actions-mobile', { fullPage: true });

  const props = page.getByRole('heading', { name: 'Props' }).locator('xpath=ancestor::section[1]');
  await props.getByRole('button', { name: 'Add Props variant' }).click();
  await page.getByLabel('Search exact variants').fill('Anna');
  await page.getByRole('dialog', { name: 'Choose exact variant' }).getByRole('button', { name: /Anna/ }).first().click();
  await expect.poll(() => calls(page)).toContainEqual(expect.stringContaining(
    'create-item:["composition-1",{"role":"prop","assetId":"anna","variantId":"anna-v1"',
  ));

  const annaRow = page.getByText('Exact variant anna-v1').locator('xpath=ancestor::div[contains(@class, "usageRow")]').first();
  await annaRow.getByRole('button', { name: 'Replace Anna variant' }).click();
  await page.getByLabel('Search exact variants').fill('Pilar');
  await page.getByRole('dialog', { name: 'Choose exact variant' }).getByRole('button', { name: /Pilar/ }).click();
  await expect.poll(() => calls(page)).toContainEqual(expect.stringContaining(
    'update-item:["composition-1","item-1",{"assetId":"pilar","variantId":"pilar-v1"}]',
  ));

  await annaRow.getByRole('button', { name: 'Remove Anna from composition' }).click();
  await expect.poll(() => calls(page)).toContainEqual(expect.stringContaining(
    'delete-item:["composition-1","item-1"]',
  ));
  expect((await calls(page)).join('\n')).not.toContain('delete-asset');

  await page.getByTitle('Move down').click();
  await expect.poll(() => calls(page)).toContainEqual(expect.stringContaining(
    'reorder-items:["composition-1",["item-2","item-1"]]',
  ));
});

test('composition detail preserves mixed slot order when reordering same-role items', async ({ page }) => {
  await mountComponent(page, 'CompositionDetail', detailProps({
    compositionItems: [
      { id: 'item-1', composition_id: 'composition-1', role: 'character', asset_id: 'anna', variant_id: 'anna-v1', metadata: '{}', sort_index: 0, created_by: 'user-1', created_at: baseTime, updated_at: baseTime },
      { id: 'item-prop', composition_id: 'composition-1', role: 'prop', asset_id: 'bar', variant_id: 'bar-v1', metadata: '{}', sort_index: 1, created_by: 'user-1', created_at: baseTime, updated_at: baseTime },
      { id: 'item-2', composition_id: 'composition-1', role: 'character', asset_id: 'pilar', variant_id: 'pilar-v1', metadata: '{}', sort_index: 2, created_by: 'user-1', created_at: baseTime, updated_at: baseTime },
    ],
  }));

  const characters = page.getByRole('heading', { name: 'Characters' }).locator('xpath=ancestor::section[1]');
  await characters.getByTitle('Move down').click();

  await expect.poll(() => calls(page)).toContainEqual(expect.stringContaining(
    'reorder-items:["composition-1",["item-2","item-prop","item-1"]]',
  ));
});

test('composition detail uses an icon action for missing source rows', async ({ page }) => {
  await mountComponent(page, 'CompositionDetail', detailProps({
    compositionItems: [
      { id: 'missing-item', composition_id: 'composition-1', role: 'character', asset_id: 'missing-asset', variant_id: 'missing-v1', metadata: '{}', sort_index: 0, created_by: 'user-1', created_at: baseTime, updated_at: baseTime },
    ],
  }));

  const missingRow = page
    .getByRole('button', { name: 'Remove missing variant missing-v1 from composition' })
    .locator('xpath=ancestor::div[1]');
  await expect(missingRow).toBeVisible();
  await expect(missingRow.getByText('Remove', { exact: true })).toHaveCount(0);
  await expect(missingRow.getByRole('button', { name: 'Remove missing variant missing-v1 from composition' })).toBeVisible();
  await screenshot(page, 'composition-detail-missing-row', { fullPage: true });

  await missingRow.getByRole('button', { name: 'Remove missing variant missing-v1 from composition' }).click();
  await expect.poll(() => calls(page)).toContain('delete-item:["composition-1","missing-item"]');
});

test('composition detail hides reorder controls for viewers', async ({ page }) => {
  await mountComponent(page, 'CompositionDetail', detailProps({
    canEdit: false,
    compositionItems: [
      { id: 'item-1', composition_id: 'composition-1', role: 'character', asset_id: 'anna', variant_id: 'anna-v1', metadata: '{}', sort_index: 0, created_by: 'user-1', created_at: baseTime, updated_at: baseTime },
      { id: 'item-2', composition_id: 'composition-1', role: 'character', asset_id: 'pilar', variant_id: 'pilar-v1', metadata: '{}', sort_index: 1, created_by: 'user-1', created_at: baseTime, updated_at: baseTime },
    ],
  }));

  await expect(page.getByTitle('Move up')).toHaveCount(0);
  await expect(page.getByTitle('Move down')).toHaveCount(0);
});

test('composition reverse lookup includes exact variant and asset matches', async ({ page }) => {
  await mountComponent(page, 'CompositionUsageList', {
    targetAssetId: 'anna',
    assets,
    variants,
    compositions: [
      composition,
      { ...composition, id: 'composition-2', name: 'Pinned variant scene', output_asset_id: null, output_variant_id: null },
      { ...composition, id: 'composition-3', name: 'Output variant scene', output_asset_id: 'scene', output_variant_id: 'anna-v2' },
      { ...composition, id: 'composition-4', name: 'Other cast scene', output_asset_id: 'pilar', output_variant_id: 'pilar-v1' },
    ],
    compositionItems: [
      { id: 'item-1', composition_id: 'composition-1', role: 'character', asset_id: 'anna', variant_id: 'anna-v1', metadata: '{}', sort_index: 0, created_by: 'user-1', created_at: baseTime, updated_at: baseTime },
      { id: 'item-2', composition_id: 'composition-2', role: 'thumbnail', asset_id: null, variant_id: 'anna-v2', metadata: '{}', sort_index: 0, created_by: 'user-1', created_at: baseTime, updated_at: baseTime },
      { id: 'item-3', composition_id: 'composition-4', role: 'character', asset_id: 'pilar', variant_id: 'pilar-v1', metadata: '{}', sort_index: 0, created_by: 'user-1', created_at: baseTime, updated_at: baseTime },
    ],
    onOpenComposition: '__record__:open-composition',
  });

  await expect(page.getByRole('button', { name: /Scene Bar composition/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Pinned variant scene/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Output variant scene/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Other cast scene/ })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Composition usage' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Composition usage' })).toHaveCSS('display', 'flex');
  await expect(page.getByText('Composition usage')).toBeVisible();
  await expect(page.getByText('3', { exact: true })).toBeVisible();
  await expect(page.getByText('Thumbnails', { exact: true })).toHaveCSS('text-transform', 'none');
  await expect(page.getByText('output', { exact: true })).toHaveCSS('text-transform', 'none');
  await expect.poll(async () => {
    const regionBox = await page.getByRole('region', { name: 'Composition usage' }).boundingBox();
    const buttonBox = await page.getByRole('button', { name: /Scene Bar composition/ }).boundingBox();
    if (!regionBox || !buttonBox) return false;
    return buttonBox.width < regionBox.width / 2;
  }).toBe(true);

  await page.getByRole('button', { name: /Pinned variant scene/ }).click();
  await expect.poll(() => calls(page)).toContainEqual(expect.stringContaining('open-composition:["composition-2"]'));

  await screenshot(page, 'composition-usage-compact', { fullPage: true });
});

test('composition reverse lookup stays hidden when empty', async ({ page }) => {
  await mountComponent(page, 'CompositionUsageList', {
    targetAssetId: 'bar',
    assets,
    variants,
    compositions: [composition],
    compositionItems: [],
    onOpenComposition: '__record__:open-composition',
  });

  await expect(page.getByRole('region', { name: 'Composition usage' })).toHaveCount(0);
});

test('composition detail distinguishes exact usage from collections, hierarchy, and lineage', async ({ page }) => {
  await mountComponent(page, 'CompositionDetail', detailProps({
    compositionItems: [
      { id: 'item-1', composition_id: 'composition-1', role: 'character', asset_id: 'anna', variant_id: 'anna-v1', metadata: '{}', sort_index: 0, created_by: 'user-1', created_at: baseTime, updated_at: baseTime },
    ],
    lineage: [
      { id: 'lineage-1', parent_variant_id: 'anna-v1', child_variant_id: 'scene-v1', relation_type: 'derived', severed: false, created_at: baseTime },
    ],
  }));

  await expect(page.getByText('Exact variant usage is stored here.')).toBeVisible();
  await expect(page.getByText('Asset collection: Cast')).toBeVisible();
  await expect(page.getByText(/Variant lineage/)).toBeVisible();
  await expect(page.getByText(/not edited by composition slots/)).toBeVisible();
});
