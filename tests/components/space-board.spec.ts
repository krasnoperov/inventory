import { expect, test } from '@playwright/test';
import { mountComponent } from './harness';

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
