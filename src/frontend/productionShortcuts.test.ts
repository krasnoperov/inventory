import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyCompositionShortcut,
  applyRelationShortcut,
  buildRelationShortcutOptions,
  COMPOSITION_PLACEMENT_ROLES,
  resolveCompositionPlacementShortcut,
} from './productionShortcuts';
import type { Asset, Composition, CompositionItem, Variant } from './hooks/useSpaceWebSocket';

const baseTime = 1_700_000_000_000;

const scene: Asset = {
  id: 'scene',
  name: 'Scene X',
  type: 'scene',
  media_kind: 'image',
  tags: '',
  parent_asset_id: null,
  active_variant_id: 'scene-v1',
  created_by: 'user-1',
  created_at: baseTime,
  updated_at: baseTime,
};

const thumb: Asset = {
  ...scene,
  id: 'thumb',
  name: 'Scene thumbnail',
  type: 'reference',
  active_variant_id: 'thumb-v1',
};

const outputVariant: Variant = {
  id: 'generated-v1',
  asset_id: 'generated',
  media_kind: 'image',
  workflow_id: null,
  status: 'completed',
  error_message: null,
  image_key: 'images/space/generated.png',
  thumb_key: 'images/space/generated_thumb.webp',
  media_key: 'images/space/generated.png',
  media_mime_type: 'image/png',
  media_size_bytes: 123,
  media_width: 100,
  media_height: 100,
  media_duration_ms: null,
  recipe: '{}',
  starred: false,
  created_by: 'user-1',
  created_at: baseTime,
  updated_at: baseTime,
  description: null,
};

const composition: Composition = {
  id: 'composition-1',
  name: 'Scene X composition',
  description: null,
  status: 'draft',
  output_asset_id: null,
  output_variant_id: null,
  metadata: '{}',
  sort_index: 0,
  created_by: 'user-1',
  created_at: baseTime,
  updated_at: baseTime,
};

const backgroundItem: CompositionItem = {
  id: 'background-item',
  composition_id: 'composition-1',
  role: 'background',
  asset_id: 'old-bg',
  variant_id: 'old-bg-v1',
  metadata: '{}',
  sort_index: 0,
  created_by: 'user-1',
  created_at: baseTime,
  updated_at: baseTime,
};

describe('production shortcuts', () => {
  test('generate-to-composition output updates the ordinary composition output fields', () => {
    const calls: unknown[] = [];

    applyCompositionShortcut(
      { kind: 'output', compositionId: composition.id },
      outputVariant,
      [],
      {
        updateComposition: (...args) => calls.push(['updateComposition', ...args]),
        createCompositionItem: (...args) => calls.push(['createCompositionItem', ...args]),
        updateCompositionItem: (...args) => calls.push(['updateCompositionItem', ...args]),
      },
    );

    assert.deepEqual(calls, [[
      'updateComposition',
      'composition-1',
      { outputAssetId: 'generated', outputVariantId: 'generated-v1' },
    ]]);
  });

  test('refine-replace-slot updates the selected composition item without lineage changes', () => {
    const calls: unknown[] = [];

    applyCompositionShortcut(
      { kind: 'slot', compositionId: composition.id, role: 'background', itemId: backgroundItem.id },
      outputVariant,
      [backgroundItem],
      {
        updateComposition: (...args) => calls.push(['updateComposition', ...args]),
        createCompositionItem: (...args) => calls.push(['createCompositionItem', ...args]),
        updateCompositionItem: (...args) => calls.push(['updateCompositionItem', ...args]),
      },
    );

    assert.deepEqual(calls, [[
      'updateCompositionItem',
      'composition-1',
      'background-item',
      { assetId: 'generated', variantId: 'generated-v1' },
    ]]);
  });

  test('upload-to-slot creates an ordinary composition item at the next sort index', () => {
    const calls: unknown[] = [];

    applyCompositionShortcut(
      { kind: 'slot', compositionId: composition.id, role: 'thumbnail' },
      outputVariant,
      [backgroundItem],
      {
        updateComposition: (...args) => calls.push(['updateComposition', ...args]),
        createCompositionItem: (...args) => calls.push(['createCompositionItem', ...args]),
        updateCompositionItem: (...args) => calls.push(['updateCompositionItem', ...args]),
      },
    );

    assert.deepEqual(calls, [[
      'createCompositionItem',
      'composition-1',
      { role: 'thumbnail', assetId: 'generated', variantId: 'generated-v1', sortIndex: 1 },
    ]]);
  });

  test('upload-thumbnail relation creates an ordinary manual relation from the uploaded variant', () => {
    const calls: unknown[] = [];

    applyRelationShortcut(
      {
        kind: 'relation',
        relationType: 'thumbnail_for',
        object: { subjectType: 'asset', assetId: scene.id },
      },
      { ...outputVariant, id: 'thumb-v1', asset_id: thumb.id },
      (...args) => calls.push(args),
    );

    assert.deepEqual(calls, [[{
      subject: { subjectType: 'variant', variantId: 'thumb-v1' },
      object: { subjectType: 'asset', assetId: 'scene' },
      relationType: 'thumbnail_for',
      context: null,
    }]]);
  });

  test('placement roles offer output plus every composition slot in product language', () => {
    const labels = COMPOSITION_PLACEMENT_ROLES.map((option) => option.label);
    assert.equal(COMPOSITION_PLACEMENT_ROLES[0].role, 'output');
    assert.deepEqual(labels, [
      'Output',
      'Background',
      'Character',
      'Prop',
      'Style reference',
      'Overlay',
      'Map',
      'Thumbnail',
    ]);
  });

  test('placement resolver replaces an existing single-slot item but appends multi-slot roles', () => {
    // background is single-slot: reuse the existing item so we replace, not duplicate.
    assert.deepEqual(
      resolveCompositionPlacementShortcut('composition-1', 'background', [backgroundItem]),
      { kind: 'slot', compositionId: 'composition-1', role: 'background', itemId: 'background-item' },
    );
    // character is multi-slot: always append a fresh item.
    assert.deepEqual(
      resolveCompositionPlacementShortcut('composition-1', 'character', [backgroundItem]),
      { kind: 'slot', compositionId: 'composition-1', role: 'character' },
    );
    // output targets the composition's main result rather than a slot.
    assert.deepEqual(
      resolveCompositionPlacementShortcut('composition-1', 'output', [backgroundItem]),
      { kind: 'output', compositionId: 'composition-1' },
    );
  });

  test('relation shortcut labels use product language', () => {
    const relationOptions = buildRelationShortcutOptions([scene]).map((option) => option.label);
    assert.ok(relationOptions.includes('Mark as thumbnail for Scene X'));
    assert.ok(relationOptions.includes('Use as background in Scene X'));
  });
});
