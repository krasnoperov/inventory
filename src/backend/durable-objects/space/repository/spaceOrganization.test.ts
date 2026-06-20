import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SchemaManager } from '../schema/SchemaManager';
import { resolveStyleReferences } from '../generation/refLimits';
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

  async function createAssetWithVariant(
    assetId: string,
    variantId: string,
    options: { name?: string; type?: string; parentAssetId?: string | null } = {}
  ) {
    await repo.createAsset({
      id: assetId,
      name: options.name ?? assetId,
      type: options.type ?? 'character',
      tags: [],
      parentAssetId: options.parentAssetId,
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

  test('backfills a simple parent tree into a collection and manual part_of relations', async () => {
    await createAssetWithVariant('parent', 'parent-v1', { name: 'Hero Kit' });
    await createAssetWithVariant('child-1', 'child-1-v1', { parentAssetId: 'parent' });
    await createAssetWithVariant('child-2', 'child-2-v1', { parentAssetId: 'parent' });

    const result = await repo.backfillParentHierarchyToOrganization();

    assert.equal(result.mode, 'parent_hierarchy');
    assert.equal(result.parentClusters, 1);
    assert.equal(result.collectionsCreated, 1);
    assert.equal(result.collectionItemsCreated, 3);
    assert.equal(result.relationsCreated, 2);
    assert.equal((await repo.listCollections())[0].name, 'Hero Kit');
    assert.deepEqual(
      (await repo.listAllCollectionItems()).map((item) => [item.asset_id, item.role]),
      [
        ['parent', 'parent'],
        ['child-1', 'child'],
        ['child-2', 'child'],
      ]
    );

    const relations = await repo.listRelations();
    assert.deepEqual(
      relations.map((relation) => [
        relation.subject_asset_id,
        relation.object_asset_id,
        relation.relation_type,
        JSON.parse(relation.context ?? '{}').migrated_parent_asset_id,
      ]),
      [
        ['child-1', 'parent', 'part_of', 'parent'],
        ['child-2', 'parent', 'part_of', 'parent'],
      ]
    );
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
    assert.deepEqual(
      (await repo.listRelations())
        .map((relation) => [relation.subject_asset_id, relation.object_asset_id])
        .sort(([leftSubject], [rightSubject]) => String(leftSubject).localeCompare(String(rightSubject))),
      [
        ['leaf', 'middle'],
        ['middle', 'root'],
      ]
    );
  });

  test('backfill is idempotent when repeated', async () => {
    await createAssetWithVariant('parent', 'parent-v1');
    await createAssetWithVariant('child', 'child-v1', { parentAssetId: 'parent' });

    const first = await repo.backfillParentHierarchyToOrganization();
    const second = await repo.backfillParentHierarchyToOrganization();

    assert.equal(first.collectionsCreated, 1);
    assert.equal(first.collectionItemsCreated, 2);
    assert.equal(first.relationsCreated, 1);
    assert.equal(second.collectionsCreated, 0);
    assert.equal(second.collectionItemsCreated, 0);
    assert.equal(second.relationsCreated, 0);
    assert.equal((await repo.listCollections()).length, 1);
    assert.equal((await repo.listAllCollectionItems()).length, 2);
    assert.equal((await repo.listRelations()).length, 1);
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
    assert.deepEqual(await repo.listRelations(), []);
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
    assert.deepEqual(await repo.listRelations(), []);
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

  function createImageStorage(sizes: Record<string, number | null>): ImageStorage {
    return {
      async head(key: string) {
        if (!(key in sizes) || sizes[key] === null) return null;
        return { size: sizes[key] };
      },
      async delete() {
        // Not used by the migration path.
      },
    };
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
      description: 'Loose concept style',
      stylePrompt: 'Loose painterly brushwork',
      collectionId: 'collection-1',
      isDefault: true,
      createdBy: 'user-1',
    });
    assert.equal(first.is_default, 1);
    assert.equal(first.description, 'Loose concept style');
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
      description: null,
      stylePrompt: 'Painterly fantasy UI concept art',
      collectionId: null,
      enabled: false,
      isDefault: true,
    });
    assert.equal(updated?.name, 'Painted House');
    assert.equal(updated?.description, null);
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

  test('lists resolved style preset and style reference collection previews', async () => {
    await createAssetWithVariant('asset-1', 'variant-1');
    await createAssetWithVariant('asset-2', 'variant-2');
    await repo.createCollection({ id: 'style-collection', name: 'Style refs', createdBy: 'user-1' });
    await repo.createCollection({ id: 'general-collection', name: 'General refs', createdBy: 'user-1' });
    await repo.createCollectionItem({
      id: 'style-item',
      collectionId: 'style-collection',
      subjectType: 'variant',
      variantId: 'variant-1',
      role: 'style_ref',
      createdBy: 'user-1',
    });
    await repo.createCollectionItem({
      id: 'general-item',
      collectionId: 'general-collection',
      subjectType: 'variant',
      variantId: 'variant-2',
      role: 'character',
      createdBy: 'user-1',
    });
    await repo.createStylePreset({
      id: 'preset-1',
      name: 'House style',
      description: 'A resolved preset',
      stylePrompt: 'Muted storybook colors',
      collectionId: 'style-collection',
      isDefault: true,
      createdBy: 'user-1',
    });

    const presets = await repo.listStylePresetPreviews();
    assert.equal(presets.length, 1);
    assert.equal(presets[0].description, 'A resolved preset');
    assert.equal(presets[0].collection_name, 'Style refs');
    assert.equal(presets[0].reference_count, 1);
    assert.deepEqual(presets[0].style_reference_variant_ids, ['variant-1']);
    assert.deepEqual(presets[0].style_reference_image_keys, ['images/variant-1.png']);

    const collections = await repo.listStyleReferenceCollections();
    assert.deepEqual(collections.map((collection) => collection.id), ['style-collection']);
    assert.equal(collections[0].reference_count, 1);
    assert.equal(collections[0].preset_count, 1);
  });

  test('resolves style preset collection items to exact variants and image keys', async () => {
    await createAssetWithVariant('asset-1', 'variant-1');
    await createAssetWithVariant('asset-2', 'variant-2');
    await createAssetWithVariant('asset-3', 'variant-3');
    await repo.createAsset({
      id: 'asset-video',
      name: 'asset-video',
      type: 'animation',
      mediaKind: 'video',
      tags: [],
      createdBy: 'user-1',
    });
    await repo.createPlaceholderVariant({
      id: 'variant-video',
      assetId: 'asset-video',
      mediaKind: 'video',
      recipe: '{}',
      createdBy: 'user-1',
    });
    await repo.completeVariant('variant-video', null, null, {
      mediaKey: 'media/variant-video.mp4',
      mimeType: 'video/mp4',
    });
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
    await repo.createCollectionItem({
      id: 'item-video',
      collectionId: 'style-collection',
      subjectType: 'variant',
      variantId: 'variant-video',
      role: 'style_ref',
      sortIndex: 4,
      createdBy: 'user-1',
    });
    await repo.createStylePreset({
      id: 'preset-1',
      name: 'House style',
      stylePrompt: 'Muted storybook colors',
      collectionId: 'style-collection',
      createdBy: 'user-1',
    });
    await repo.createCollectionItem({
      id: 'item-character-later',
      collectionId: 'style-collection',
      subjectType: 'variant',
      variantId: 'variant-3',
      role: 'character',
      sortIndex: 0,
      createdBy: 'user-1',
    });

    const resolved = await repo.resolveStylePresetReferences('preset-1');
    assert.equal(resolved?.stylePresetId, 'preset-1');
    assert.equal(resolved?.styleCollectionId, 'style-collection');
    assert.equal(resolved?.stylePrompt, 'Muted storybook colors');
    assert.deepEqual(resolved?.styleReferenceVariantIds, ['variant-2', 'variant-1', 'variant-video']);
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

  test('backfills legacy style description into a default asset-backed preset', async () => {
    await repo.createStyle({
      id: 'legacy-style',
      name: 'Legacy Style',
      description: 'Painterly fantasy UI concept art',
      imageKeys: [],
      createdBy: 'user-1',
    });

    const result = await repo.backfillLegacySpaceStyle();

    assert.equal(result.migrated, true);
    assert.equal(result.assetIds.length, 0);
    const collections = await repo.listCollections();
    assert.equal(collections.length, 1);
    assert.equal(collections[0].name, 'Style References');
    const preset = await repo.getDefaultStylePreset();
    assert.ok(preset);
    assert.equal(preset.style_prompt, 'Painterly fantasy UI concept art');
    assert.equal(preset.collection_id, collections[0].id);
  });

  test('backfill leaves spaces without legacy style state untouched', async () => {
    const result = await repo.backfillLegacySpaceStyle();

    assert.equal(result.migrated, false);
    assert.deepEqual(await repo.getAllAssets(), []);
    assert.deepEqual(await repo.getAllVariants(), []);
    assert.deepEqual(await repo.listCollections(), []);
    assert.deepEqual(await repo.listStylePresets(), []);
  });

  test('backfills multiple legacy style image keys as style reference assets and variants', async () => {
    await repo.createStyle({
      id: 'legacy-style',
      name: 'Legacy Style',
      description: 'Pixel art with warm rim light',
      imageKeys: [
        'styles/space-1/one.png',
        'styles/space-1/two.webp',
      ],
      createdBy: 'user-1',
    });
    repo = new SpaceRepository(
      new BetterSqlStorage(db),
      createImageStorage({
        'styles/space-1/one.png': 1024,
        'styles/space-1/one_thumb.webp': 256,
        'styles/space-1/two.webp': 2048,
        'styles/space-1/two_thumb.webp': 512,
      })
    );

    const result = await repo.backfillLegacySpaceStyle();

    assert.equal(result.assetIds.length, 2);
    assert.equal(result.variantIds.length, 2);
    const assets = await repo.getAllAssets();
    assert.deepEqual(assets.map((asset) => asset.type), ['style-sheet', 'style-sheet']);
    assert.deepEqual(assets.map((asset) => JSON.parse(asset.tags) as string[]), [
      ['style-reference', 'legacy-space-style'],
      ['style-reference', 'legacy-space-style'],
    ]);
    const variants = await repo.getAllVariants();
    assert.deepEqual(
      variants.map((variant) => [variant.image_key, variant.thumb_key, variant.media_size_bytes]).sort(),
      [
        ['styles/space-1/one.png', 'styles/space-1/one_thumb.webp', 1024],
        ['styles/space-1/two.webp', 'styles/space-1/two_thumb.webp', 2048],
      ]
    );
    assert.deepEqual((await repo.listCollectionItems(result.collectionId!)).map((item) => item.pinned_variant_id), result.variantIds);
    assert.equal(getRefCount('styles/space-1/one.png'), 2);
    assert.equal(getRefCount('styles/space-1/two.webp'), 2);

    const resolved = await resolveStyleReferences(repo, { useLegacyFallback: true });
    assert.equal(resolved.stylePresetId, result.presetId);
    assert.equal(resolved.styleId, undefined);
    assert.deepEqual(resolved.styleReferenceVariantIds, result.variantIds);
    assert.deepEqual(resolved.styleKeys, [
      'styles/space-1/one.png',
      'styles/space-1/two.webp',
    ]);
  });

  test('backfill does not reuse user collections named Style References', async () => {
    await createAssetWithVariant('unrelated-asset', 'unrelated-variant');
    await repo.createCollection({
      id: 'user-style-references',
      name: 'Style References',
      createdBy: 'user-1',
    });
    await repo.createCollectionItem({
      id: 'unrelated-item',
      collectionId: 'user-style-references',
      subjectType: 'asset',
      assetId: 'unrelated-asset',
      pinnedVariantId: 'unrelated-variant',
      createdBy: 'user-1',
    });
    await repo.createStyle({
      id: 'legacy-style',
      description: 'Watercolor props',
      imageKeys: ['styles/space-1/legacy.png'],
      createdBy: 'user-1',
    });

    const result = await repo.backfillLegacySpaceStyle();
    const resolved = await resolveStyleReferences(repo, { useLegacyFallback: true });

    assert.notEqual(result.collectionId, 'user-style-references');
    assert.deepEqual(
      (await repo.listCollectionItems('user-style-references')).map((item) => item.pinned_variant_id),
      ['unrelated-variant']
    );
    assert.deepEqual((await repo.listCollectionItems(result.collectionId!)).map((item) => item.pinned_variant_id), result.variantIds);
    assert.deepEqual(resolved.styleReferenceVariantIds, result.variantIds);
    assert.deepEqual(resolved.styleKeys, ['styles/space-1/legacy.png']);
  });

  test('backfill refreshes migrated preset after legacy style edits', async () => {
    await repo.createStyle({
      id: 'legacy-style',
      description: 'Old watercolor props',
      imageKeys: ['styles/space-1/old.png'],
      createdBy: 'user-1',
    });
    const first = await repo.backfillLegacySpaceStyle();

    await repo.updateStyle('legacy-style', {
      description: 'Updated ink props',
      imageKeys: ['styles/space-1/new.png'],
    });
    const second = await repo.backfillLegacySpaceStyle();
    const preset = await repo.getStylePresetById(second.presetId!);
    const resolved = await resolveStyleReferences(repo, { useLegacyFallback: true });

    assert.equal(second.collectionId, first.collectionId);
    assert.equal(preset?.style_prompt, 'Updated ink props');
    assert.deepEqual((await repo.listCollectionItems(first.collectionId!)).map((item) => item.pinned_variant_id), second.variantIds);
    assert.deepEqual(resolved.styleReferenceVariantIds, second.variantIds);
    assert.deepEqual(resolved.styleKeys, ['styles/space-1/new.png']);
    assert.equal(getRefCount('styles/space-1/old.png'), 1);
    assert.equal(getRefCount('styles/space-1/new.png'), 2);
  });

  test('backfill disables and removes migrated defaults as legacy style state is cleared', async () => {
    await repo.createStyle({
      id: 'legacy-style',
      description: 'Watercolor props',
      imageKeys: ['styles/space-1/one.png'],
      createdBy: 'user-1',
    });
    const migrated = await repo.backfillLegacySpaceStyle();

    await repo.toggleStyle('legacy-style', false);
    await repo.backfillLegacySpaceStyle();

    let resolved = await resolveStyleReferences(repo, { useLegacyFallback: true });
    assert.equal((await repo.getStylePresetById(migrated.presetId!))?.enabled, 0);
    assert.deepEqual(resolved.styleKeys, []);

    await repo.deleteStyle('legacy-style');
    assert.equal(await repo.getStylePresetById(migrated.presetId!), null);

    await repo.createStyle({
      id: 'replacement-style',
      description: 'Replacement ink props',
      imageKeys: ['styles/space-1/replacement.png'],
      createdBy: 'user-1',
    });
    const replacement = await repo.backfillLegacySpaceStyle();
    resolved = await resolveStyleReferences(repo, { useLegacyFallback: true });

    assert.equal((await repo.getDefaultStylePreset())?.id, replacement.presetId);
    assert.equal(resolved.stylePresetId, replacement.presetId);
    assert.deepEqual(resolved.styleKeys, ['styles/space-1/replacement.png']);
  });

  test('backfill is idempotent across repeated runs', async () => {
    await repo.createStyle({
      id: 'legacy-style',
      description: 'Watercolor props',
      imageKeys: ['styles/space-1/one.png'],
      createdBy: 'user-1',
    });

    const first = await repo.backfillLegacySpaceStyle();
    const second = await repo.backfillLegacySpaceStyle();

    assert.deepEqual(second, first);
    assert.equal((await repo.getAllAssets()).length, 1);
    assert.equal((await repo.getAllVariants()).length, 1);
    assert.equal((await repo.listCollections()).length, 1);
    assert.equal((await repo.listStylePresets()).length, 1);
    assert.equal((await repo.listCollectionItems(first.collectionId!)).length, 1);
    assert.equal(getRefCount('styles/space-1/one.png'), 2);
  });

  test('backfill tolerates missing R2 image metadata', async () => {
    await repo.createStyle({
      id: 'legacy-style',
      description: 'Ink wash silhouettes',
      imageKeys: ['styles/space-1/missing.png'],
      createdBy: 'user-1',
    });
    repo = new SpaceRepository(
      new BetterSqlStorage(db),
      createImageStorage({
        'styles/space-1/missing.png': null,
        'styles/space-1/missing_thumb.webp': null,
      })
    );

    const result = await repo.backfillLegacySpaceStyle();
    const variant = await repo.getVariantById(result.variantIds[0]);

    assert.equal(variant?.image_key, 'styles/space-1/missing.png');
    assert.equal(variant?.thumb_key, null);
    assert.equal(variant?.media_size_bytes, null);
    assert.equal(getRefCount('styles/space-1/missing.png'), 2);
    assert.equal(getRefCount('styles/space-1/missing_thumb.webp'), null);
  });

  test('backfill leaves historical legacy style recipe snapshots displayable', async () => {
    await repo.createStyle({
      id: 'legacy-style',
      description: 'Pastel concept art',
      imageKeys: ['styles/space-1/style.png'],
      createdBy: 'user-1',
    });
    await repo.createAsset({
      id: 'generated-asset',
      name: 'Generated Asset',
      type: 'character',
      tags: [],
      createdBy: 'user-1',
    });
    const historicalRecipe = JSON.stringify({
      operation: 'generate',
      prompt: '[Style: Pastel concept art]\n\nA small cottage',
      assetType: 'scene',
      styleId: 'legacy-style',
      styleImageKeys: ['styles/space-1/style.png'],
      sourceImageKeys: ['styles/space-1/style.png'],
    });
    await repo.createPlaceholderVariant({
      id: 'historical-variant',
      assetId: 'generated-asset',
      recipe: historicalRecipe,
      createdBy: 'user-1',
    });

    await repo.backfillLegacySpaceStyle();
    const variant = await repo.getVariantById('historical-variant');
    const recipe = JSON.parse(variant?.recipe ?? '{}') as {
      styleId?: string;
      styleImageKeys?: string[];
      stylePresetId?: string;
    };

    assert.equal(variant?.recipe, historicalRecipe);
    assert.equal(recipe.styleId, 'legacy-style');
    assert.deepEqual(recipe.styleImageKeys, ['styles/space-1/style.png']);
    assert.equal(recipe.stylePresetId, undefined);
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

  test('overview state includes composition output variants outside the display variant set', async () => {
    await createAssetWithVariant('output', 'output-v1');
    await repo.createVariant({
      id: 'output-v2',
      assetId: 'output',
      imageKey: 'images/output-v2.png',
      thumbKey: 'images/output-v2_thumb.webp',
      recipe: '{}',
      createdBy: 'user-1',
    });
    await repo.updateAsset('output', { active_variant_id: 'output-v2' });
    await repo.createComposition({
      id: 'composition-1',
      name: 'Older approved output',
      outputAssetId: 'output',
      outputVariantId: 'output-v1',
      createdBy: 'user-1',
    });

    const overview = await repo.getOverviewState();

    assert.deepEqual(
      overview.compositions.map((composition) => composition.output_variant_id),
      ['output-v1']
    );
    assert.deepEqual(
      overview.variants.map((variant) => variant.id).sort(),
      ['output-v1', 'output-v2']
    );
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
