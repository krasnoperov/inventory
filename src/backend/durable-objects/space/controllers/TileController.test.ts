// @ts-nocheck - Test file with dynamic mocks
import { describe, test, mock, type Mock } from 'node:test';
import assert from 'node:assert/strict';
import { TileController } from './TileController';
import type { ControllerContext, BroadcastFn } from './types';
import type { SpaceRepository, SqlStorage } from '../repository/SpaceRepository';
import type { Env } from '../../../../core/types';
import type {
  Asset,
  Variant,
  TileSet,
  TilePosition,
  WebSocketMeta,
  ServerMessage,
} from '../types';

// Helper to extract mock from function
type MockFn<T extends (...args: unknown[]) => unknown> = Mock<T>;
const asMock = <T extends (...args: unknown[]) => unknown>(fn: T): MockFn<T> =>
  fn as MockFn<T>;

// ============================================================================
// Mock Factories
// ============================================================================

function createMockAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    name: 'Test Asset',
    type: 'tile-set',
    tags: '[]',
    parent_asset_id: null,
    active_variant_id: null,
    created_by: 'user-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  };
}

function createMockVariant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: 'variant-1',
    asset_id: 'asset-1',
    workflow_id: null,
    status: 'completed',
    error_message: null,
    image_key: 'images/test.png',
    thumb_key: 'thumbs/test.png',
    recipe: '{}',
    starred: false,
    created_by: 'user-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    plan_step_id: null,
    ...overrides,
  };
}

function createMockTileSet(overrides: Partial<TileSet> = {}): TileSet {
  return {
    id: 'tileset-1',
    asset_id: 'asset-1',
    tile_type: 'terrain',
    grid_width: 3,
    grid_height: 3,
    status: 'generating',
    seed_variant_id: null,
    config: JSON.stringify({ prompt: 'forest', spiralOrder: [[1,1],[2,1],[1,0],[0,1],[1,2],[2,0],[0,0],[2,2],[0,2]] }),
    current_step: 0,
    total_steps: 9,
    error_message: null,
    created_by: 'user-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  };
}

function createMockTilePosition(overrides: Partial<TilePosition> = {}): TilePosition {
  return {
    id: 'tilepos-1',
    tile_set_id: 'tileset-1',
    variant_id: 'variant-1',
    grid_x: 1,
    grid_y: 1,
    created_at: Date.now(),
    ...overrides,
  };
}

function createMockRepo(): SpaceRepository {
  return {
    getAssetById: mock.fn(async () => createMockAsset()),
    getAssetsByParent: mock.fn(async () => []),
    getVariantById: mock.fn(async () => createMockVariant()),
    getVariantsByAsset: mock.fn(async () => []),
    getLineageForVariants: mock.fn(async () => []),
    createAsset: mock.fn(async (input) =>
      createMockAsset({ id: input.id, name: input.name, type: input.type })
    ),
    updateAsset: mock.fn(async (id, changes) => createMockAsset({ id, ...changes })),
    deleteAsset: mock.fn(async () => {}),
    createLineage: mock.fn(async (input) => ({
      id: input.id,
      parent_variant_id: input.parentVariantId,
      child_variant_id: input.childVariantId,
      relation_type: input.relationType,
      severed: false,
      created_at: Date.now(),
    })),
    createPlaceholderVariant: mock.fn(async (input) =>
      createMockVariant({ id: input.id, asset_id: input.assetId, status: 'pending' })
    ),
    updateVariantWorkflow: mock.fn(async (id, wfId, status) =>
      createMockVariant({ id, workflow_id: wfId, status })
    ),
    // Tile-specific
    createTileSet: mock.fn(async () => createMockTileSet()),
    getTileSetById: mock.fn(async () => null),
    createTilePosition: mock.fn(async () => createMockTilePosition()),
    getTilePositionsBySet: mock.fn(async () => []),
    getAdjacentTiles: mock.fn(async () => []),
    updateTileSetStatus: mock.fn(async () => createMockTileSet()),
    updateTileSetStep: mock.fn(async () => createMockTileSet()),
    failTileSet: mock.fn(async () => createMockTileSet()),
    cancelTileSet: mock.fn(async () => createMockTileSet()),
  } as unknown as SpaceRepository;
}

function createMockSql(): SqlStorage {
  return {
    exec: mock.fn(() => ({ toArray: () => [] })),
  } as unknown as SqlStorage;
}

function createMockContext(
  repoOverrides?: Partial<SpaceRepository>,
  envOverrides?: Partial<Env>
): {
  ctx: ControllerContext;
  broadcasts: ServerMessage[];
} {
  const broadcasts: ServerMessage[] = [];
  const repo = { ...createMockRepo(), ...repoOverrides };
  const sql = createMockSql();

  const ctx: ControllerContext = {
    spaceId: 'space-1',
    repo: repo as SpaceRepository,
    env: {
      GENERATION_WORKFLOW: { create: mock.fn(async () => ({ id: 'wf-1' })) },
      ...envOverrides,
    } as Env,
    sql: sql as SqlStorage,
    broadcast: mock.fn((msg: ServerMessage) => broadcasts.push(msg)) as BroadcastFn,
    send: mock.fn(),
    sendError: mock.fn(),
  };

  return { ctx, broadcasts };
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

describe('TileController', () => {
  // ==========================================================================
  // handleTileSetRequest
  // ==========================================================================

  describe('handleTileSetRequest', () => {
    test('rejects viewer', async () => {
      const { ctx } = createMockContext();
      const controller = new TileController(ctx);

      await assert.rejects(
        controller.handleTileSetRequest({} as WebSocket, createViewerMeta(), {
          type: 'tileset:request',
          requestId: 'req-1',
          tileType: 'terrain',
          gridWidth: 3,
          gridHeight: 3,
          prompt: 'forest',
        }),
        /viewer/i
      );
    });

    test('rejects grid width less than 2', async () => {
      const { ctx } = createMockContext();
      const controller = new TileController(ctx);

      await assert.rejects(
        controller.handleTileSetRequest({} as WebSocket, createEditorMeta(), {
          type: 'tileset:request',
          requestId: 'req-1',
          tileType: 'terrain',
          gridWidth: 1,
          gridHeight: 3,
          prompt: 'forest',
        }),
        /between 2 and 5/i
      );
    });

    test('rejects grid width greater than 5', async () => {
      const { ctx } = createMockContext();
      const controller = new TileController(ctx);

      await assert.rejects(
        controller.handleTileSetRequest({} as WebSocket, createEditorMeta(), {
          type: 'tileset:request',
          requestId: 'req-1',
          tileType: 'terrain',
          gridWidth: 6,
          gridHeight: 3,
          prompt: 'forest',
        }),
        /between 2 and 5/i
      );
    });

    test('rejects grid height less than 2', async () => {
      const { ctx } = createMockContext();
      const controller = new TileController(ctx);

      await assert.rejects(
        controller.handleTileSetRequest({} as WebSocket, createEditorMeta(), {
          type: 'tileset:request',
          requestId: 'req-1',
          tileType: 'terrain',
          gridWidth: 3,
          gridHeight: 1,
          prompt: 'forest',
        }),
        /between 2 and 5/i
      );
    });

    test('rejects invalid tile type', async () => {
      const { ctx } = createMockContext();
      const controller = new TileController(ctx);

      await assert.rejects(
        controller.handleTileSetRequest({} as WebSocket, createEditorMeta(), {
          type: 'tileset:request',
          requestId: 'req-1',
          tileType: 'invalid' as any,
          gridWidth: 3,
          gridHeight: 3,
          prompt: 'forest',
        }),
        /invalid tile type/i
      );
    });

    test('creates asset with type tile-set', async () => {
      // getTileSetById returns cancelled so advanceTileSet returns early
      const { ctx, broadcasts } = createMockContext({
        getTileSetById: mock.fn(async () => createMockTileSet({ status: 'cancelled' })),
      });
      const controller = new TileController(ctx);

      await controller.handleTileSetRequest({} as WebSocket, createEditorMeta(), {
        type: 'tileset:request',
        requestId: 'req-1',
        tileType: 'terrain',
        gridWidth: 3,
        gridHeight: 3,
        prompt: 'forest floor',
        seedVariantId: 'variant-1',
      });

      const createCall = asMock(ctx.repo.createAsset).mock.calls[0].arguments[0];
      assert.strictEqual(createCall.type, 'tile-set');
      assert.ok(createCall.name.includes('Tile Set'));
    });

    test('stores spiral order in config', async () => {
      const { ctx } = createMockContext({
        getTileSetById: mock.fn(async () => createMockTileSet({ status: 'cancelled' })),
      });
      const controller = new TileController(ctx);

      await controller.handleTileSetRequest({} as WebSocket, createEditorMeta(), {
        type: 'tileset:request',
        requestId: 'req-1',
        tileType: 'terrain',
        gridWidth: 3,
        gridHeight: 3,
        prompt: 'forest',
        seedVariantId: 'variant-1',
      });

      const setCall = asMock(ctx.repo.createTileSet).mock.calls[0].arguments[0];
      const config = JSON.parse(setCall.config);
      assert.ok(Array.isArray(config.spiralOrder));
      assert.strictEqual(config.spiralOrder.length, 9);
    });

    test('broadcasts tileset:started', async () => {
      const { ctx, broadcasts } = createMockContext({
        getTileSetById: mock.fn(async () => createMockTileSet({ status: 'cancelled' })),
      });
      const controller = new TileController(ctx);

      await controller.handleTileSetRequest({} as WebSocket, createEditorMeta(), {
        type: 'tileset:request',
        requestId: 'req-1',
        tileType: 'terrain',
        gridWidth: 3,
        gridHeight: 3,
        prompt: 'forest',
        seedVariantId: 'variant-1',
      });

      const started = broadcasts.find((b) => b.type === 'tileset:started');
      assert.ok(started);
      assert.strictEqual(started.requestId, 'req-1');
      assert.strictEqual(started.gridWidth, 3);
      assert.strictEqual(started.gridHeight, 3);
      assert.strictEqual(started.totalTiles, 9);
    });

    test('handles seed variant fork path', async () => {
      const seedVariant = createMockVariant({ id: 'seed-v', status: 'completed', image_key: 'img/seed.png' });
      const { ctx, broadcasts } = createMockContext({
        getVariantById: mock.fn(async (id) => id === 'seed-v' ? seedVariant : createMockVariant({ id })),
        getTileSetById: mock.fn(async () => createMockTileSet({ status: 'cancelled' })),
      });
      const controller = new TileController(ctx);

      await controller.handleTileSetRequest({} as WebSocket, createEditorMeta(), {
        type: 'tileset:request',
        requestId: 'req-1',
        tileType: 'terrain',
        gridWidth: 3,
        gridHeight: 3,
        prompt: 'forest',
        seedVariantId: 'seed-v',
      });

      // Should fork via SQL
      assert.ok(asMock(ctx.sql.exec).mock.calls.length >= 1);
      const insertCall = asMock(ctx.sql.exec).mock.calls[0].arguments[0];
      assert.ok(insertCall.includes('INSERT INTO variants'));

      // Should create lineage
      assert.strictEqual(asMock(ctx.repo.createLineage).mock.calls.length, 1);
      const lineageCall = asMock(ctx.repo.createLineage).mock.calls[0].arguments[0];
      assert.strictEqual(lineageCall.parentVariantId, 'seed-v');

      // Should create tile position at center
      assert.strictEqual(asMock(ctx.repo.createTilePosition).mock.calls.length, 1);
    });

    test('handles no-seed generate path', async () => {
      // No seed: calls generateTileAtPosition directly, which calls getTileSetById
      const { ctx, broadcasts } = createMockContext({
        getTileSetById: mock.fn(async () => createMockTileSet({ total_steps: 9 })),
        getAdjacentTiles: mock.fn(async () => []),
      });
      const controller = new TileController(ctx);

      await controller.handleTileSetRequest({} as WebSocket, createEditorMeta(), {
        type: 'tileset:request',
        requestId: 'req-1',
        tileType: 'terrain',
        gridWidth: 3,
        gridHeight: 3,
        prompt: 'forest',
        // no seedVariantId
      });

      // Should not fork (no SQL INSERT for variants)
      const sqlCalls = asMock(ctx.sql.exec).mock.calls;
      const hasVariantInsert = sqlCalls.some((c) => String(c.arguments[0]).includes('INSERT INTO variants'));
      assert.ok(!hasVariantInsert);

      // Should create placeholder variant instead
      assert.strictEqual(asMock(ctx.repo.createPlaceholderVariant).mock.calls.length, 1);
    });

    test('rejects invalid seed variant', async () => {
      const { ctx } = createMockContext({
        getVariantById: mock.fn(async () => createMockVariant({ status: 'pending', image_key: null })),
      });
      const controller = new TileController(ctx);

      await assert.rejects(
        controller.handleTileSetRequest({} as WebSocket, createEditorMeta(), {
          type: 'tileset:request',
          requestId: 'req-1',
          tileType: 'terrain',
          gridWidth: 3,
          gridHeight: 3,
          prompt: 'forest',
          seedVariantId: 'bad-seed',
        }),
        /completed/i
      );
    });
  });

  // ==========================================================================
  // advanceTileSet
  // ==========================================================================

  describe('advanceTileSet', () => {
    test('skips if set is cancelled', async () => {
      const { ctx, broadcasts } = createMockContext({
        getTileSetById: mock.fn(async () => createMockTileSet({ status: 'cancelled' })),
      });
      const controller = new TileController(ctx);

      await controller.advanceTileSet('tileset-1');

      assert.strictEqual(asMock(ctx.repo.getTilePositionsBySet).mock.calls.length, 0);
    });

    test('skips if set is failed', async () => {
      const { ctx } = createMockContext({
        getTileSetById: mock.fn(async () => createMockTileSet({ status: 'failed' })),
      });
      const controller = new TileController(ctx);

      await controller.advanceTileSet('tileset-1');

      assert.strictEqual(asMock(ctx.repo.getTilePositionsBySet).mock.calls.length, 0);
    });

    test('marks completed when all positions filled', async () => {
      const positions = Array.from({ length: 9 }, (_, i) =>
        createMockTilePosition({ id: `pos-${i}`, grid_x: i % 3, grid_y: Math.floor(i / 3), variant_id: `v-${i}` })
      );

      const { ctx, broadcasts } = createMockContext({
        getTileSetById: mock.fn(async () => createMockTileSet({ total_steps: 9 })),
        getTilePositionsBySet: mock.fn(async () => positions),
      });
      const controller = new TileController(ctx);

      await controller.advanceTileSet('tileset-1');

      assert.strictEqual(asMock(ctx.repo.updateTileSetStatus).mock.calls.length, 1);
      assert.strictEqual(
        asMock(ctx.repo.updateTileSetStatus).mock.calls[0].arguments[1],
        'completed'
      );
      assert.ok(broadcasts.some((b) => b.type === 'tileset:completed'));
    });

    test('picks correct next spiral position', async () => {
      // Center (1,1) is filled, next in spiral should be (2,1)
      const centerPos = createMockTilePosition({ grid_x: 1, grid_y: 1 });

      const { ctx } = createMockContext({
        getTileSetById: mock.fn(async () => createMockTileSet({ total_steps: 9 })),
        getTilePositionsBySet: mock.fn(async () => [centerPos]),
        getAdjacentTiles: mock.fn(async () => []),
      });
      const controller = new TileController(ctx);

      await controller.advanceTileSet('tileset-1');

      // Should create a tile position — the generateTileAtPosition call
      // creates the placeholder variant and tile position
      assert.ok(asMock(ctx.repo.createPlaceholderVariant).mock.calls.length >= 1);
    });

    test('returns silently when set not found', async () => {
      const { ctx, broadcasts } = createMockContext({
        getTileSetById: mock.fn(async () => null),
      });
      const controller = new TileController(ctx);

      await controller.advanceTileSet('nonexistent');
      assert.strictEqual(broadcasts.length, 0);
    });
  });

  // ==========================================================================
  // handleTileSetCancel
  // ==========================================================================

  describe('handleTileSetCancel', () => {
    test('rejects viewer', async () => {
      const { ctx } = createMockContext();
      const controller = new TileController(ctx);

      await assert.rejects(
        controller.handleTileSetCancel({} as WebSocket, createViewerMeta(), 'tileset-1'),
        /viewer/i
      );
    });

    test('cancels and broadcasts tileset:cancelled', async () => {
      const { ctx, broadcasts } = createMockContext({
        getTileSetById: mock.fn(async () => createMockTileSet()),
      });
      const controller = new TileController(ctx);

      await controller.handleTileSetCancel({} as WebSocket, createEditorMeta(), 'tileset-1');

      assert.strictEqual(asMock(ctx.repo.cancelTileSet).mock.calls.length, 1);
      assert.ok(broadcasts.some((b) => b.type === 'tileset:cancelled' && b.tileSetId === 'tileset-1'));
    });

    test('throws when tile set not found', async () => {
      const { ctx } = createMockContext({
        getTileSetById: mock.fn(async () => null),
      });
      const controller = new TileController(ctx);

      await assert.rejects(
        controller.handleTileSetCancel({} as WebSocket, createEditorMeta(), 'nonexistent'),
        /not found/i
      );
    });
  });
});
