// @ts-nocheck - Test file with dynamic repository mocks
import { describe, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { OrganizationController } from './OrganizationController';
import { PermissionError, ValidationError, type BroadcastFn } from './types';
import type { ControllerContext, SendFn } from './types';
import type { SpaceRepository, SqlStorage } from '../repository/SpaceRepository';
import type { Env } from '../../../../core/types';
import type { ServerMessage } from '../types';

function createContext(repoOverrides: Partial<SpaceRepository>): {
  ctx: ControllerContext;
  broadcasts: ServerMessage[];
} {
  const broadcasts: ServerMessage[] = [];
  const repo = {
    getAssetById: mock.fn(async (id: string) => id === 'asset-1'
      ? { id: 'asset-1', name: 'Hero', media_kind: 'image' }
      : null),
    getVariantById: mock.fn(async (id: string) => id === 'variant-1'
      ? { id: 'variant-1', asset_id: 'asset-1', media_kind: 'image' }
      : id === 'variant-2'
        ? { id: 'variant-2', asset_id: 'asset-2', media_kind: 'image' }
      : null),
    getCollectionById: mock.fn(async (id: string) => id === 'collection-1'
      ? { id: 'collection-1', name: 'Scene Kit' }
      : null),
    updateCollection: mock.fn(async (id: string, changes: Record<string, unknown>) => id === 'collection-1'
      ? { id, name: changes.name ?? 'Scene Kit', description: changes.description ?? null, sort_index: changes.sortIndex ?? 0 }
      : null),
    deleteCollection: mock.fn(async (id: string) => id === 'collection-1'),
    listCollectionItems: mock.fn(async () => [{
      id: 'item-1',
      collection_id: 'collection-1',
      subject_type: 'variant',
      asset_id: null,
      variant_id: 'variant-1',
      role: 'style_ref',
      pinned_variant_id: null,
      sort_index: 0,
      created_by: 'user-1',
      created_at: 1,
      updated_at: 1,
    }]),
    getCollectionItemById: mock.fn(async (id: string) => id === 'item-1'
      ? {
        id,
        collection_id: 'collection-1',
        subject_type: 'variant',
        asset_id: null,
        variant_id: 'variant-1',
        role: 'style_ref',
        pinned_variant_id: null,
        sort_index: 0,
        created_by: 'user-1',
        created_at: 1,
        updated_at: 1,
      }
      : null),
    getCompositionById: mock.fn(async (id: string) => id === 'composition-1'
      ? { id: 'composition-1', name: 'Opening' }
      : null),
    getCompositionItemById: mock.fn(async (id: string) => id === 'composition-item-1'
      ? { id, composition_id: 'composition-1', role: 'output', asset_id: 'asset-1', variant_id: 'variant-1' }
      : null),
    createCollectionItem: mock.fn(async (data: Record<string, unknown>) => ({
      id: data.id,
      collection_id: data.collectionId,
      subject_type: data.subjectType,
      asset_id: data.assetId ?? null,
      variant_id: data.variantId ?? null,
      role: data.role,
      pinned_variant_id: data.pinnedVariantId ?? null,
      sort_index: data.sortIndex,
      created_by: data.createdBy,
      created_at: 1,
      updated_at: 1,
    })),
    updateCollectionItem: mock.fn(async (id: string, changes: Record<string, unknown>) => ({
      id,
      collection_id: 'collection-1',
      subject_type: 'variant',
      asset_id: null,
      variant_id: 'variant-1',
      role: changes.role ?? 'style_ref',
      pinned_variant_id: changes.pinnedVariantId ?? null,
      sort_index: changes.sortIndex ?? 0,
      created_by: 'user-1',
      created_at: 1,
      updated_at: 2,
    })),
    reorderCollectionItems: mock.fn(async () => [{
      id: 'item-1',
      collection_id: 'collection-1',
      subject_type: 'variant',
      asset_id: null,
      variant_id: 'variant-1',
      role: 'style_ref',
      pinned_variant_id: null,
      sort_index: 0,
      created_by: 'user-1',
      created_at: 1,
      updated_at: 2,
    }]),
    deleteCollectionItem: mock.fn(async (id: string) => id === 'item-1'),
    listStylePresetPreviewsByCollection: mock.fn(async () => []),
    getStylePresetPreview: mock.fn(async () => null),
    createRelation: mock.fn(async (data: Record<string, unknown>) => ({
      id: data.id,
      subject_type: data.subject.subjectType,
      subject_asset_id: data.subject.assetId ?? null,
      subject_variant_id: data.subject.variantId ?? null,
      object_type: data.object.subjectType,
      object_asset_id: data.object.assetId ?? null,
      object_variant_id: data.object.variantId ?? null,
      relation_type: data.relationType,
      label: data.label ?? null,
      context: data.context ?? null,
      metadata: JSON.stringify(data.metadata ?? {}),
      sort_index: data.sortIndex,
      created_by: data.createdBy,
      created_at: 1,
      updated_at: 1,
    })),
    createCompositionItem: mock.fn(async (data: Record<string, unknown>) => ({
      id: data.id,
      composition_id: data.compositionId,
      role: data.role,
      label: data.label ?? null,
      asset_id: data.assetId ?? null,
      variant_id: data.variantId,
      metadata: JSON.stringify(data.metadata ?? {}),
      sort_index: data.sortIndex,
      created_by: data.createdBy,
      created_at: 1,
      updated_at: 1,
    })),
    updateCompositionItem: mock.fn(async (id: string, changes: Record<string, unknown>) => ({
      id,
      composition_id: 'composition-1',
      role: changes.role ?? 'output',
      label: changes.label ?? null,
      asset_id: changes.assetId ?? 'asset-1',
      variant_id: changes.variantId ?? 'variant-1',
      metadata: JSON.stringify(changes.metadata ?? {}),
      sort_index: changes.sortIndex ?? 0,
      created_by: 'user-1',
      created_at: 1,
      updated_at: 2,
    })),
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

describe('OrganizationController', () => {
  test('editor collection item creation validates subject and broadcasts payload', async () => {
    const { ctx, broadcasts } = createContext({});
    const controller = new OrganizationController(ctx);

    await controller.handleCreateCollectionItem({} as WebSocket, {
      userId: 'user-1',
      role: 'editor',
      name: 'Editor',
      clientSessionId: 'client-1',
    }, 'collection-1', {
      subjectType: 'asset',
      assetId: 'asset-1',
      pinnedVariantId: 'variant-1',
      role: 'character',
    });

    assert.equal(broadcasts.length, 1);
    assert.equal(broadcasts[0].type, 'collection_item:created');
    assert.equal(broadcasts[0].item.collection_id, 'collection-1');
    assert.equal(broadcasts[0].item.asset_id, 'asset-1');
  });

  test('collection item creation rebroadcasts affected style preset preview', async () => {
    const stylePreset = {
      id: 'preset-1',
      name: 'Painterly',
      collection_id: 'collection-1',
      collection_name: 'Scene Kit',
      reference_count: 2,
      style_reference_variant_ids: ['variant-1', 'variant-2'],
      style_reference_image_keys: ['images/variant-1.png', 'images/variant-2.png'],
    };
    const { ctx, broadcasts } = createContext({
      listStylePresetPreviewsByCollection: mock.fn(async () => [stylePreset]),
    });
    const controller = new OrganizationController(ctx);

    await controller.handleCreateCollectionItem({} as WebSocket, {
      userId: 'user-1',
      role: 'editor',
      name: 'Editor',
      clientSessionId: 'client-1',
    }, 'collection-1', {
      subjectType: 'variant',
      variantId: 'variant-1',
      role: 'style_ref',
    });

    assert.deepEqual(
      broadcasts.map((message) => message.type),
      ['collection_item:created', 'style_preset:updated']
    );
    assert.equal(broadcasts[1].preset.reference_count, 2);
    assert.deepEqual(broadcasts[1].preset.style_reference_variant_ids, ['variant-1', 'variant-2']);
  });

  test('collection item updates, reorders, and deletes rebroadcast affected style preset previews', async () => {
    const stylePreset = {
      id: 'preset-1',
      name: 'Painterly',
      collection_id: 'collection-1',
      collection_name: 'Scene Kit',
      reference_count: 1,
      style_reference_variant_ids: ['variant-1'],
      style_reference_image_keys: ['images/variant-1.png'],
    };
    const { ctx, broadcasts } = createContext({
      listStylePresetPreviewsByCollection: mock.fn(async () => [stylePreset]),
    });
    const controller = new OrganizationController(ctx);

    await controller.httpUpdateCollectionItem('collection-1', 'item-1', { sortIndex: 3 });
    await controller.httpReorderCollectionItems('collection-1', ['item-1']);
    await controller.httpDeleteCollectionItem('collection-1', 'item-1');

    assert.deepEqual(
      broadcasts.map((message) => message.type),
      [
        'collection_item:updated',
        'style_preset:updated',
        'collection_items:reordered',
        'style_preset:updated',
        'collection_item:deleted',
        'style_preset:updated',
      ]
    );
  });

  test('collection rename and delete rebroadcast affected style preset previews', async () => {
    const beforeDeletePreset = {
      id: 'preset-1',
      name: 'Painterly',
      collection_id: 'collection-1',
      collection_name: 'Scene Kit',
      reference_count: 1,
      style_reference_variant_ids: ['variant-1'],
      style_reference_image_keys: ['images/variant-1.png'],
    };
    const afterDeletePreset = {
      ...beforeDeletePreset,
      collection_id: null,
      collection_name: null,
      reference_count: 0,
      style_reference_variant_ids: [],
      style_reference_image_keys: [],
    };
    const { ctx, broadcasts } = createContext({
      listStylePresetPreviewsByCollection: mock.fn(async () => [beforeDeletePreset]),
      getStylePresetPreview: mock.fn(async () => afterDeletePreset),
    });
    const controller = new OrganizationController(ctx);

    await controller.httpUpdateCollection('collection-1', { name: 'Updated refs' });
    await controller.httpDeleteCollection('collection-1');

    assert.deepEqual(
      broadcasts.map((message) => message.type),
      [
        'collection:updated',
        'style_preset:updated',
        'collection:deleted',
        'style_preset:updated',
      ]
    );
    assert.equal(broadcasts.at(-1)?.preset.collection_name, null);
    assert.equal(broadcasts.at(-1)?.preset.reference_count, 0);
  });

  test('viewers cannot mutate organization records over WebSocket', async () => {
    const { ctx } = createContext({});
    const controller = new OrganizationController(ctx);

    await assert.rejects(
      () => controller.handleCreateRelation({} as WebSocket, {
        userId: 'user-1',
        role: 'viewer',
        name: 'Viewer',
        clientSessionId: 'client-1',
      }, {
        subject: { subjectType: 'asset', assetId: 'asset-1' },
        object: { subjectType: 'variant', variantId: 'variant-1' },
        relationType: 'appears_in',
      }),
      PermissionError
    );
  });

  test('manual relation creation distinguishes missing subjects and invalid relation types', async () => {
    const { ctx } = createContext({});
    const controller = new OrganizationController(ctx);

    await assert.rejects(
      () => controller.httpCreateRelation({
        subject: { subjectType: 'asset', assetId: 'missing-asset' },
        object: { subjectType: 'variant', variantId: 'variant-1' },
        relationType: 'appears_in',
        createdBy: 'user-1',
      }),
      { message: 'Subject not found' }
    );

    await assert.rejects(
      () => controller.httpCreateRelation({
        subject: { subjectType: 'asset', assetId: 'asset-1' },
        object: { subjectType: 'variant', variantId: 'variant-1' },
        relationType: 'parent_of',
        createdBy: 'user-1',
      }),
      { message: 'Invalid relation type' }
    );
  });

  test('parent hierarchy backfill broadcasts created organization rows', async () => {
    let migrated = false;
    const createdCollection = {
      id: 'migration:collection:parent',
      name: 'Parent',
      description: null,
      sort_index: 0,
      created_by: 'system:migration',
      created_at: 1,
      updated_at: 1,
    };
    const createdItem = {
      id: 'migration:item:parent',
      collection_id: createdCollection.id,
      subject_type: 'asset',
      asset_id: 'parent',
      variant_id: null,
      role: 'parent',
      pinned_variant_id: null,
      sort_index: 0,
      created_by: 'system:migration',
      created_at: 1,
      updated_at: 1,
    };
    const createdRelation = {
      id: 'migration:relation:child',
      subject_type: 'asset',
      subject_asset_id: 'child',
      subject_variant_id: null,
      object_type: 'asset',
      object_asset_id: 'parent',
      object_variant_id: null,
      relation_type: 'part_of',
      context: '{"migrated_parent_asset_id":"parent"}',
      sort_index: 0,
      created_by: 'system:migration',
      created_at: 1,
      updated_at: 1,
    };
    const { ctx, broadcasts } = createContext({
      listCollections: mock.fn(async () => migrated ? [createdCollection] : []),
      listAllCollectionItems: mock.fn(async () => migrated ? [createdItem] : []),
      listRelations: mock.fn(async () => migrated ? [createdRelation] : []),
      backfillParentHierarchyToOrganization: mock.fn(async () => {
        migrated = true;
        return {
          mode: 'parent_hierarchy',
          scannedAssets: 2,
          parentClusters: 1,
          collectionsCreated: 1,
          collectionItemsCreated: 1,
          relationsCreated: 1,
        };
      }),
    });
    const controller = new OrganizationController(ctx);

    const result = await controller.httpBackfillParentHierarchy({ createdBy: 'system:migration' });

    assert.equal(result.collectionsCreated, 1);
    assert.deepEqual(
      broadcasts.map((message) => message.type),
      ['collection:created', 'collection_item:created', 'relation:created']
    );
    assert.equal(broadcasts[0].collection.id, createdCollection.id);
    assert.equal(broadcasts[1].item.id, createdItem.id);
    assert.equal(broadcasts[2].relation.id, createdRelation.id);
  });

  test('composition items reject invalid roles before writing', async () => {
    const { ctx } = createContext({});
    const controller = new OrganizationController(ctx);

    await assert.rejects(
      () => controller.httpCreateCompositionItem('composition-1', {
        role: 'lead',
        variantId: 'variant-1',
        createdBy: 'user-1',
      }),
      ValidationError
    );
  });

  test('composition item variant updates also move the stored asset id', async () => {
    const { ctx } = createContext({
      getAssetById: mock.fn(async (id: string) => id === 'asset-1' || id === 'asset-2' ? { id } : null),
    });
    const controller = new OrganizationController(ctx);

    const item = await controller.httpUpdateCompositionItem('composition-1', 'composition-item-1', {
      variantId: 'variant-2',
    });

    assert.equal(item.variant_id, 'variant-2');
    assert.equal(item.asset_id, 'asset-2');
  });
});
