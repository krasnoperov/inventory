import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Asset, Variant } from './hooks/useSpaceWebSocket';
import {
  createProductionHandoff,
  formatDuration,
  formatRemotionSceneArgs,
  formatTimelineOffset,
  parseJsonObject,
  parseJsonStringArray,
  sortProductionRecords,
  type ProductionRecord,
} from './productionHandoff';

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    name: 'Market Keyframe',
    type: 'scene',
    media_kind: 'image',
    tags: '',
    parent_asset_id: null,
    active_variant_id: 'variant-1',
    created_by: 'user-1',
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function variant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: 'variant-1',
    asset_id: 'asset-1',
    media_kind: 'image',
    workflow_id: null,
    status: 'completed',
    error_message: null,
    image_key: 'images/space/variant.png',
    thumb_key: 'images/space/variant_thumb.webp',
    media_key: 'images/space/variant.png',
    media_mime_type: 'image/png',
    media_size_bytes: 123,
    media_width: 1920,
    media_height: 1080,
    media_duration_ms: null,
    recipe: '{}',
    starred: false,
    created_by: 'user-1',
    created_at: 1,
    updated_at: 1,
    description: null,
    ...overrides,
  };
}

function record(overrides: Partial<ProductionRecord> = {}): ProductionRecord {
  return {
    id: 'record-1',
    production_id: 'episode-01',
    variant_id: 'variant-1',
    asset_id: 'asset-1',
    media_kind: 'image',
    shot_id: 'shot-001',
    scene_label: 'Market',
    timeline_start_ms: 0,
    duration_ms: 8000,
    motion_prompt: 'Slow dolly-in',
    source_refs: '["script.md"]',
    source_variant_ids: '["source-variant"]',
    metadata: '{"department":"layout"}',
    created_by: 'user-1',
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

describe('production handoff helpers', () => {
  test('sorts production records by timeline, shot, and creation time', () => {
    const sorted = sortProductionRecords([
      record({ id: 'c', shot_id: 'shot-002', timeline_start_ms: 1000, created_at: 1 }),
      record({ id: 'b', shot_id: 'shot-001', timeline_start_ms: 1000, created_at: 2 }),
      record({ id: 'a', shot_id: 'shot-001', timeline_start_ms: 0, created_at: 3 }),
    ]);

    assert.deepEqual(sorted.map(item => item.id), ['a', 'b', 'c']);
  });

  test('parses stored JSON fields defensively', () => {
    assert.deepEqual(parseJsonStringArray('["a","",1,"b"]'), ['a', 'b']);
    assert.deepEqual(parseJsonStringArray('not-json'), []);
    assert.deepEqual(parseJsonObject('{"ok":true}'), { ok: true });
    assert.deepEqual(parseJsonObject('[]'), {});
  });

  test('creates website media handoff records with authenticated media URLs', () => {
    const handoff = createProductionHandoff({
      spaceId: 'space-1',
      productionId: 'episode-01',
      records: [record()],
      assets: [asset()],
      variants: [variant()],
      baseUrl: 'https://inventory.example',
      generatedAt: new Date('2026-01-02T03:04:05.000Z'),
    });

    assert.equal(handoff.format, 'website-production-handoff');
    assert.equal(handoff.generatedAt, '2026-01-02T03:04:05.000Z');
    assert.equal(handoff.records[0].assetName, 'Market Keyframe');
    assert.equal(handoff.records[0].mediaUrl, 'https://inventory.example/api/spaces/space-1/variants/variant-1/media');
    assert.equal(handoff.records[0].metadata.width, 1920);
    assert.deepEqual(handoff.records[0].sourceRefs, ['script.md']);
  });

  test('formats scene args for image and video placements only', () => {
    const handoff = createProductionHandoff({
      spaceId: 'space-1',
      productionId: 'episode-01',
      records: [
        record({ scene_label: "Host's Intro", timeline_start_ms: 1000 }),
        record({ id: 'audio', media_kind: 'audio', scene_label: 'Narration', timeline_start_ms: 0 }),
      ],
      assets: [asset()],
      variants: [variant()],
      baseUrl: '',
      generatedAt: new Date('2026-01-02T03:04:05.000Z'),
    });

    assert.equal(
      formatRemotionSceneArgs(handoff),
      "--scene '1000|Host'\\''s Intro|/api/spaces/space-1/variants/variant-1/media'"
    );
  });

  test('formats timeline offsets and open durations', () => {
    assert.equal(formatTimelineOffset(61005), '1:01.005');
    assert.equal(formatDuration(null), 'Open');
    assert.equal(formatDuration(2500), '0:02.500');
  });
});
