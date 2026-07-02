import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SchemaManager } from '../schema/SchemaManager';
import { SpaceRepository, type ImageStorage, type SqlStorage, type SqlStorageResult } from './SpaceRepository';

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
  let sql: BetterSqlStorage;
  let repo: SpaceRepository;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    sql = new BetterSqlStorage(db);
    await new SchemaManager(sql).initialize();
    repo = new SpaceRepository(sql);
  });

  afterEach(() => {
    db.close();
  });

  async function createAssetWithVariant(
    assetId: string,
    variantId: string,
    options: { name?: string; type?: string; mediaKind?: 'image' | 'audio' | 'video'; parentAssetId?: string | null } = {}
  ) {
    await repo.createAsset({
      id: assetId,
      name: options.name ?? assetId,
      type: options.type ?? 'character',
      mediaKind: options.mediaKind,
      tags: [],
      createdBy: 'user-1',
    });
    if (options.parentAssetId !== undefined) {
      await sql.exec(
        'UPDATE assets SET parent_asset_id = ? WHERE id = ?',
        options.parentAssetId,
        assetId
      );
    }
    await repo.createVariant({
      id: variantId,
      assetId,
      mediaKind: options.mediaKind,
      imageKey: `images/${variantId}.png`,
      thumbKey: `images/${variantId}_thumb.webp`,
      recipe: '{}',
      createdBy: 'user-1',
    });
  }

  test('backfills a simple parent tree into a collection', async () => {
    await createAssetWithVariant('parent', 'parent-v1', { name: 'Hero Kit' });
    await createAssetWithVariant('child-1', 'child-1-v1', { parentAssetId: 'parent' });
    await createAssetWithVariant('child-2', 'child-2-v1', { parentAssetId: 'parent' });

    const result = await repo.backfillParentHierarchyToOrganization();

    assert.equal(result.mode, 'parent_hierarchy');
    assert.equal(result.parentClusters, 1);
    assert.equal(result.collectionsCreated, 1);
    assert.equal(result.collectionItemsCreated, 3);
    assert.equal(result.relationsCreated, 0);
    assert.equal((await repo.listCollections())[0].name, 'Hero Kit');
    assert.deepEqual(
      (await repo.listAllCollectionItems()).map((item) => [item.asset_id, item.role]),
      [
        ['parent', 'parent'],
        ['child-1', 'child'],
        ['child-2', 'child'],
      ]
    );
  });

  test('purgeAllData clears SQL rows and deletes referenced R2 objects', async () => {
    const deletedKeys: string[] = [];
    const imageStorage: ImageStorage = {
      delete: async (key) => {
        deletedKeys.push(key);
      },
    };
    const repoWithImages = new SpaceRepository(sql, imageStorage);

    await repoWithImages.createAsset({
      id: 'asset-1',
      name: 'Scene',
      type: 'scene',
      tags: [],
      createdBy: 'user-1',
    });
    await repoWithImages.createVariant({
      id: 'variant-1',
      assetId: 'asset-1',
      imageKey: 'images/variant-1.png',
      thumbKey: 'images/variant-1.webp',
      mediaMetadata: {
        mediaKey: 'videos/variant-1.mp4',
        transcriptKey: 'transcripts/variant-1.json',
        wordTimingsKey: 'timings/variant-1.json',
        renderMetadataKey: 'metadata/variant-1.json',
      },
      recipe: '{}',
      createdBy: 'user-1',
    });
    await repoWithImages.createCollection({
      id: 'collection-1',
      name: 'Scenes',
      kind: 'scenes',
      createdBy: 'user-1',
    });

    const result = await repoWithImages.purgeAllData();

    assert.equal(result.r2ObjectsDeleted, 6);
    assert.deepEqual(deletedKeys.sort(), [
      'images/variant-1.png',
      'images/variant-1.webp',
      'metadata/variant-1.json',
      'timings/variant-1.json',
      'transcripts/variant-1.json',
      'videos/variant-1.mp4',
    ]);
    assert.deepEqual(await repoWithImages.getAllAssets(), []);
    assert.deepEqual(await repoWithImages.listCollections(), []);
  });

  test('purgeAllData keeps SQL metadata when an R2 delete fails', async () => {
    const imageStorage: ImageStorage = {
      delete: async (key) => {
        if (key === 'images/variant-1.webp') {
          throw new Error('r2 unavailable');
        }
      },
    };
    const repoWithImages = new SpaceRepository(sql, imageStorage);

    await repoWithImages.createAsset({
      id: 'asset-1',
      name: 'Scene',
      type: 'scene',
      tags: [],
      createdBy: 'user-1',
    });
    await repoWithImages.createVariant({
      id: 'variant-1',
      assetId: 'asset-1',
      imageKey: 'images/variant-1.png',
      thumbKey: 'images/variant-1.webp',
      recipe: '{}',
      createdBy: 'user-1',
    });

    await assert.rejects(
      repoWithImages.purgeAllData(),
      /Failed to purge 1 R2 object/
    );
    assert.equal((await repoWithImages.getAllAssets()).length, 1);
    assert.equal((await repoWithImages.getAllVariants()).length, 1);
  });

  test('backfills multi-level parent trees as one collection per parent cluster', async () => {
    await createAssetWithVariant('root', 'root-v1', { name: 'Castle Crew' });
    await createAssetWithVariant('middle', 'middle-v1', { name: 'Knight Squad', parentAssetId: 'root' });
    await createAssetWithVariant('leaf', 'leaf-v1', { name: 'Shield Detail', parentAssetId: 'middle' });

    const result = await repo.backfillParentHierarchyToOrganization();

    assert.equal(result.parentClusters, 2);
    assert.equal(result.collectionsCreated, 2);
    assert.deepEqual(
      (await repo.listCollections()).map((collection) => collection.name).sort(),
      ['Castle Crew', 'Knight Squad']
    );
    const collectionItemsByName = new Map<string, string[]>();
    for (const item of await repo.listAllCollectionItems()) {
      const collection = (await repo.getCollectionById(item.collection_id))!;
      collectionItemsByName.set(collection.name, [...(collectionItemsByName.get(collection.name) ?? []), item.asset_id!]);
    }
    assert.deepEqual(collectionItemsByName.get('Castle Crew'), ['root', 'middle']);
    assert.deepEqual(collectionItemsByName.get('Knight Squad'), ['middle', 'leaf']);
  });

  test('backfill is idempotent when repeated', async () => {
    await createAssetWithVariant('parent', 'parent-v1');
    await createAssetWithVariant('child', 'child-v1', { parentAssetId: 'parent' });

    const first = await repo.backfillParentHierarchyToOrganization();
    const second = await repo.backfillParentHierarchyToOrganization();

    assert.equal(first.collectionsCreated, 1);
    assert.equal(first.collectionItemsCreated, 2);
    assert.equal(first.relationsCreated, 0);
    assert.equal(second.collectionsCreated, 0);
    assert.equal(second.collectionItemsCreated, 0);
    assert.equal(second.relationsCreated, 0);
    assert.equal((await repo.listCollections()).length, 1);
    assert.equal((await repo.listAllCollectionItems()).length, 2);
  });

  test('classifies all-null Russafa-style assets into starter collections', async () => {
    await createAssetWithVariant('amina', 'amina-v1', { name: 'Character Amina', type: 'character' });
    await createAssetWithVariant('bg-market', 'bg-market-v1', { name: 'BG Market', type: 'background' });
    await createAssetWithVariant('scene-gate', 'scene-gate-v1', { name: 'Scene Gate', type: 'scene' });
    await createAssetWithVariant('thumbnail-1', 'thumbnail-1-v1', { name: 'Thumbnail 01', type: 'image' });
    await createAssetWithVariant('map-russafa', 'map-russafa-v1', { name: 'Map Russafa', type: 'map' });

    const result = await repo.backfillParentHierarchyToOrganization();

    assert.equal(result.mode, 'starter_collections');
    assert.equal(result.collectionsCreated, 5);
    assert.deepEqual(
      (await repo.listCollections()).map((collection) => collection.name),
      ['Cast', 'Backgrounds', 'Scenes', 'Thumbnails', 'Map']
    );

    const itemsByCollection = new Map<string, string[]>();
    for (const item of await repo.listAllCollectionItems()) {
      const collection = (await repo.getCollectionById(item.collection_id))!;
      itemsByCollection.set(collection.name, [...(itemsByCollection.get(collection.name) ?? []), item.asset_id!]);
    }
    assert.deepEqual(itemsByCollection.get('Cast'), ['amina']);
    assert.deepEqual(itemsByCollection.get('Backgrounds'), ['bg-market']);
    assert.deepEqual(itemsByCollection.get('Scenes'), ['scene-gate']);
    assert.deepEqual(itemsByCollection.get('Thumbnails'), ['thumbnail-1']);
    assert.deepEqual(itemsByCollection.get('Map'), ['map-russafa']);
  });

  test('does not create starter collections when non-null parent references are orphaned', async () => {
    db.pragma('foreign_keys = OFF');
    try {
      await createAssetWithVariant('orphaned-child', 'orphaned-child-v1', {
        name: 'Character Orphan',
        type: 'character',
        parentAssetId: 'missing-parent',
      });
    } finally {
      db.pragma('foreign_keys = ON');
    }

    const result = await repo.backfillParentHierarchyToOrganization();

    assert.equal(result.mode, 'empty');
    assert.deepEqual(await repo.listCollections(), []);
    assert.deepEqual(await repo.listAllCollectionItems(), []);
  });

  test('backfill does not create or change lineage records', async () => {
    await createAssetWithVariant('parent', 'parent-v1');
    await createAssetWithVariant('child', 'child-v1', { parentAssetId: 'parent' });
    await repo.createLineage({
      id: 'existing-lineage',
      parentVariantId: 'parent-v1',
      childVariantId: 'child-v1',
      relationType: 'derived',
    });

    await repo.backfillParentHierarchyToOrganization();

    assert.deepEqual(
      (await repo.getAllLineage()).map((lineage) => [
        lineage.id,
        lineage.parent_variant_id,
        lineage.child_variant_id,
        lineage.relation_type,
      ]),
      [['existing-lineage', 'parent-v1', 'child-v1', 'derived']]
    );
  });

  function getRefCount(imageKey: string): number | null {
    const row = db
      .prepare('SELECT ref_count FROM image_refs WHERE image_key = ?')
      .get(imageKey) as { ref_count: number } | undefined;
    return row?.ref_count ?? null;
  }

  test('creates organization tables with lookup indexes', () => {
    const tableNames = db
      .prepare(`SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN (?, ?, ?) ORDER BY name`)
      .all('collection_items', 'space_collections', 'space_relations')
      .map((row) => (row as { name: string }).name);

    assert.deepEqual(tableNames, [
      'collection_items',
      'space_collections',
      'space_relations',
    ]);

    const indexNames = db
      .prepare(`SELECT name FROM sqlite_schema WHERE type = 'index' AND name IN (?, ?) ORDER BY name`)
      .all(
        'idx_collection_items_collection',
        'idx_space_relations_subject_variant'
      )
      .map((row) => (row as { name: string }).name);

    assert.deepEqual(indexNames, [
      'idx_collection_items_collection',
      'idx_space_relations_subject_variant',
    ]);

    const relationColumns = db
      .prepare(`PRAGMA table_info(space_relations)`)
      .all()
      .map((row) => (row as { name: string }).name);
    assert.ok(relationColumns.includes('label'));
    assert.ok(relationColumns.includes('metadata'));
  });

  test('normalizes removed collection kinds during schema initialization', async () => {
    await sql.exec('PRAGMA ignore_check_constraints = ON');
    await sql.exec(
      `INSERT INTO space_collections
        (id, name, kind, color, description, sort_index, created_by, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'collection-style-refs',
      'Style refs',
      'style_refs',
      null,
      null,
      0,
      'user-1',
      1,
      1,
      null
    );
    await sql.exec('PRAGMA ignore_check_constraints = OFF');

    await new SchemaManager(sql).initialize();

    const row = db
      .prepare('SELECT kind FROM space_collections WHERE id = ?')
      .get('collection-style-refs') as { kind: string };
    assert.equal(row.kind, 'custom');
  });

  test('supports collection CRUD, item CRUD, and explicit sort ordering', async () => {
    await createAssetWithVariant('asset-1', 'variant-1');
    await createAssetWithVariant('asset-2', 'variant-2');

    const collection = await repo.createCollection({
      id: 'collection-1',
      name: 'Scene Kit',
      kind: 'scenes',
      color: '#2f9e73',
      description: 'Characters and background',
      sortIndex: 2,
      createdBy: 'user-1',
    });
    assert.equal(collection.name, 'Scene Kit');
    assert.equal(collection.kind, 'scenes');
    assert.equal(collection.color, '#2f9e73');

    const updated = await repo.updateCollection('collection-1', {
      name: 'Opening Scene Kit',
      kind: 'cast',
      color: null,
      description: null,
      sortIndex: 1,
    });
    assert.equal(updated?.name, 'Opening Scene Kit');
    assert.equal(updated?.kind, 'cast');
    assert.equal(updated?.color, null);
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

  test('overview state includes in-progress sibling variants outside the display variant set', async () => {
    await createAssetWithVariant('audio', 'audio-completed', { type: 'sfx', mediaKind: 'audio' });
    await repo.updateAsset('audio', { active_variant_id: 'audio-completed' });
    await repo.createPlaceholderVariant({
      id: 'audio-regenerating',
      assetId: 'audio',
      mediaKind: 'audio',
      recipe: JSON.stringify({ prompt: 'same recipe', assetType: 'sfx', mediaKind: 'audio', operation: 'generate' }),
      createdBy: 'user-1',
    });
    await repo.updateVariantWorkflow('audio-regenerating', 'workflow-audio-regenerating', 'processing');

    const overview = await repo.getOverviewState();

    assert.deepEqual(
      overview.variants.map((variant) => [variant.id, variant.status]).sort(),
      [
        ['audio-completed', 'completed'],
        ['audio-regenerating', 'processing'],
      ]
    );
  });

  test('hides dependent active rows when assets, variants, and collections are soft-deleted', async () => {
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
    assert.equal(await repo.deleteVariant('variant-2'), true);
    assert.deepEqual(
      (await repo.listCollectionItems('collection-1')).map((item) => item.id),
      ['collection-item-1']
    );
    assert.deepEqual(await repo.deleteAsset('asset-1'), []);
    assert.deepEqual(await repo.listCollectionItems('collection-1'), []);

    assert.equal(await repo.deleteCollection('collection-1'), true);
    assert.equal(await repo.getCollectionById('collection-1'), null);
  });
});
