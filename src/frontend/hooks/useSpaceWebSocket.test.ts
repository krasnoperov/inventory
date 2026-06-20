import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  clearSpaceStateSnapshotCacheForTests,
  getInitialSyncModeForSpaceForTests,
  getSpaceStateSnapshotForTests,
  getVariantMediaUrl,
  getVariantThumbnailUrl,
  isVariantAudioReady,
  isVariantForgeTrayReady,
  isVariantImageReady,
  isVariantReady,
  isVariantVideoReady,
  saveSpaceStateSnapshotForTests,
  shouldApplyOverviewSyncForTests,
  shouldPersistSpaceStateSnapshotForTests,
  shouldReuseSharedSpaceSocketForTests,
  type Asset,
  type Variant,
} from './useSpaceWebSocket';
import { handleSpaceServerMessage } from '../space/handleSpaceServerMessage';
import { useSpaceSessionStore } from '../space/spaceStore';

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    name: 'Asset One',
    type: 'scene',
    media_kind: 'image',
    tags: '[]',
    parent_asset_id: null,
    active_variant_id: 'variant-1',
    created_by: 'user-1',
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function variant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: 'variant-1',
    asset_id: 'asset-1',
    media_kind: 'image',
    workflow_id: null,
    status: 'completed',
    error_message: null,
    image_key: 'images/space/variant.png',
    thumb_key: 'images/space/variant_thumb.webp',
    media_key: 'images/space/variant.png',
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
    generation_provenance: '{}',
    provider_metadata: null,
    recipe: '{}',
    starred: false,
    created_by: 'user-1',
    created_at: 1,
    updated_at: 1,
    description: null,
    quality_rating: null,
    rated_at: null,
    ...overrides,
  };
}

describe('space state snapshot cache', () => {
  test('preserves loaded assets for same-space remounts without exposing mutable cache state', () => {
    clearSpaceStateSnapshotCacheForTests();

    saveSpaceStateSnapshotForTests('space-1', {
      assets: [asset()],
      variants: [variant()],
      lineage: [],
      relations: [],
      presence: [],
      rotationSets: [],
      rotationViews: [],
      tileSets: [],
      tilePositions: [],
      syncMode: 'overview',
      updatedAt: 1,
    });

    const firstRead = getSpaceStateSnapshotForTests('space-1');
    assert.equal(firstRead?.assets.length, 1);
    assert.equal(firstRead?.variants.length, 1);

    firstRead?.assets.push(asset({ id: 'asset-2' }));

    const secondRead = getSpaceStateSnapshotForTests('space-1');
    assert.equal(secondRead?.assets.length, 1);
    assert.equal(secondRead?.assets[0]?.id, 'asset-1');
  });

  test('returns no snapshot for spaces that have not synced yet', () => {
    clearSpaceStateSnapshotCacheForTests();

    assert.equal(getSpaceStateSnapshotForTests('new-space'), null);
  });

  test('does not persist stale state under a new space id during navigation', () => {
    assert.equal(shouldPersistSpaceStateSnapshotForTests('space-2', 'space-1', true), false);
    assert.equal(shouldPersistSpaceStateSnapshotForTests('space-2', 'space-2', false), false);
    assert.equal(shouldPersistSpaceStateSnapshotForTests('space-2', 'space-2', true), true);
  });

  test('reuses an open or connecting socket only for the same space', () => {
    assert.equal(shouldReuseSharedSpaceSocketForTests('space-1', 'space-1', 1), true);
    assert.equal(shouldReuseSharedSpaceSocketForTests('space-1', 'space-1', 0), true);
    assert.equal(shouldReuseSharedSpaceSocketForTests('space-1', 'space-2', 1), false);
    assert.equal(shouldReuseSharedSpaceSocketForTests('space-1', 'space-1', 2), false);
    assert.equal(shouldReuseSharedSpaceSocketForTests('space-1', 'space-1', 3), false);
    assert.equal(shouldReuseSharedSpaceSocketForTests(null, 'space-1', 1), false);
  });

  test('ignores overview sync once full sync is the desired mode', () => {
    assert.equal(shouldApplyOverviewSyncForTests(null), true);
    assert.equal(shouldApplyOverviewSyncForTests('overview'), true);
    assert.equal(shouldApplyOverviewSyncForTests('full'), false);
  });

  test('does not seed fresh connection sync mode from cached snapshots', () => {
    clearSpaceStateSnapshotCacheForTests();

    saveSpaceStateSnapshotForTests('space-1', {
      assets: [asset()],
      variants: [variant()],
      lineage: [],
      relations: [],
      presence: [],
      rotationSets: [],
      rotationViews: [],
      tileSets: [],
      tilePositions: [],
      syncMode: 'full',
      updatedAt: 1,
    });

    assert.equal(getSpaceStateSnapshotForTests('space-1')?.syncMode, 'full');
    assert.equal(getInitialSyncModeForSpaceForTests('space-1', null, null, null), null);
    assert.equal(getInitialSyncModeForSpaceForTests('space-1', 'space-1', 'full', 1), 'full');
    assert.equal(getInitialSyncModeForSpaceForTests('space-1', 'space-1', 'overview', 0), 'overview');
    assert.equal(getInitialSyncModeForSpaceForTests('space-1', 'space-2', 'full', 1), null);
    assert.equal(getInitialSyncModeForSpaceForTests('space-1', 'space-1', 'full', 3), null);
  });
});

describe('space message handling', () => {
  test('applies state updates even when no view callbacks are registered', () => {
    const store = useSpaceSessionStore.getState();
    store.hydrateFromSnapshot('space-1', null);

    handleSpaceServerMessage({
      type: 'sync:state',
      assets: [asset()],
      variants: [variant()],
      lineage: [],
      relations: [],
    }, {
      syncModeRef: { current: null },
      variantIdsRef: { current: new Set() },
      sendMessage: () => {},
      markSynced: store.markSynced,
      setAssets: store.setAssets,
      setVariants: store.setVariants,
      setLineage: store.setLineage,
      setRelations: store.setRelations,
      setJobs: store.setJobs,
      setPresence: store.setPresence,
      setRotationSets: store.setRotationSets,
      setRotationViews: store.setRotationViews,
      setTileSets: store.setTileSets,
      setTilePositions: store.setTilePositions,
      setError: store.setError,
    });

    const next = useSpaceSessionStore.getState();
    assert.equal(next.hasSynced, true);
    assert.equal(next.assets.length, 1);
    assert.equal(next.assets[0]?.id, 'asset-1');
    assert.equal(next.variants.length, 1);
    assert.equal(next.variants[0]?.id, 'variant-1');
  });

  test('applies manual relation create update and delete events', () => {
    const store = useSpaceSessionStore.getState();
    store.hydrateFromSnapshot('space-relations', {
      assets: [asset()],
      variants: [variant()],
      lineage: [],
      relations: [],
      presence: [],
      rotationSets: [],
      rotationViews: [],
      tileSets: [],
      tilePositions: [],
      syncMode: 'full',
      updatedAt: 1,
    });

    const context = {
      syncModeRef: { current: 'full' as const },
      variantIdsRef: { current: new Set<string>() },
      sendMessage: () => {},
      markSynced: store.markSynced,
      setAssets: store.setAssets,
      setVariants: store.setVariants,
      setLineage: store.setLineage,
      setRelations: store.setRelations,
      setJobs: store.setJobs,
      setPresence: store.setPresence,
      setRotationSets: store.setRotationSets,
      setRotationViews: store.setRotationViews,
      setTileSets: store.setTileSets,
      setTilePositions: store.setTilePositions,
      setError: store.setError,
    };

    handleSpaceServerMessage({
      type: 'relation:created',
      relation: {
        id: 'relation-1',
        subject_type: 'asset',
        subject_asset_id: 'asset-1',
        subject_variant_id: null,
        object_type: 'variant',
        object_asset_id: null,
        object_variant_id: 'variant-1',
        relation_type: 'thumbnail_for',
        context: null,
        sort_index: 0,
        created_by: 'user-1',
        created_at: 1,
        updated_at: 1,
      },
    }, context);

    assert.equal(useSpaceSessionStore.getState().relations.length, 1);

    handleSpaceServerMessage({
      type: 'relation:updated',
      relation: {
        ...useSpaceSessionStore.getState().relations[0]!,
        relation_type: 'map_for',
        context: '{"label":"map"}',
      },
    }, context);

    assert.equal(useSpaceSessionStore.getState().relations[0]?.relation_type, 'map_for');
    assert.equal(useSpaceSessionStore.getState().relations[0]?.context, '{"label":"map"}');

    handleSpaceServerMessage({ type: 'relation:deleted', relationId: 'relation-1' }, context);

    assert.deepEqual(useSpaceSessionStore.getState().relations, []);
  });
});

describe('variant media helpers', () => {
  test('keeps image variants thumbnail-backed and image-ready', () => {
    const imageVariant = variant();

    assert.equal(isVariantReady(imageVariant), true);
    assert.equal(isVariantImageReady(imageVariant), true);
    assert.equal(isVariantForgeTrayReady(imageVariant), true);
    assert.equal(isVariantAudioReady(imageVariant), false);
    assert.equal(isVariantVideoReady(imageVariant), false);
    assert.equal(getVariantThumbnailUrl(imageVariant), '/api/images/images/space/variant_thumb.webp');
    assert.equal(getVariantMediaUrl(imageVariant, 'space-1'), '/api/spaces/space-1/variants/variant-1/media');
  });

  test('treats completed media-only variants as ready without image-only readiness', () => {
    const audioVariant = variant({
      media_kind: 'audio',
      image_key: null,
      thumb_key: null,
      media_key: 'media/space/theme.mp3',
      media_mime_type: 'audio/mpeg',
      media_width: null,
      media_height: null,
    });

    assert.equal(isVariantReady(audioVariant), true);
    assert.equal(isVariantImageReady(audioVariant), false);
    assert.equal(isVariantForgeTrayReady(audioVariant), true);
    assert.equal(isVariantAudioReady(audioVariant), true);
    assert.equal(isVariantVideoReady(audioVariant), false);
    assert.equal(getVariantThumbnailUrl(audioVariant), undefined);
    assert.equal(getVariantMediaUrl(audioVariant, 'space-1'), '/api/spaces/space-1/variants/variant-1/media');
  });

  test('requires canonical media for audio readiness', () => {
    const audioWithoutMedia = variant({
      media_kind: 'audio',
      image_key: 'images/space/audio-poster.png',
      thumb_key: null,
      media_key: null,
      media_mime_type: null,
      media_width: null,
      media_height: null,
    });

    assert.equal(isVariantReady(audioWithoutMedia), true);
    assert.equal(isVariantAudioReady(audioWithoutMedia), false);
    assert.equal(isVariantForgeTrayReady(audioWithoutMedia), false);
  });

  test('treats completed video variants as ready for native playback', () => {
    const videoVariant = variant({
      media_kind: 'video',
      image_key: null,
      thumb_key: null,
      media_key: 'media/space/clip.mp4',
      media_mime_type: 'video/mp4',
      media_duration_ms: 1200,
    });

    assert.equal(isVariantReady(videoVariant), true);
    assert.equal(isVariantImageReady(videoVariant), false);
    assert.equal(isVariantForgeTrayReady(videoVariant), true);
    assert.equal(isVariantAudioReady(videoVariant), false);
    assert.equal(isVariantVideoReady(videoVariant), true);
    assert.equal(getVariantThumbnailUrl(videoVariant), undefined);
    assert.equal(getVariantMediaUrl(videoVariant, 'space-1'), '/api/spaces/space-1/variants/variant-1/media');
  });

  test('does not mark pending media as ready', () => {
    const pendingVariant = variant({
      status: 'uploading',
      image_key: null,
      thumb_key: null,
      media_key: null,
    });

    assert.equal(isVariantReady(pendingVariant), false);
    assert.equal(isVariantImageReady(pendingVariant), false);
    assert.equal(isVariantForgeTrayReady(pendingVariant), false);
    assert.equal(isVariantAudioReady(pendingVariant), false);
    assert.equal(isVariantVideoReady(pendingVariant), false);
    assert.equal(getVariantMediaUrl(pendingVariant, 'space-1'), undefined);
  });
});
