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
