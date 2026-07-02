import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { configureMediaCdnBaseUrl, getR2ImageUrl } from '../media-cdn';
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
import { handleSpaceServerMessage, type SpaceMessageContext } from '../space/handleSpaceServerMessage';
import { clearPendingJobContextsForTests, registerPendingJobContext } from '../space/jobContextRegistry';
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
      collections: [],
      collectionItems: [],
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
      collections: [],
      collectionItems: [],
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
  afterEach(() => {
    clearPendingJobContextsForTests();
  });

  function messageContext(store: ReturnType<typeof useSpaceSessionStore.getState>): SpaceMessageContext {
    return {
      syncModeRef: { current: null },
      variantIdsRef: { current: new Set<string>() },
      sendMessage: () => {},
      markSynced: store.markSynced,
      setAssets: store.setAssets,
      setVariants: store.setVariants,
      setLineage: store.setLineage,
      setCollections: store.setCollections,
      setCollectionItems: store.setCollectionItems,
      setJobs: store.setJobs,
      setPresence: store.setPresence,
      setRotationSets: store.setRotationSets,
      setRotationViews: store.setRotationViews,
      setTileSets: store.setTileSets,
      setTilePositions: store.setTilePositions,
      setError: store.setError,
    };
  }

  test('applies state updates even when no view callbacks are registered', () => {
    const store = useSpaceSessionStore.getState();
    store.hydrateFromSnapshot('space-1', null);

    handleSpaceServerMessage({
      type: 'sync:state',
      assets: [asset()],
      variants: [variant()],
      lineage: [],
      collections: [],
      collectionItems: [],
    }, messageContext(store));

    const next = useSpaceSessionStore.getState();
    assert.equal(next.hasSynced, true);
    assert.equal(next.assets.length, 1);
    assert.equal(next.assets[0]?.id, 'asset-1');
    assert.equal(next.variants.length, 1);
    assert.equal(next.variants[0]?.id, 'variant-1');
  });

  test('preserves generate and refine prompts in started job state', () => {
    const store = useSpaceSessionStore.getState();
    store.hydrateFromSnapshot('space-jobs', null);
    const context = messageContext(store);

    registerPendingJobContext('request-generate', {
      assetName: 'Generated Market Keyframe',
      operation: 'derive',
      prompt: 'Long readable market keyframe prompt',
    });
    handleSpaceServerMessage({
      type: 'generate:started',
      requestId: 'request-generate',
      jobId: 'job-generate',
      assetId: 'asset-generated',
      assetName: 'Generated Market Keyframe',
      prompt: 'Broadcast market keyframe prompt',
    }, context);

    registerPendingJobContext('request-refine', {
      assetId: 'asset-1',
      operation: 'refine',
      prompt: 'Long readable refinement prompt',
    });
    handleSpaceServerMessage({
      type: 'refine:started',
      requestId: 'request-refine',
      jobId: 'job-refine',
      assetId: 'asset-1',
      assetName: 'Asset One',
    }, context);

    handleSpaceServerMessage({
      type: 'generate:started',
      requestId: 'request-collaborator',
      jobId: 'job-collaborator',
      assetId: 'asset-collaborator',
      assetName: 'Collaborator Market Keyframe',
      prompt: 'Broadcast prompt visible to collaborators',
    }, context);

    const jobs = useSpaceSessionStore.getState().jobs;
    assert.equal(jobs.get('job-generate')?.prompt, 'Broadcast market keyframe prompt');
    assert.equal(jobs.get('job-generate')?.operation, 'derive');
    assert.equal(jobs.get('job-refine')?.prompt, 'Long readable refinement prompt');
    assert.equal(jobs.get('job-refine')?.operation, 'refine');
    assert.equal(jobs.get('job-collaborator')?.prompt, 'Broadcast prompt visible to collaborators');
  });

  test('applies live collection mutations and overview collection items', () => {
    const store = useSpaceSessionStore.getState();
    store.hydrateFromSnapshot('space-collections', null);
    const context = messageContext(store);

    handleSpaceServerMessage({
      type: 'sync:overview',
      assets: [asset()],
      variants: [variant()],
      collections: [{ id: 'collection-1', name: 'Cast', kind: 'cast', color: '#4f7cff', description: null, sort_index: 0, created_at: 1, updated_at: 1 }],
      collectionItems: [{ id: 'item-1', collection_id: 'collection-1', subject_type: 'asset', asset_id: 'asset-1', variant_id: null, role: 'lead', pinned_variant_id: null, sort_index: 0, created_by: 'user-1', created_at: 1, updated_at: 1 }],
    }, context);

    assert.equal(useSpaceSessionStore.getState().collections.length, 1);
    assert.equal(useSpaceSessionStore.getState().collectionItems[0]?.role, 'lead');

    handleSpaceServerMessage({
      type: 'collection:created',
      collection: { id: 'collection-2', name: 'Scenes', kind: 'scenes', color: '#c47d25', description: null, sort_index: 1, created_at: 2, updated_at: 2 },
    }, context);
    handleSpaceServerMessage({
      type: 'collection:updated',
      collection: { id: 'collection-2', name: 'Final Scenes', kind: 'scenes', color: '#c47d25', description: null, sort_index: -1, created_at: 2, updated_at: 3 },
    }, context);

    assert.deepEqual(
      useSpaceSessionStore.getState().collections.map((collection) => collection.id),
      ['collection-2', 'collection-1'],
    );
    assert.equal(useSpaceSessionStore.getState().collections[0]?.name, 'Final Scenes');

    handleSpaceServerMessage({
      type: 'collection_item:created',
      item: { id: 'item-2', collection_id: 'collection-1', subject_type: 'variant', asset_id: null, variant_id: 'variant-1', role: 'thumbnail', pinned_variant_id: null, sort_index: 1, created_by: 'user-1', created_at: 2, updated_at: 2 },
    }, context);
    handleSpaceServerMessage({
      type: 'collection_items:reordered',
      collectionId: 'collection-1',
      items: [
        { id: 'item-2', collection_id: 'collection-1', subject_type: 'variant', asset_id: null, variant_id: 'variant-1', role: 'thumbnail', pinned_variant_id: null, sort_index: 0, created_by: 'user-1', created_at: 2, updated_at: 3 },
        { id: 'item-1', collection_id: 'collection-1', subject_type: 'asset', asset_id: 'asset-1', variant_id: null, role: 'lead', pinned_variant_id: null, sort_index: 1, created_by: 'user-1', created_at: 1, updated_at: 3 },
      ],
    }, context);

    assert.deepEqual(
      useSpaceSessionStore.getState().collectionItems
        .filter((item) => item.collection_id === 'collection-1')
        .map((item) => item.id),
      ['item-2', 'item-1'],
    );

    handleSpaceServerMessage({
      type: 'collection_item:updated',
      item: { id: 'item-1', collection_id: 'collection-1', subject_type: 'asset', asset_id: 'asset-1', variant_id: null, role: 'hero', pinned_variant_id: 'variant-1', sort_index: 0, created_by: 'user-1', created_at: 1, updated_at: 2 },
    }, context);

    assert.equal(useSpaceSessionStore.getState().collectionItems[0]?.role, 'hero');
    assert.equal(useSpaceSessionStore.getState().collectionItems[0]?.pinned_variant_id, 'variant-1');

    handleSpaceServerMessage({
      type: 'collection_item:deleted',
      collectionId: 'collection-1',
      itemId: 'item-1',
    }, context);

    assert.deepEqual(useSpaceSessionStore.getState().collectionItems.map((item) => item.id), ['item-2']);

    handleSpaceServerMessage({
      type: 'collection:deleted',
      collectionId: 'collection-1',
    }, context);

    assert.equal(useSpaceSessionStore.getState().collections.some((collection) => collection.id === 'collection-1'), false);
    assert.equal(useSpaceSessionStore.getState().collectionItems.length, 0);
  });

  test('ignores legacy composition mutations in the simplified client state', () => {
    const store = useSpaceSessionStore.getState();
    store.hydrateFromSnapshot('space-1', null);
    const context = messageContext(store);
    const composition = {
      id: 'composition-1',
      name: 'Scene composition',
      description: null,
      status: 'draft' as const,
      output_asset_id: 'asset-1',
      output_variant_id: 'variant-1',
      metadata: '{}',
      sort_index: 0,
      created_by: 'user-1',
      created_at: 1,
      updated_at: 1,
    };
    const firstItem = {
      id: 'item-1',
      composition_id: 'composition-1',
      role: 'character' as const,
      asset_id: 'asset-1',
      variant_id: 'variant-1',
      metadata: '{}',
      sort_index: 0,
      created_by: 'user-1',
      created_at: 1,
      updated_at: 1,
    };
    const secondItem = {
      ...firstItem,
      id: 'item-2',
      sort_index: 1,
    };

    handleSpaceServerMessage({ type: 'composition:created', composition }, context);
    handleSpaceServerMessage({ type: 'composition_item:created', item: firstItem }, context);
    handleSpaceServerMessage({ type: 'composition_item:created', item: secondItem }, context);
    handleSpaceServerMessage({
      type: 'composition:updated',
      composition: { ...composition, name: 'Updated scene composition', updated_at: 2 },
    }, context);
    handleSpaceServerMessage({
      type: 'composition_items:reordered',
      compositionId: 'composition-1',
      items: [
        { ...secondItem, sort_index: 0, updated_at: 2 },
        { ...firstItem, sort_index: 1, updated_at: 2 },
      ],
    }, context);
    handleSpaceServerMessage({
      type: 'composition_item:deleted',
      compositionId: 'composition-1',
      itemId: 'item-1',
    }, context);

    const next = useSpaceSessionStore.getState();
    assert.equal('compositions' in next, false);
    assert.equal('compositionItems' in next, false);
  });

  test('preserves collection items across overview refreshes while ignoring legacy compositions', () => {
    const store = useSpaceSessionStore.getState();
    store.hydrateFromSnapshot('space-1', null);
    const context = messageContext(store);
    const collection = {
      id: 'collection-1',
      name: 'Cast',
      kind: 'cast' as const,
      color: '#4f7cff',
      description: null,
      sort_index: 0,
      created_by: 'user-1',
      created_at: 1,
      updated_at: 1,
    };
    const collectionItem = {
      id: 'collection-item-1',
      collection_id: 'collection-1',
      subject_type: 'asset' as const,
      asset_id: 'asset-1',
      variant_id: null,
      role: 'member',
      pinned_variant_id: 'variant-1',
      sort_index: 0,
      created_by: 'user-1',
      created_at: 1,
      updated_at: 1,
    };
    const composition = {
      id: 'composition-1',
      name: 'Scene composition',
      description: null,
      status: 'draft' as const,
      output_asset_id: 'asset-1',
      output_variant_id: 'variant-1',
      metadata: '{}',
      sort_index: 0,
      created_by: 'user-1',
      created_at: 1,
      updated_at: 1,
    };
    const compositionItem = {
      id: 'composition-item-1',
      composition_id: 'composition-1',
      role: 'character' as const,
      asset_id: 'asset-1',
      variant_id: 'variant-1',
      metadata: '{}',
      sort_index: 0,
      created_by: 'user-1',
      created_at: 1,
      updated_at: 1,
    };

    handleSpaceServerMessage({
      type: 'sync:state',
      assets: [asset()],
      variants: [variant()],
      lineage: [],
      collections: [collection],
      collectionItems: [collectionItem],
      compositions: [composition],
      compositionItems: [compositionItem],
    }, context);

    context.syncModeRef.current = 'overview';
    handleSpaceServerMessage({
      type: 'sync:overview',
      assets: [asset()],
      variants: [variant()],
      collections: [{ ...collection, name: 'Updated Cast', updated_at: 2 }],
      compositions: [{ ...composition, name: 'Overview scene composition', item_count: 1, updated_at: 2 }],
    }, context);

    const next = useSpaceSessionStore.getState();
    assert.equal(next.collections[0]?.name, 'Updated Cast');
    assert.deepEqual(next.collectionItems.map((item) => item.id), ['collection-item-1']);
    assert.equal('compositions' in next, false);
    assert.equal('compositionItems' in next, false);
  });
});

describe('variant media helpers', () => {
  afterEach(() => {
    configureMediaCdnBaseUrl(null);
  });

  test('keeps image variants thumbnail-backed and image-ready', () => {
    configureMediaCdnBaseUrl(null);
    const imageVariant = variant();

    assert.equal(isVariantReady(imageVariant), true);
    assert.equal(isVariantImageReady(imageVariant), true);
    assert.equal(isVariantForgeTrayReady(imageVariant), true);
    assert.equal(isVariantAudioReady(imageVariant), false);
    assert.equal(isVariantVideoReady(imageVariant), false);
    assert.equal(getVariantThumbnailUrl(imageVariant), '/api/images/images/space/variant_thumb.webp');
    assert.equal(getVariantMediaUrl(imageVariant, 'space-1'), '/api/spaces/space-1/variants/variant-1/media');
  });

  test('routes legacy image keys through the configured media CDN', () => {
    configureMediaCdnBaseUrl('https://cdn.makefx.app/');
    const imageVariant = variant();

    assert.equal(getR2ImageUrl('images/space/variant.png'), 'https://cdn.makefx.app/images/space/variant.png');
    assert.equal(getR2ImageUrl('thumbs/space/variant thumb.webp'), 'https://cdn.makefx.app/thumbs/space/variant%20thumb.webp');
    assert.equal(getVariantThumbnailUrl(imageVariant), 'https://cdn.makefx.app/images/space/variant_thumb.webp');
    assert.equal(getVariantMediaUrl(imageVariant, 'space-1'), '/api/spaces/space-1/variants/variant-1/media');
  });

  test('keeps non-legacy media keys on the worker fallback', () => {
    configureMediaCdnBaseUrl('https://cdn.makefx.app');

    assert.equal(getR2ImageUrl('media/space/video.mp4'), '/api/images/media/space/video.mp4');
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
