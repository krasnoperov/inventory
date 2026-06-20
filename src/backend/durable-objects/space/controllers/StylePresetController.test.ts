// @ts-nocheck - Test file with dynamic repository mocks
import { describe, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { StylePresetController } from './StylePresetController';
import { ConflictError, PermissionError, ValidationError, type BroadcastFn } from './types';
import type { ControllerContext, SendFn } from './types';
import type { SpaceRepository, SqlStorage } from '../repository/SpaceRepository';
import type { Env } from '../../../../core/types';
import type { CollectionItem, ServerMessage, StylePreset } from '../types';

function createPreset(overrides: Partial<StylePreset> = {}): StylePreset {
  return {
    id: 'preset-1',
    name: 'Painterly',
    description: 'Reference style',
    style_prompt: 'Loose brushwork',
    collection_id: 'collection-1',
    enabled: 1,
    is_default: 0,
    created_by: 'user-1',
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function createContext(repoOverrides: Partial<SpaceRepository> = {}): {
  ctx: ControllerContext;
  broadcasts: ServerMessage[];
} {
  const broadcasts: ServerMessage[] = [];
  const preset = createPreset();
  const repo = {
    listStyleReferenceCollections: mock.fn(async () => []),
    listStylePresetPreviews: mock.fn(async () => []),
    getCollectionById: mock.fn(async (id: string) => id === 'collection-1'
      ? { id, name: 'Style refs' }
      : null),
    listCollectionItems: mock.fn(async () => [] as CollectionItem[]),
    createStylePreset: mock.fn(async (data: Record<string, unknown>) => createPreset({
      id: data.id as string,
      name: data.name as string,
      description: data.description as string | null,
      style_prompt: data.stylePrompt as string,
      collection_id: data.collectionId as string | null,
      enabled: data.enabled === false ? 0 : 1,
      is_default: data.isDefault ? 1 : 0,
      created_by: data.createdBy as string,
    })),
    getStylePresetById: mock.fn(async (id: string) => id === 'preset-1' ? preset : null),
    updateStylePreset: mock.fn(async (id: string, changes: Record<string, unknown>) => createPreset({
      id,
      name: (changes.name as string | undefined) ?? preset.name,
      description: (changes.description as string | null | undefined) ?? preset.description,
      style_prompt: (changes.stylePrompt as string | undefined) ?? preset.style_prompt,
      collection_id: (changes.collectionId as string | null | undefined) ?? preset.collection_id,
      enabled: changes.enabled === false ? 0 : preset.enabled,
      is_default: changes.isDefault ? 1 : preset.is_default,
    })),
    deleteStylePreset: mock.fn(async (id: string) => id === 'preset-1'),
    getStylePresetPreview: mock.fn(async (id: string) => id === 'preset-1' ? {
      ...preset,
      collection_name: 'Style refs',
      reference_count: 1,
      style_reference_variant_ids: ['variant-1'],
      style_reference_image_keys: ['images/variant-1.png'],
    } : null),
    ...repoOverrides,
  } as unknown as SpaceRepository;

  const ctx: ControllerContext = {
    spaceId: 'space-1',
    repo,
    env: {} as Env,
    sql: { exec: mock.fn(() => ({ toArray: () => [] })) } as unknown as SqlStorage,
    broadcast: mock.fn((message: ServerMessage) => broadcasts.push(message)) as BroadcastFn,
    send: mock.fn() as SendFn,
    sendError: mock.fn(),
  };

  return { ctx, broadcasts };
}

describe('StylePresetController', () => {
  test('editor preset creation validates collection and broadcasts resolved preview', async () => {
    const { ctx, broadcasts } = createContext();
    const controller = new StylePresetController(ctx);

    await controller.handleCreateStylePreset({} as WebSocket, {
      userId: 'user-1',
      role: 'editor',
      name: 'Editor',
      clientSessionId: 'client-1',
    }, {
      id: 'preset-1',
      name: 'Painterly',
      description: 'Reference style',
      stylePrompt: 'Loose brushwork',
      collectionId: 'collection-1',
      isDefault: true,
    });

    assert.equal(broadcasts.length, 1);
    assert.equal(broadcasts[0].type, 'style_preset:created');
    assert.equal(broadcasts[0].preset.collection_name, 'Style refs');
    assert.equal(broadcasts[0].preset.reference_count, 1);
  });

  test('viewers cannot mutate style presets over WebSocket', async () => {
    const { ctx } = createContext();
    const controller = new StylePresetController(ctx);

    await assert.rejects(
      () => controller.handleDeleteStylePreset({} as WebSocket, {
        userId: 'user-1',
        role: 'viewer',
        name: 'Viewer',
        clientSessionId: 'client-1',
      }, 'preset-1'),
      PermissionError
    );
  });

  test('distinguishes missing and invalid style reference collections', async () => {
    const { ctx } = createContext({
      listCollectionItems: mock.fn(async () => [{
        id: 'item-1',
        collection_id: 'collection-1',
        subject_type: 'variant',
        asset_id: null,
        variant_id: 'variant-1',
        role: 'character',
        pinned_variant_id: null,
        sort_index: 0,
        created_by: 'user-1',
        created_at: 1,
        updated_at: 1,
      }]),
    });
    const controller = new StylePresetController(ctx);

    await assert.rejects(
      () => controller.httpCreateStylePreset({
        name: 'Missing',
        collectionId: 'missing-collection',
        createdBy: 'user-1',
      }),
      { message: 'Style reference collection not found' }
    );

    await assert.rejects(
      () => controller.httpCreateStylePreset({
        name: 'Invalid',
        collectionId: 'collection-1',
        createdBy: 'user-1',
      }),
      ValidationError
    );
  });

  test('rejects disabled default presets as a conflict', async () => {
    const { ctx } = createContext();
    const controller = new StylePresetController(ctx);

    await assert.rejects(
      () => controller.httpCreateStylePreset({
        name: 'Disabled default',
        enabled: false,
        isDefault: true,
        createdBy: 'user-1',
      }),
      ConflictError
    );
  });
});
