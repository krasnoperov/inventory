// @ts-nocheck - Test file with lightweight controller mocks
import { describe, test, mock, type Mock } from 'node:test';
import assert from 'node:assert/strict';
import { PresenceController } from './PresenceController';
import type { ControllerContext, BroadcastFn, SendFn } from './types';
import type { SpaceRepository, SqlStorage } from '../repository/SpaceRepository';
import type { Env } from '../../../../core/types';
import type { ServerMessage, WebSocketMeta } from '../types';

const asMock = <T extends (...args: unknown[]) => unknown>(fn: T): Mock<T> =>
  fn as Mock<T>;

function createContext(): {
  ctx: ControllerContext;
  broadcasts: ServerMessage[];
} {
  const broadcasts: ServerMessage[] = [];

  const ctx: ControllerContext = {
    spaceId: 'space-1',
    repo: {} as SpaceRepository,
    env: {} as Env,
    sql: { exec: mock.fn(() => ({ toArray: () => [] })) } as unknown as SqlStorage,
    broadcast: mock.fn((message: ServerMessage) => broadcasts.push(message)) as BroadcastFn,
    send: mock.fn() as SendFn,
    sendError: mock.fn(),
  };

  return { ctx, broadcasts };
}

function meta(userId: string, clientSessionId: string): WebSocketMeta {
  return {
    userId,
    clientSessionId,
    role: 'editor',
  };
}

describe('PresenceController', () => {
  test('aggregates multiple WebSocket client sessions into one user presence', () => {
    const { ctx, broadcasts } = createContext();
    const controller = new PresenceController(ctx);

    controller.handleUpdate(meta('user-1', 'client-1'), 'asset-1');
    controller.handleUpdate(meta('user-1', 'client-2'), 'asset-2');

    const presence = controller.getPresenceData();

    assert.strictEqual(presence.length, 1);
    assert.deepStrictEqual(presence.map(({ userId, viewing }) => ({ userId, viewing })), [
      { userId: 'user-1', viewing: 'asset-2' },
    ]);
    assert.strictEqual(asMock(ctx.broadcast).mock.calls.length, 2);
    assert.deepStrictEqual(broadcasts.at(-1), {
      type: 'presence:update',
      presence,
    });
  });

  test('disconnect removes only the closing client session, not the whole user presence', () => {
    const { ctx, broadcasts } = createContext();
    const controller = new PresenceController(ctx);
    const firstClient = meta('user-1', 'client-1');
    const secondClient = meta('user-1', 'client-2');

    controller.handleUpdate(firstClient, 'asset-1');
    controller.handleUpdate(secondClient, 'asset-2');
    controller.handleDisconnect(firstClient);

    assert.deepStrictEqual(controller.getPresenceData().map(({ userId, viewing }) => ({ userId, viewing })), [
      { userId: 'user-1', viewing: 'asset-2' },
    ]);

    controller.handleDisconnect(secondClient);

    assert.deepStrictEqual(controller.getPresenceData(), []);
    assert.deepStrictEqual(broadcasts.at(-1), {
      type: 'presence:update',
      presence: [],
    });
  });
});
