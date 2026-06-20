import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SchemaManager } from '../schema/SchemaManager';
import { SpaceRepository, type SqlStorage, type SqlStorageResult } from './SpaceRepository';

class BetterSqlStorage implements SqlStorage {
  constructor(private readonly db: Database.Database) {}

  exec(query: string, ...bindings: unknown[]): SqlStorageResult {
    if (bindings.length === 0) {
      try {
        const statement = this.db.prepare(query);
        const rows = statement.reader ? statement.all() : (statement.run(), []);
        return { toArray: () => rows as unknown[] };
      } catch (error) {
        if (!(error instanceof RangeError) && (error as { code?: string }).code !== 'SQLITE_MISUSE') {
          throw error;
        }
        this.db.exec(query);
        return { toArray: () => [] };
      }
    }

    const statement = this.db.prepare(query);
    const rows = statement.reader ? statement.all(...bindings) : (statement.run(...bindings), []);
    return { toArray: () => rows as unknown[] };
  }
}

describe('Space organization repository', () => {
  let db: Database.Database;
  let repo: SpaceRepository;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const sql = new BetterSqlStorage(db);
    await new SchemaManager(sql).initialize();
    repo = new SpaceRepository(sql);
  });

  afterEach(() => {
    db.close();
  });

  async function createAssetWithVariant(assetId: string, variantId: string) {
    await repo.createAsset({
      id: assetId,
      name: assetId,
      type: 'character',
      tags: [],
      createdBy: 'user-1',
    });
    await repo.createVariant({
      id: variantId,
      assetId,
      imageKey: `images/${variantId}.png`,
      thumbKey: `images/${variantId}_thumb.webp`,
      recipe: '{}',
      createdBy: 'user-1',
    });
  }

  test('creates collection, relation, and composition tables with lookup indexes', () => {
    const tableNames = db
      .prepare(`SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN (?, ?, ?, ?, ?) ORDER BY name`)
      .all('collection_items', 'composition_items', 'compositions', 'space_collections', 'space_relations')
      .map((row) => (row as { name: string }).name);

    assert.deepEqual(tableNames, [
      'collection_items',
      'composition_items',
      'compositions',
      'space_collections',
      'space_relations',
    ]);

    const indexNames = db
      .prepare(`SELECT name FROM sqlite_schema WHERE type = 'index' AND name IN (?, ?, ?, ?) ORDER BY name`)
      .all(
        'idx_collection_items_collection',
        'idx_space_relations_subject_variant',
        'idx_composition_items_variant',
        'idx_compositions_output_variant'
      )
      .map((row) => (row as { name: string }).name);

    assert.deepEqual(indexNames, [
      'idx_collection_items_collection',
      'idx_composition_items_variant',
      'idx_compositions_output_variant',
      'idx_space_relations_subject_variant',
    ]);
  });

  test('supports collection CRUD, item CRUD, and explicit sort ordering', async () => {
    await createAssetWithVariant('asset-1', 'variant-1');
    await createAssetWithVariant('asset-2', 'variant-2');

    const collection = await repo.createCollection({
      id: 'collection-1',
      name: 'Scene Kit',
      description: 'Characters and background',
      sortIndex: 2,
      createdBy: 'user-1',
    });
    assert.equal(collection.name, 'Scene Kit');

    const updated = await repo.updateCollection('collection-1', {
      name: 'Opening Scene Kit',
      description: null,
      sortIndex: 1,
    });
    assert.equal(updated?.name, 'Opening Scene Kit');
    assert.equal(updated?.description, null);

    await repo.createCollectionItem({
      id: 'item-1',
      collectionId: 'collection-1',
      subjectType: 'asset',
      assetId: 'asset-1',
      role: 'character',
      pinnedVariantId: 'variant-1',
      sortIndex: 10,
      createdBy: 'user-1',
    });
    await repo.createCollectionItem({
      id: 'item-2',
      collectionId: 'collection-1',
      subjectType: 'variant',
      variantId: 'variant-2',
      role: 'background',
      sortIndex: 5,
      createdBy: 'user-1',
    });

    assert.deepEqual(
      (await repo.listCollectionItems('collection-1')).map((item) => item.id),
      ['item-2', 'item-1']
    );

    await repo.updateCollectionItem('item-2', { role: 'scene-background', sortIndex: 20 });
    await repo.reorderCollectionItems('collection-1', ['item-2', 'item-1']);

    const reordered = await repo.listCollectionItems('collection-1');
    assert.deepEqual(
      reordered.map((item) => [item.id, item.sort_index]),
      [
        ['item-2', 0],
        ['item-1', 1],
      ]
    );
    assert.equal(reordered[0].role, 'scene-background');

    assert.equal(await repo.deleteCollectionItem('item-1'), true);
    assert.equal(await repo.deleteCollection('collection-1'), true);
    assert.deepEqual(await repo.listCollections(), []);
  });

  test('supports relation CRUD and lookup in both directions without lineage rows', async () => {
    await createAssetWithVariant('character', 'character-v1');
    await createAssetWithVariant('scene', 'scene-v1');

    const relation = await repo.createRelation({
      id: 'relation-1',
      subject: { subjectType: 'variant', variantId: 'character-v1' },
      object: { subjectType: 'asset', assetId: 'scene' },
      relationType: 'appears_in',
      context: '{"shot":"opening"}',
      sortIndex: 3,
      createdBy: 'user-1',
    });
    assert.equal(relation.relation_type, 'appears_in');

    const updated = await repo.updateRelation('relation-1', {
      relationType: 'prop_in',
      context: null,
      sortIndex: 1,
    });
    assert.equal(updated?.relation_type, 'prop_in');
    assert.equal(updated?.context, null);

    assert.deepEqual(
      (await repo.listRelationsForSubject('variant', 'character-v1')).map((row) => row.id),
      ['relation-1']
    );
    assert.deepEqual(
      (await repo.listRelationsForObject('asset', 'scene')).map((row) => row.id),
      ['relation-1']
    );
    assert.deepEqual(
      (await repo.listRelationsForEntity('variant', 'character-v1')).map((row) => row.id),
      ['relation-1']
    );
    assert.deepEqual(await repo.getAllLineage(), []);

    assert.equal(await repo.deleteRelation('relation-1'), true);
    assert.deepEqual(await repo.listRelations(), []);
  });

  test('supports composition CRUD and exact variant membership', async () => {
    await createAssetWithVariant('background', 'background-v1');
    await createAssetWithVariant('character', 'character-v1');
    await createAssetWithVariant('output', 'output-v1');

    const composition = await repo.createComposition({
      id: 'composition-1',
      name: 'Final scene',
      status: 'draft',
      outputAssetId: 'output',
      outputVariantId: 'output-v1',
      metadata: { aspectRatio: '16:9' },
      sortIndex: 4,
      createdBy: 'user-1',
    });
    assert.equal(composition.output_variant_id, 'output-v1');

    await repo.createCompositionItem({
      id: 'composition-item-1',
      compositionId: 'composition-1',
      role: 'background',
      assetId: 'background',
      variantId: 'background-v1',
      sortIndex: 2,
      createdBy: 'user-1',
    });
    await repo.createCompositionItem({
      id: 'composition-item-2',
      compositionId: 'composition-1',
      role: 'character',
      assetId: 'character',
      variantId: 'character-v1',
      sortIndex: 1,
      createdBy: 'user-1',
    });
    await repo.createCompositionItem({
      id: 'composition-item-3',
      compositionId: 'composition-1',
      role: 'output',
      assetId: 'output',
      variantId: 'output-v1',
      sortIndex: 3,
      createdBy: 'user-1',
    });

    assert.deepEqual(
      (await repo.listCompositionItems('composition-1')).map((item) => [item.role, item.variant_id]),
      [
        ['character', 'character-v1'],
        ['background', 'background-v1'],
        ['output', 'output-v1'],
      ]
    );

    const updated = await repo.updateComposition('composition-1', {
      name: 'Locked final scene',
      status: 'final',
      metadata: { aspectRatio: '16:9', locked: true },
    });
    assert.equal(updated?.status, 'final');
    assert.equal(JSON.parse(updated?.metadata ?? '{}').locked, true);

    await repo.updateCompositionItem('composition-item-2', { role: 'overlay', sortIndex: 5 });
    await repo.reorderCompositionItems('composition-1', [
      'composition-item-3',
      'composition-item-1',
      'composition-item-2',
    ]);
    assert.deepEqual(
      (await repo.listCompositionItems('composition-1')).map((item) => [item.id, item.sort_index]),
      [
        ['composition-item-3', 0],
        ['composition-item-1', 1],
        ['composition-item-2', 2],
      ]
    );

    assert.equal(await repo.deleteCompositionItem('composition-item-2'), true);
    assert.equal((await repo.listCompositionItems('composition-1')).length, 2);
    assert.equal(await repo.deleteComposition('composition-1'), true);
    assert.deepEqual(await repo.listCompositions(), []);
  });

  test('applies explicit foreign-key behavior when assets and variants are deleted', async () => {
    await createAssetWithVariant('asset-1', 'variant-1');
    await createAssetWithVariant('asset-2', 'variant-2');

    await repo.createCollection({ id: 'collection-1', name: 'Group', createdBy: 'user-1' });
    await repo.createCollectionItem({
      id: 'collection-item-1',
      collectionId: 'collection-1',
      subjectType: 'asset',
      assetId: 'asset-1',
      pinnedVariantId: 'variant-1',
      createdBy: 'user-1',
    });
    await repo.createCollectionItem({
      id: 'collection-item-2',
      collectionId: 'collection-1',
      subjectType: 'variant',
      variantId: 'variant-2',
      createdBy: 'user-1',
    });
    await repo.createRelation({
      id: 'relation-1',
      subject: { subjectType: 'asset', assetId: 'asset-1' },
      object: { subjectType: 'variant', variantId: 'variant-2' },
      relationType: 'reference_for',
      createdBy: 'user-1',
    });
    await repo.createComposition({
      id: 'composition-1',
      name: 'Draft',
      outputAssetId: 'asset-1',
      outputVariantId: 'variant-1',
      createdBy: 'user-1',
    });
    await repo.createCompositionItem({
      id: 'composition-item-1',
      compositionId: 'composition-1',
      role: 'character',
      assetId: 'asset-2',
      variantId: 'variant-2',
      createdBy: 'user-1',
    });

    assert.equal(await repo.deleteVariant('variant-2'), true);
    assert.deepEqual(
      (await repo.listCollectionItems('collection-1')).map((item) => item.id),
      ['collection-item-1']
    );
    assert.deepEqual(await repo.listRelations(), []);
    assert.deepEqual(await repo.listCompositionItems('composition-1'), []);

    assert.deepEqual(await repo.deleteAsset('asset-1'), []);
    assert.deepEqual(await repo.listCollectionItems('collection-1'), []);
    const composition = await repo.getCompositionById('composition-1');
    assert.equal(composition?.output_asset_id, null);
    assert.equal(composition?.output_variant_id, null);
  });
});
