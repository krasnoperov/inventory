import { expect, test } from '@playwright/test';
import { mountComponent, screenshot } from './harness';

const baseTime = 1_700_000_000_000;

const asset = (id: string, name: string) => ({
  id,
  name,
  type: 'sprite',
  media_kind: 'image',
  tags: '',
  parent_asset_id: null,
  active_variant_id: `${id}-v`,
  created_by: 'u1',
  created_at: baseTime,
  updated_at: baseTime,
});

const readyVariant = (assetId: string) => ({
  id: `${assetId}-v`,
  asset_id: assetId,
  media_kind: 'image',
  workflow_id: null,
  status: 'completed',
  error_message: null,
  image_key: `images/space/${assetId}.png`,
  thumb_key: `images/space/${assetId}_thumb.webp`,
  media_key: `images/space/${assetId}.png`,
  media_mime_type: 'image/png',
  media_size_bytes: 1,
  media_width: 512,
  media_height: 512,
  media_duration_ms: null,
  recipe: '{}',
  starred: false,
  created_by: 'u1',
  created_at: baseTime,
  updated_at: baseTime,
  description: null,
});

const pendingVariant = (assetId: string) => ({
  ...readyVariant(assetId),
  status: 'pending',
  image_key: null,
  thumb_key: null,
  media_key: null,
});

const composition = {
  id: 'c1',
  name: 'Arbol scene',
  description: null,
  status: 'draft',
  output_asset_id: null,
  output_variant_id: null,
  metadata: '{}',
  sort_index: 0,
  created_by: 'u1',
  created_at: baseTime,
  updated_at: baseTime,
};

const audioAsset = {
  id: 'audio-asset',
  name: 'Merchant greeting',
  type: 'dialogue',
  media_kind: 'audio',
  tags: '',
  parent_asset_id: null,
  active_variant_id: 'audio-variant',
  created_by: 'u1',
  created_at: baseTime,
  updated_at: baseTime,
};

const audioVariant = {
  id: 'audio-variant',
  asset_id: audioAsset.id,
  media_kind: 'audio',
  workflow_id: null,
  status: 'completed',
  error_message: null,
  image_key: null,
  thumb_key: null,
  media_key: 'media/space/audio-variant.wav',
  media_mime_type: 'audio/wav',
  media_size_bytes: 44,
  media_width: null,
  media_height: null,
  media_duration_ms: 1800,
  recipe: JSON.stringify({
    name: 'Rachel',
    prompt: 'Merchant: Fresh apples and clean maps for the road. Come closer before the rain starts.',
    model: 'requested-model',
    dialogueVoiceIds: ['voice-ada', 'voice-ben'],
  }),
  provider_metadata: JSON.stringify({
    provider: 'elevenlabs',
    model: 'eleven_v3',
    voices: [
      { speaker: 'Merchant', voiceId: 'voice-ada', name: 'Rachel' },
      { speaker: 'Traveler', voiceId: 'voice-ben', name: 'Adam' },
    ],
  }),
  generation_provenance: null,
  starred: false,
  created_by: 'u1',
  created_at: baseTime,
  updated_at: baseTime,
  description: null,
};

const deliverables = {
  id: 'deliverables',
  name: 'a1-gender-trap - final',
  kind: 'deliverables',
  color: null,
  description: null,
  sort_index: 0,
  created_at: baseTime,
  updated_at: baseTime,
};

const audioCollectionItem = {
  id: 'deliverable-audio',
  collection_id: deliverables.id,
  subject_type: 'asset',
  asset_id: audioAsset.id,
  variant_id: null,
  pinned_variant_id: audioVariant.id,
  role: 'dialogue',
  sort_index: 0,
  created_at: baseTime,
  updated_at: baseTime,
};

const legacyAudioAsset = {
  ...audioAsset,
  id: 'legacy-audio-asset',
  name: 'Legacy ambience',
  active_variant_id: 'legacy-audio-variant',
};

const legacyAudioVariant = {
  ...audioVariant,
  id: 'legacy-audio-variant',
  asset_id: legacyAudioAsset.id,
  recipe: '{}',
  provider_metadata: null,
};

const legacyAudioCollectionItem = {
  ...audioCollectionItem,
  id: 'deliverable-legacy-audio',
  asset_id: legacyAudioAsset.id,
  pinned_variant_id: legacyAudioVariant.id,
  sort_index: 1,
};

const regeneratingAudioVariant = {
  ...audioVariant,
  id: 'audio-regenerating-variant',
  workflow_id: 'workflow-audio-regenerating',
  status: 'processing',
  media_key: null,
  media_mime_type: null,
  media_size_bytes: null,
  media_duration_ms: null,
  created_at: baseTime + 1,
  updated_at: baseTime + 1,
};

async function selectDropdown(page: import('@playwright/test').Page, label: string, optionName: string, index = 0) {
  await page.getByRole('combobox', { name: label, exact: true }).nth(index).click();
  await page.getByRole('option', { name: optionName, exact: true }).click();
}

// Composition placement points a composition at a finished render. A pending /
// failed variant has no usable media, so the post-generation control must not
// offer to place it. Guard that only the ready card exposes the action.
test('composition placement is gated to finished variants', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mountComponent(page, 'SpaceBoard', {
    spaceId: 'space-1',
    assets: [asset('ready', 'Ready sprite'), asset('pending', 'Pending sprite')],
    variants: [readyVariant('ready'), pendingVariant('pending')],
    collections: [],
    collectionItems: [],
    canEdit: true,
    onAssetClick: '__noop__',
    onPlaceInComposition: '__noop__',
    compositions: [composition],
    compositionItems: [],
    createCollection: '__noop__',
    updateCollection: '__noop__',
    deleteCollection: '__noop__',
    addCollectionItem: '__noop__',
    updateCollectionItem: '__noop__',
    reorderCollectionItems: '__noop__',
    deleteCollectionItem: '__noop__',
  });

  // Only the finished variant's card renders the placement control.
  await expect(page.getByText('Add to composition')).toHaveCount(1);
});

test('audio collection cards surface playback and compact metadata', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mountComponent(page, 'SpaceBoard', {
    spaceId: 'space-1',
    assets: [audioAsset, legacyAudioAsset],
    variants: [audioVariant, legacyAudioVariant],
    collections: [deliverables],
    collectionItems: [audioCollectionItem, legacyAudioCollectionItem],
    canEdit: true,
    onAssetClick: '__noop__',
    createCollection: '__noop__',
    updateCollection: '__noop__',
    deleteCollection: '__noop__',
    addCollectionItem: '__noop__',
    updateCollectionItem: '__noop__',
    reorderCollectionItems: '__noop__',
    deleteCollectionItem: '__noop__',
  });

  await expect(page.getByRole('button', { name: 'Play' })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Merchant greeting' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Legacy ambience' })).toBeVisible();
  await expect(page.locator('[title="Rachel"]')).toBeVisible();
  await expect(page.getByText('eleven_v3')).toBeVisible();
  await expect(page.getByText('Merchant: Rachel, Traveler: Adam')).toBeVisible();
  await expect(page.getByText('Model', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Voice', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Fresh apples and clean maps/)).toBeVisible();

  await screenshot(page, 'space-board-audio-collection', { fullPage: true });
});

test('audio cards keep completed playback while a sibling regeneration is running', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mountComponent(page, 'SpaceBoard', {
    spaceId: 'space-1',
    assets: [audioAsset],
    variants: [audioVariant, regeneratingAudioVariant],
    collections: [deliverables],
    collectionItems: [audioCollectionItem],
    canEdit: true,
    onAssetClick: '__noop__',
    onRegenerateVariant: '__record__:regenerate',
    createCollection: '__noop__',
    updateCollection: '__noop__',
    deleteCollection: '__noop__',
    addCollectionItem: '__noop__',
    updateCollectionItem: '__noop__',
    reorderCollectionItems: '__noop__',
    deleteCollectionItem: '__noop__',
  });

  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(page.getByText('New take generating')).toBeVisible();
  await expect(page.getByText('Generating', { exact: true })).toHaveCount(0);

  await page.getByTitle('Actions for Merchant greeting').click();
  await page.getByRole('button', { name: 'Regenerate audio' }).click();
  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls).toHaveLength(1);
  expect(calls[0].eventName).toBe('regenerate');
  expect((calls[0].args[0] as { id: string }).id).toBe('audio-variant');
});

test('collection menus use shared form controls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 780 });
  await mountComponent(page, 'SpaceBoard', {
    spaceId: 'space-1',
    assets: [asset('hero', 'Hero sprite'), asset('background', 'Forest background')],
    variants: [readyVariant('hero'), { ...readyVariant('hero'), id: 'hero-alt-v', starred: true }, readyVariant('background')],
    collections: [
      {
        id: 'cast',
        name: 'Cast',
        kind: 'cast',
        color: null,
        description: null,
        sort_index: 0,
        created_at: baseTime,
        updated_at: baseTime,
      },
      {
        id: 'backgrounds',
        name: 'Backgrounds',
        kind: 'backgrounds',
        color: null,
        description: null,
        sort_index: 1,
        created_at: baseTime,
        updated_at: baseTime,
      },
    ],
    collectionItems: [
      {
        id: 'cast-hero',
        collection_id: 'cast',
        subject_type: 'asset',
        asset_id: 'hero',
        variant_id: null,
        pinned_variant_id: null,
        role: 'character',
        sort_index: 0,
        created_at: baseTime,
        updated_at: baseTime,
      },
    ],
    canEdit: true,
    onAssetClick: '__noop__',
    createCollection: '__record__:createCollection',
    updateCollection: '__record__:updateCollection',
    deleteCollection: '__record__:deleteCollection',
    addCollectionItem: '__record__:addCollectionItem',
    updateCollectionItem: '__record__:updateCollectionItem',
    reorderCollectionItems: '__record__:reorderCollectionItems',
    deleteCollectionItem: '__record__:deleteCollectionItem',
  });

  await page.getByText('New collection').click();
  await page.getByPlaceholder('Collection name').fill('Props');
  await selectDropdown(page, 'New collection kind', 'Style References');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByText('New collection').click();

  await page.getByText('Manage').first().click();
  await page.getByRole('textbox', { name: 'Collection name' }).first().fill('Cast updated');
  await selectDropdown(page, 'Collection kind', 'Scenes');
  await selectDropdown(page, 'Asset to add to Cast', 'Forest background');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await screenshot(page, 'space-board-collection-manage-menu', { fullPage: true });
  await page.getByText('Manage').first().click();

  await page.getByTitle('Actions for Hero sprite').click();
  await page.getByLabel('Role for Hero sprite').fill('lead');
  await selectDropdown(page, 'Collection target for Hero sprite', 'Backgrounds');
  await selectDropdown(page, 'Pinned variant for Hero sprite', 'Variant 2 star');
  await screenshot(page, 'space-board-collection-menus', { fullPage: true });

  const calls = await page.evaluate(() => window.__componentHarnessCallDetails ?? []);
  expect(calls.some((call) => call.eventName === 'createCollection')).toBe(true);
  expect(calls.some((call) => call.eventName === 'updateCollection')).toBe(true);
  expect(calls.some((call) => call.eventName === 'addCollectionItem')).toBe(true);
  expect(calls.some((call) => call.eventName === 'updateCollectionItem')).toBe(true);
});
