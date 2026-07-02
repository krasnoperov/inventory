// @ts-nocheck - Test file with dynamic mocks
import { describe, test, mock, type Mock } from 'node:test';
import assert from 'node:assert/strict';
import { SyncController } from './SyncController';
import type { PresenceController } from './PresenceController';
import type { ControllerContext, BroadcastFn, SendFn } from './types';
import type { SpaceRepository, SqlStorage } from '../repository/SpaceRepository';
import type { Env } from '../../../../core/types';
import type { ServerMessage, UserPresence } from '../types';

const asMock = <T extends (...args: unknown[]) => unknown>(fn: T): Mock<T> =>
  fn as Mock<T>;

function createContext(repoOverrides: Partial<SpaceRepository>): {
  ctx: ControllerContext;
  sent: ServerMessage[];
} {
  const sent: ServerMessage[] = [];
  const repo = {
    getFullState: mock.fn(async () => ({
      assets: [],
      variants: [],
      lineage: [],
      collections: [],
      collectionItems: [],
    })),
    getOverviewState: mock.fn(async () => ({
      assets: [],
      variants: [],
      collections: [],
      collectionItems: [],
    })),
    ...repoOverrides,
  } as unknown as SpaceRepository;

  const ctx: ControllerContext = {
    spaceId: 'space-1',
    repo,
    env: {} as Env,
    sql: { exec: mock.fn(() => ({ toArray: () => [] })) } as unknown as SqlStorage,
    broadcast: mock.fn() as BroadcastFn,
    send: mock.fn((_ws: WebSocket, message: ServerMessage) => sent.push(message)) as SendFn,
    sendError: mock.fn(),
  };

  return { ctx, sent };
}

function createPresence(presence: UserPresence[]): PresenceController {
  return {
    getPresenceData: mock.fn(() => presence),
  } as unknown as PresenceController;
}

describe('SyncController', () => {
  test('handleOverviewRequest sends active overview state without lineage', async () => {
    const presence = [{ userId: 'user-1', viewing: null, lastSeen: 1 }];
    const { ctx, sent } = createContext({
      getOverviewState: mock.fn(async () => ({
        assets: [{ id: 'asset-1', active_variant_id: 'variant-1' }],
        variants: [{ id: 'variant-1', asset_id: 'asset-1' }],
        collections: [{ id: 'collection-1', name: 'Scene Kit', kind: 'scenes', color: '#2f9e73', item_count: 2 }],
        collectionItems: [{ id: 'collection-item-1', collection_id: 'collection-1', asset_id: 'asset-1' }],
      })),
    });
    const controller = new SyncController(ctx, createPresence(presence));

    await controller.handleOverviewRequest({} as WebSocket);

    assert.strictEqual(asMock(ctx.repo.getOverviewState).mock.calls.length, 1);
    assert.strictEqual(asMock(ctx.repo.getFullState).mock.calls.length, 0);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].type, 'sync:overview');
    assert.deepStrictEqual(sent[0].presence, presence);
    assert.deepStrictEqual(sent[0].collections, [{ id: 'collection-1', name: 'Scene Kit', kind: 'scenes', color: '#2f9e73', item_count: 2 }]);
    assert.deepStrictEqual(sent[0].collectionItems, [{ id: 'collection-item-1', collection_id: 'collection-1', asset_id: 'asset-1' }]);
    assert.deepStrictEqual(Object.keys(sent[0]).sort(), [
      'assets',
      'collectionItems',
      'collections',
      'presence',
      'type',
      'variants',
    ]);
  });

  test('handleSyncRequest includes full organization records without changing lineage', async () => {
    const presence = [{ userId: 'user-1', viewing: null, lastSeen: 1 }];
    const { ctx, sent } = createContext({
      getFullState: mock.fn(async () => ({
        assets: [],
        variants: [],
        lineage: [{ id: 'lineage-1', parent_variant_id: 'v1', child_variant_id: 'v2', relation_type: 'derived' }],
        collections: [{ id: 'collection-1', name: 'Scene Kit' }],
        collectionItems: [{ id: 'collection-item-1', collection_id: 'collection-1' }],
      })),
    });
    const controller = new SyncController(ctx, createPresence(presence));

    await controller.handleSyncRequest({} as WebSocket);

    assert.strictEqual(sent[0].type, 'sync:state');
    assert.deepStrictEqual(sent[0].lineage, [{ id: 'lineage-1', parent_variant_id: 'v1', child_variant_id: 'v2', relation_type: 'derived' }]);
    assert.deepStrictEqual(sent[0].collections, [{ id: 'collection-1', name: 'Scene Kit' }]);
    assert.deepStrictEqual(sent[0].collectionItems, [{ id: 'collection-item-1', collection_id: 'collection-1' }]);
    assert.deepStrictEqual(Object.keys(sent[0]).sort(), [
      'assets',
      'collectionItems',
      'collections',
      'lineage',
      'presence',
      'type',
      'variants',
    ]);
  });
});
