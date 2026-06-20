import { describe, test, mock, type Mock } from 'node:test';
import assert from 'node:assert/strict';
import { StyleController } from './StyleController';
import type { ControllerContext, BroadcastFn } from './types';
import type { SpaceRepository, SqlStorage } from '../repository/SpaceRepository';
import type { Env } from '../../../../core/types';
import type {
  Asset,
  CollectionItem,
  ServerMessage,
  SpaceCollection,
  SpaceStyle,
  StylePresetPreview,
  Variant,
  WebSocketMeta,
} from '../types';

// Helper to get mock from a function
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockFn = Mock<(...args: any[]) => any>;
const asMock = (fn: unknown): MockFn => fn as MockFn;

// ============================================================================
// Mock Factories
// ============================================================================

function createMockStyle(overrides: Partial<SpaceStyle> = {}): SpaceStyle {
  return {
    id: 'style-1',
    name: 'Default Style',
    description: 'Pixel art style',
    image_keys: '["styles/space-1/img1.png"]',
    enabled: 1,
    created_by: 'user-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  };
}

function createMockAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'style-asset-1',
    name: 'Legacy Style Reference',
    type: 'style-sheet',
    media_kind: 'image',
    tags: '["style-reference","legacy-space-style"]',
    parent_asset_id: null,
    active_variant_id: 'style-variant-1',
    created_by: 'user-1',
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function createMockVariant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: 'style-variant-1',
    asset_id: 'style-asset-1',
    media_kind: 'image',
    workflow_id: null,
    status: 'completed',
    error_message: null,
    image_key: 'styles/space-1/img1.png',
    thumb_key: 'styles/space-1/img1_thumb.webp',
    media_key: 'styles/space-1/img1.png',
    media_mime_type: 'image/png',
    media_size_bytes: 1024,
    media_width: null,
    media_height: null,
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
    generation_provenance: null,
    provider_metadata: null,
    recipe: '{}',
    starred: false,
    created_by: 'user-1',
    created_at: 1,
    updated_at: 1,
    plan_step_id: null,
    description: null,
    batch_id: null,
    quality_rating: null,
    rated_at: null,
    ...overrides,
  };
}

function createMockCollection(overrides: Partial<SpaceCollection> = {}): SpaceCollection {
  return {
    id: 'style-collection-1',
    name: 'Style References',
    kind: 'style_refs',
    color: null,
    description: 'Migrated references from the legacy space style.',
    sort_index: 0,
    created_by: 'user-1',
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function createMockCollectionItem(overrides: Partial<CollectionItem> = {}): CollectionItem {
  return {
    id: 'style-item-1',
    collection_id: 'style-collection-1',
    subject_type: 'asset',
    asset_id: 'style-asset-1',
    variant_id: null,
    role: 'style_ref',
    pinned_variant_id: 'style-variant-1',
    sort_index: 0,
    created_by: 'user-1',
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function createMockStylePreset(overrides: Partial<StylePresetPreview> = {}): StylePresetPreview {
  return {
    id: 'preset-1',
    name: 'Default Style',
    description: null,
    style_prompt: 'Pixel art style',
    collection_id: 'style-collection-1',
    enabled: 1,
    is_default: 1,
    created_by: 'user-1',
    created_at: 1,
    updated_at: 1,
    collection_name: 'Style References',
    reference_count: 1,
    style_reference_variant_ids: ['style-variant-1'],
    style_reference_image_keys: ['styles/space-1/img1.png'],
    ...overrides,
  };
}

function createMockRepo(): SpaceRepository {
  return {
    getActiveStyle: mock.fn(async () => null),
    getAllAssets: mock.fn(async () => []),
    getAllVariants: mock.fn(async () => []),
    listCollections: mock.fn(async () => []),
    listAllCollectionItems: mock.fn(async () => []),
    listStylePresetPreviews: mock.fn(async () => []),
    createStyle: mock.fn(async (data) =>
      createMockStyle({
        id: data.id,
        description: data.description,
        image_keys: JSON.stringify(data.imageKeys),
        enabled: data.enabled !== false ? 1 : 0,
        created_by: data.createdBy,
      })
    ),
    updateStyle: mock.fn(async (id, changes) => {
      const style = createMockStyle({ id });
      if (changes.description !== undefined) style.description = changes.description;
      if (changes.imageKeys !== undefined) style.image_keys = JSON.stringify(changes.imageKeys);
      if (changes.enabled !== undefined) style.enabled = changes.enabled ? 1 : 0;
      return style;
    }),
    deleteStyle: mock.fn(async () => true),
    toggleStyle: mock.fn(async (id, enabled) =>
      createMockStyle({ id, enabled: enabled ? 1 : 0 })
    ),
    backfillLegacySpaceStyle: mock.fn(async () => ({
      migrated: true,
      styleId: 'style-1',
      collectionId: 'collection-1',
      presetId: 'preset-1',
      assetIds: [],
      variantIds: [],
    })),
  } as unknown as SpaceRepository;
}

function createMockSql(): SqlStorage {
  return {
    exec: mock.fn(() => ({ toArray: () => [] })),
  } as unknown as SqlStorage;
}

function createMockContext(
  repoOverrides?: Partial<SpaceRepository>
): {
  ctx: ControllerContext;
  broadcasts: ServerMessage[];
  sent: ServerMessage[];
} {
  const broadcasts: ServerMessage[] = [];
  const sent: ServerMessage[] = [];
  const repo = { ...createMockRepo(), ...repoOverrides };

  const ctx: ControllerContext = {
    spaceId: 'space-1',
    repo: repo as SpaceRepository,
    env: {} as Env,
    sql: createMockSql() as SqlStorage,
    broadcast: mock.fn((msg: ServerMessage) => broadcasts.push(msg)) as BroadcastFn,
    send: mock.fn((ws: WebSocket, msg: ServerMessage) => sent.push(msg)),
    sendError: mock.fn(),
  };

  return { ctx, broadcasts, sent };
}

function createEditorMeta(): WebSocketMeta {
  return { userId: 'user-1', role: 'editor' };
}

function createViewerMeta(): WebSocketMeta {
  return { userId: 'user-1', role: 'viewer' };
}

// ============================================================================
// Tests
// ============================================================================

describe('StyleController', () => {
  describe('handleGetStyle', () => {
    test('returns null when no style exists', async () => {
      const { ctx, sent } = createMockContext();
      const controller = new StyleController(ctx);

      await controller.handleGetStyle({} as WebSocket);

      assert.strictEqual(sent.length, 1);
      assert.strictEqual(sent[0].type, 'style:state');
      assert.strictEqual(sent[0].style, null);
    });

    test('returns style when one exists', async () => {
      const existingStyle = createMockStyle();
      const { ctx, sent } = createMockContext({
        getActiveStyle: mock.fn(async () => existingStyle),
      });
      const controller = new StyleController(ctx);

      await controller.handleGetStyle({} as WebSocket);

      assert.strictEqual(sent.length, 1);
      assert.strictEqual(sent[0].type, 'style:state');
      const styleState = (sent[0] as { type: string; style: SpaceStyle }).style;
      assert.strictEqual(styleState.id, 'style-1');
      assert.strictEqual(styleState.description, 'Pixel art style');
    });
  });

  describe('handleSetStyle', () => {
    test('creates new style when none exists', async () => {
      const { ctx, broadcasts } = createMockContext();
      const controller = new StyleController(ctx);

      await controller.handleSetStyle(
        {} as WebSocket,
        createEditorMeta(),
        { description: 'New style', imageKeys: ['styles/space-1/a.png'], enabled: true }
      );

      // Verify createStyle was called
      assert.strictEqual(asMock(ctx.repo.createStyle).mock.calls.length, 1);
      const createCall = asMock(ctx.repo.createStyle).mock.calls[0].arguments[0];
      assert.strictEqual(createCall.description, 'New style');
      assert.deepStrictEqual(createCall.imageKeys, ['styles/space-1/a.png']);
      assert.strictEqual(asMock(ctx.repo.backfillLegacySpaceStyle).mock.calls.length, 1);

      // Verify broadcast
      assert.ok(broadcasts.some((b) => b.type === 'style:updated'));
    });

    test('updates existing style', async () => {
      const existingStyle = createMockStyle();
      const { ctx, broadcasts } = createMockContext({
        getActiveStyle: mock.fn(async () => existingStyle),
      });
      const controller = new StyleController(ctx);

      await controller.handleSetStyle(
        {} as WebSocket,
        createEditorMeta(),
        { description: 'Updated style', imageKeys: [], enabled: true }
      );

      // Verify updateStyle was called (not createStyle)
      assert.strictEqual(asMock(ctx.repo.updateStyle).mock.calls.length, 1);
      assert.strictEqual(asMock(ctx.repo.createStyle).mock.calls.length, 0);
      assert.strictEqual(asMock(ctx.repo.backfillLegacySpaceStyle).mock.calls.length, 1);

      // Verify broadcast
      assert.ok(broadcasts.some((b) => b.type === 'style:updated'));
    });

    test('broadcasts asset-backed state created by legacy style backfill', async () => {
      const asset = createMockAsset();
      const variant = createMockVariant();
      const collection = createMockCollection();
      const item = createMockCollectionItem();
      const preset = createMockStylePreset();
      let backfilled = false;
      const { ctx, broadcasts } = createMockContext({
        backfillLegacySpaceStyle: mock.fn(async () => {
          backfilled = true;
          return {
            migrated: true,
            styleId: 'style-1',
            collectionId: collection.id,
            presetId: 'preset-1',
            assetIds: [asset.id],
            variantIds: [variant.id],
          };
        }),
        getAllAssets: mock.fn(async () => (backfilled ? [asset] : [])),
        getAllVariants: mock.fn(async () => (backfilled ? [variant] : [])),
        listCollections: mock.fn(async () => (backfilled ? [collection] : [])),
        listAllCollectionItems: mock.fn(async () => (backfilled ? [item] : [])),
        listStylePresetPreviews: mock.fn(async () => (backfilled ? [preset] : [])),
      });
      const controller = new StyleController(ctx);

      await controller.handleSetStyle(
        {} as WebSocket,
        createEditorMeta(),
        { description: 'New style', imageKeys: ['styles/space-1/img1.png'], enabled: true }
      );

      assert.deepStrictEqual(
        broadcasts.map((message) => message.type),
        [
          'asset:created',
          'variant:created',
          'collection:created',
          'collection_item:created',
          'style_preset:created',
          'style:updated',
        ]
      );
      assert.strictEqual((broadcasts[0] as { asset: Asset }).asset.id, asset.id);
      assert.strictEqual((broadcasts[1] as { variant: Variant }).variant.id, variant.id);
      assert.strictEqual((broadcasts[2] as { collection: SpaceCollection }).collection.id, collection.id);
      assert.strictEqual((broadcasts[3] as { item: CollectionItem }).item.id, item.id);
      assert.strictEqual((broadcasts[4] as { preset: StylePresetPreview }).preset.id, preset.id);
    });

    test('broadcasts updated and removed collection items after legacy style image edits', async () => {
      const existingStyle = createMockStyle();
      const beforeItem = createMockCollectionItem({
        id: 'style-item-retained',
        pinned_variant_id: 'style-variant-retained',
        sort_index: 1,
        updated_at: 1,
      });
      const staleItem = createMockCollectionItem({
        id: 'style-item-stale',
        pinned_variant_id: 'style-variant-stale',
      });
      const afterItem = {
        ...beforeItem,
        sort_index: 0,
        updated_at: 2,
      };
      const beforePreset = createMockStylePreset({
        style_reference_variant_ids: ['style-variant-stale', 'style-variant-retained'],
        style_reference_image_keys: ['styles/space-1/stale.png', 'styles/space-1/retained.png'],
        reference_count: 2,
        updated_at: 1,
      });
      const afterPreset = createMockStylePreset({
        style_reference_variant_ids: ['style-variant-retained'],
        style_reference_image_keys: ['styles/space-1/retained.png'],
        reference_count: 1,
        updated_at: 2,
      });
      let backfilled = false;
      const { ctx, broadcasts } = createMockContext({
        getActiveStyle: mock.fn(async () => existingStyle),
        backfillLegacySpaceStyle: mock.fn(async () => {
          backfilled = true;
          return {
            migrated: true,
            styleId: 'style-1',
            collectionId: 'style-collection-1',
            presetId: 'preset-1',
            assetIds: ['style-asset-retained'],
            variantIds: ['style-variant-retained'],
          };
        }),
        listAllCollectionItems: mock.fn(async () => (backfilled ? [afterItem] : [beforeItem, staleItem])),
        listStylePresetPreviews: mock.fn(async () => (backfilled ? [afterPreset] : [beforePreset])),
      });
      const controller = new StyleController(ctx);

      await controller.handleSetStyle(
        {} as WebSocket,
        createEditorMeta(),
        { description: 'Updated style', imageKeys: ['styles/space-1/retained.png'], enabled: true }
      );

      assert.ok(
        broadcasts.some((message) =>
          message.type === 'collection_item:deleted' &&
          message.itemId === staleItem.id &&
          message.collectionId === staleItem.collection_id
        )
      );
      assert.ok(
        broadcasts.some((message) =>
          message.type === 'collection_item:updated' &&
          message.item.id === afterItem.id &&
          message.item.sort_index === 0
        )
      );
      assert.ok(
        broadcasts.some((message) =>
          message.type === 'style_preset:updated' &&
          message.preset.id === afterPreset.id &&
          message.preset.reference_count === 1
        )
      );
      assert.strictEqual(broadcasts.at(-1)?.type, 'style:updated');
    });

    test('validates max 5 images', async () => {
      const { ctx } = createMockContext();
      const controller = new StyleController(ctx);

      await assert.rejects(
        controller.handleSetStyle(
          {} as WebSocket,
          createEditorMeta(),
          {
            description: 'Too many images',
            imageKeys: ['a.png', 'b.png', 'c.png', 'd.png', 'e.png', 'f.png'],
          }
        ),
        /at most 5/
      );
    });

    test('requires editor permission', async () => {
      const { ctx } = createMockContext();
      const controller = new StyleController(ctx);

      await assert.rejects(
        controller.handleSetStyle(
          {} as WebSocket,
          createViewerMeta(),
          { description: 'test', imageKeys: [] }
        ),
        /viewer/i
      );
    });
  });

  describe('handleDeleteStyle', () => {
    test('deletes existing style and broadcasts', async () => {
      const existingStyle = createMockStyle();
      const preset = createMockStylePreset();
      let deleted = false;
      const { ctx, broadcasts } = createMockContext({
        getActiveStyle: mock.fn(async () => existingStyle),
        deleteStyle: mock.fn(async () => {
          deleted = true;
          return true;
        }),
        listStylePresetPreviews: mock.fn(async () => (deleted ? [] : [preset])),
      });
      const controller = new StyleController(ctx);

      await controller.handleDeleteStyle({} as WebSocket, createEditorMeta());

      assert.strictEqual(asMock(ctx.repo.deleteStyle).mock.calls.length, 1);
      assert.strictEqual(asMock(ctx.repo.deleteStyle).mock.calls[0].arguments[0], 'style-1');
      assert.deepStrictEqual(
        broadcasts.map((message) => message.type),
        ['style_preset:deleted', 'style:deleted']
      );
      assert.strictEqual((broadcasts[0] as { presetId: string }).presetId, preset.id);
    });

    test('broadcasts style:deleted even when no style exists', async () => {
      const { ctx, broadcasts } = createMockContext();
      const controller = new StyleController(ctx);

      await controller.handleDeleteStyle({} as WebSocket, createEditorMeta());

      assert.strictEqual(asMock(ctx.repo.deleteStyle).mock.calls.length, 0);
      assert.ok(broadcasts.some((b) => b.type === 'style:deleted'));
    });

    test('requires editor permission', async () => {
      const { ctx } = createMockContext();
      const controller = new StyleController(ctx);

      await assert.rejects(
        controller.handleDeleteStyle({} as WebSocket, createViewerMeta()),
        /viewer/i
      );
    });
  });

  describe('handleToggleStyle', () => {
    test('toggles enabled flag and broadcasts', async () => {
      const existingStyle = createMockStyle({ enabled: 1 });
      const { ctx, broadcasts } = createMockContext({
        getActiveStyle: mock.fn(async () => existingStyle),
      });
      const controller = new StyleController(ctx);

      await controller.handleToggleStyle({} as WebSocket, createEditorMeta(), false);

      assert.strictEqual(asMock(ctx.repo.toggleStyle).mock.calls.length, 1);
      assert.strictEqual(asMock(ctx.repo.toggleStyle).mock.calls[0].arguments[1], false);
      assert.strictEqual(asMock(ctx.repo.backfillLegacySpaceStyle).mock.calls.length, 1);
      assert.ok(broadcasts.some((b) => b.type === 'style:updated'));
    });

    test('broadcasts asset-backed backfill changes when toggling a legacy style', async () => {
      const existingStyle = createMockStyle({ enabled: 0 });
      const asset = createMockAsset();
      const variant = createMockVariant();
      const preset = createMockStylePreset();
      let backfilled = false;
      const { ctx, broadcasts } = createMockContext({
        getActiveStyle: mock.fn(async () => existingStyle),
        backfillLegacySpaceStyle: mock.fn(async () => {
          backfilled = true;
          return {
            migrated: true,
            styleId: 'style-1',
            collectionId: 'style-collection-1',
            presetId: 'preset-1',
            assetIds: [asset.id],
            variantIds: [variant.id],
          };
        }),
        getAllAssets: mock.fn(async () => (backfilled ? [asset] : [])),
        getAllVariants: mock.fn(async () => (backfilled ? [variant] : [])),
        listStylePresetPreviews: mock.fn(async () => (backfilled ? [preset] : [])),
      });
      const controller = new StyleController(ctx);

      await controller.handleToggleStyle({} as WebSocket, createEditorMeta(), true);

      assert.deepStrictEqual(
        broadcasts.map((message) => message.type),
        ['asset:created', 'variant:created', 'style_preset:created', 'style:updated']
      );
    });

    test('broadcasts migrated style preset updates when toggling a legacy style', async () => {
      const existingStyle = createMockStyle({ enabled: 1 });
      const beforePreset = createMockStylePreset({ enabled: 1, updated_at: 1 });
      const afterPreset = createMockStylePreset({ enabled: 0, updated_at: 2 });
      let backfilled = false;
      const { ctx, broadcasts } = createMockContext({
        getActiveStyle: mock.fn(async () => existingStyle),
        backfillLegacySpaceStyle: mock.fn(async () => {
          backfilled = true;
          return {
            migrated: true,
            styleId: 'style-1',
            collectionId: 'style-collection-1',
            presetId: 'preset-1',
            assetIds: [],
            variantIds: [],
          };
        }),
        listStylePresetPreviews: mock.fn(async () => (backfilled ? [afterPreset] : [beforePreset])),
      });
      const controller = new StyleController(ctx);

      await controller.handleToggleStyle({} as WebSocket, createEditorMeta(), false);

      assert.ok(
        broadcasts.some((message) =>
          message.type === 'style_preset:updated' &&
          message.preset.id === afterPreset.id &&
          message.preset.enabled === 0
        )
      );
      assert.strictEqual(broadcasts.at(-1)?.type, 'style:updated');
    });

    test('throws when no style configured', async () => {
      const { ctx } = createMockContext();
      const controller = new StyleController(ctx);

      await assert.rejects(
        controller.handleToggleStyle({} as WebSocket, createEditorMeta(), true),
        /No style configured/
      );
    });

    test('requires editor permission', async () => {
      const { ctx } = createMockContext();
      const controller = new StyleController(ctx);

      await assert.rejects(
        controller.handleToggleStyle({} as WebSocket, createViewerMeta(), true),
        /viewer/i
      );
    });
  });
});
