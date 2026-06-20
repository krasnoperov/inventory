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

  test('creates organization and style preset tables with lookup indexes', () => {
    const tableNames = db
      .prepare(`SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN (?, ?, ?, ?, ?, ?) ORDER BY name`)
      .all('collection_items', 'composition_items', 'compositions', 'space_collections', 'space_relations', 'style_presets')
      .map((row) => (row as { name: string }).name);

    assert.deepEqual(tableNames, [
      'collection_items',
      'composition_items',
      'compositions',
      'space_collections',
      'space_relations',
      'style_presets',
    ]);

    const indexNames = db
      .prepare(`SELECT name FROM sqlite_schema WHERE type = 'index' AND name IN (?, ?, ?, ?, ?) ORDER BY name`)
      .all(
        'idx_collection_items_collection',
        'idx_space_relations_subject_variant',
        'idx_composition_items_variant',
        'idx_compositions_output_variant',
        'idx_style_presets_default'
      )
      .map((row) => (row as { name: string }).name);

    assert.deepEqual(indexNames, [
      'idx_collection_items_collection',
      'idx_composition_items_variant',
      'idx_compositions_output_variant',
      'idx_space_relations_subject_variant',
      'idx_style_presets_default',
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

  test('supports style preset CRUD and optional default selection', async () => {
    await repo.createCollection({
      id: 'collection-1',
      name: 'Painterly References',
      createdBy: 'user-1',
    });
    await repo.createCollection({
      id: 'collection-2',
      name: 'Pixel References',
      createdBy: 'user-1',
    });
    await createAssetWithVariant('style-asset', 'style-variant');
    await repo.createCollectionItem({
      id: 'style-item',
      collectionId: 'collection-1',
      subjectType: 'asset',
      assetId: 'style-asset',
      pinnedVariantId: 'style-variant',
      role: 'style_ref',
      createdBy: 'user-1',
    });

    const first = await repo.createStylePreset({
      id: 'preset-1',
      name: 'Painterly',
      stylePrompt: 'Loose painterly brushwork',
      collectionId: 'collection-1',
      isDefault: true,
      createdBy: 'user-1',
    });
    assert.equal(first.is_default, 1);
    assert.equal((await repo.getDefaultStylePreset())?.id, 'preset-1');

    await repo.createStylePreset({
      id: 'preset-2',
      name: 'Pixel',
      stylePrompt: 'Crisp limited-palette pixel art',
      collectionId: 'collection-2',
      isDefault: true,
      createdBy: 'user-1',
    });
    assert.equal((await repo.getDefaultStylePreset())?.id, 'preset-2');
    assert.equal((await repo.getStylePresetById('preset-1'))?.is_default, 0);

    await assert.rejects(
      repo.createStylePreset({
        id: 'preset-invalid',
        name: 'Invalid',
        collectionId: 'deleted-collection',
        isDefault: true,
        createdBy: 'user-1',
      }),
      /FOREIGN KEY/
    );
    assert.equal((await repo.getDefaultStylePreset())?.id, 'preset-2');

    await assert.rejects(
      repo.updateStylePreset('preset-1', {
        collectionId: 'deleted-collection',
        isDefault: true,
      }),
      /FOREIGN KEY/
    );
    assert.equal((await repo.getDefaultStylePreset())?.id, 'preset-2');
    assert.equal((await repo.getStylePresetById('preset-1'))?.is_default, 0);

    const updated = await repo.updateStylePreset('preset-1', {
      name: 'Painted House',
      stylePrompt: 'Painterly fantasy UI concept art',
      collectionId: null,
      enabled: false,
      isDefault: true,
    });
    assert.equal(updated?.name, 'Painted House');
    assert.equal(updated?.style_prompt, 'Painterly fantasy UI concept art');
    assert.equal(updated?.collection_id, null);
    assert.equal(updated?.enabled, 0);
    assert.equal(updated?.is_default, 1);
    assert.equal((await repo.getStylePresetById('preset-2'))?.is_default, 0);

    assert.equal(await repo.setDefaultStylePreset(null), null);
    assert.equal(await repo.getDefaultStylePreset(), null);

    assert.equal(await repo.deleteStylePreset('preset-1'), true);
    assert.equal((await repo.getAssetById('style-asset'))?.id, 'style-asset');
    assert.equal((await repo.getVariantById('style-variant'))?.id, 'style-variant');
    assert.deepEqual(
      (await repo.listCollectionItems('collection-1')).map((item) => item.id),
      ['style-item']
    );
    assert.deepEqual(
      (await repo.listCollections()).map((collection) => collection.id).sort(),
      ['collection-1', 'collection-2']
    );
  });

  test('resolves style preset collection items to exact variants and image keys', async () => {
    await createAssetWithVariant('asset-1', 'variant-1');
    await createAssetWithVariant('asset-2', 'variant-2');
    await createAssetWithVariant('asset-3', 'variant-3');
    await repo.createCollection({ id: 'style-collection', name: 'Style refs', createdBy: 'user-1' });
    await repo.createCollectionItem({
      id: 'item-direct',
      collectionId: 'style-collection',
      subjectType: 'variant',
      variantId: 'variant-2',
      role: 'style_ref',
      sortIndex: 1,
      createdBy: 'user-1',
    });
    await repo.createCollectionItem({
      id: 'item-pinned',
      collectionId: 'style-collection',
      subjectType: 'asset',
      assetId: 'asset-1',
      pinnedVariantId: 'variant-1',
      role: 'style_ref',
      sortIndex: 2,
      createdBy: 'user-1',
    });
    await repo.createCollectionItem({
      id: 'item-unpinned',
      collectionId: 'style-collection',
      subjectType: 'asset',
      assetId: 'asset-3',
      role: 'style_ref',
      sortIndex: 3,
      createdBy: 'user-1',
    });
    await repo.createStylePreset({
      id: 'preset-1',
      name: 'House style',
      stylePrompt: 'Muted storybook colors',
      collectionId: 'style-collection',
      createdBy: 'user-1',
    });

    const resolved = await repo.resolveStylePresetReferences('preset-1');
    assert.equal(resolved?.stylePresetId, 'preset-1');
    assert.equal(resolved?.styleCollectionId, 'style-collection');
    assert.equal(resolved?.stylePrompt, 'Muted storybook colors');
    assert.deepEqual(resolved?.styleReferenceVariantIds, ['variant-2', 'variant-1']);
    assert.deepEqual(resolved?.styleReferenceImageKeys, [
      'images/variant-2.png',
      'images/variant-1.png',
    ]);
  });

  test('keeps legacy singleton style reads separate from style presets', async () => {
    await repo.createCollection({ id: 'collection-1', name: 'Style refs', createdBy: 'user-1' });
    await repo.createStyle({
      id: 'legacy-style',
      name: 'Legacy Style',
      description: 'Legacy space style row',
      imageKeys: ['styles/space-1/legacy.png'],
      createdBy: 'user-1',
    });
    await repo.createStylePreset({
      id: 'preset-1',
      name: 'Asset-backed Style',
      stylePrompt: 'Normal asset-backed style prompt',
      collectionId: 'collection-1',
      isDefault: true,
      createdBy: 'user-1',
    });

    const legacy = await repo.getActiveStyle();
    assert.equal(legacy?.id, 'legacy-style');
    assert.equal(legacy?.description, 'Legacy space style row');
    assert.equal((await repo.getDefaultStylePreset())?.id, 'preset-1');
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
    await repo.createStylePreset({
      id: 'preset-1',
      name: 'References',
      collectionId: 'collection-1',
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

    assert.equal((await repo.getStylePresetById('preset-1'))?.collection_id, 'collection-1');
    assert.equal(await repo.deleteCollection('collection-1'), true);
    assert.equal((await repo.getStylePresetById('preset-1'))?.collection_id, null);
  });
});
