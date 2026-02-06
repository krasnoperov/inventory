import { describe, test, mock, type Mock } from 'node:test';
import assert from 'node:assert/strict';
import { StyleController } from './StyleController';
import type { ControllerContext, BroadcastFn } from './types';
import type { SpaceRepository, SqlStorage } from '../repository/SpaceRepository';
import type { Env } from '../../../../core/types';
import type { SpaceStyle, WebSocketMeta, ServerMessage } from '../types';

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

function createMockRepo(): SpaceRepository {
  return {
    getActiveStyle: mock.fn(async () => null),
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

      // Verify broadcast
      assert.ok(broadcasts.some((b) => b.type === 'style:updated'));
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
      const { ctx, broadcasts } = createMockContext({
        getActiveStyle: mock.fn(async () => existingStyle),
      });
      const controller = new StyleController(ctx);

      await controller.handleDeleteStyle({} as WebSocket, createEditorMeta());

      assert.strictEqual(asMock(ctx.repo.deleteStyle).mock.calls.length, 1);
      assert.strictEqual(asMock(ctx.repo.deleteStyle).mock.calls[0].arguments[0], 'style-1');
      assert.ok(broadcasts.some((b) => b.type === 'style:deleted'));
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
      assert.ok(broadcasts.some((b) => b.type === 'style:updated'));
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
