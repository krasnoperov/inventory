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
      rotationSets: [],
      rotationViews: [],
      tileSets: [],
      tilePositions: [],
      style: null,
    })),
    getOverviewState: mock.fn(async () => ({
      assets: [],
      variants: [],
      rotationSets: [],
      rotationViews: [],
      tileSets: [],
      tilePositions: [],
      style: null,
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
        rotationSets: [],
        rotationViews: [],
        tileSets: [],
        tilePositions: [],
        style: null,
      })),
    });
    const controller = new SyncController(ctx, createPresence(presence));

    await controller.handleOverviewRequest({} as WebSocket);

    assert.strictEqual(asMock(ctx.repo.getOverviewState).mock.calls.length, 1);
    assert.strictEqual(asMock(ctx.repo.getFullState).mock.calls.length, 0);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].type, 'sync:overview');
    assert.deepStrictEqual(sent[0].presence, presence);
    assert.ok(!('lineage' in sent[0]));
  });
});
