import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  manifestImageFromVariant,
  saveRunManifest,
  type RunManifest,
} from './run-manifest';
import type { Variant } from './websocket-client';

const variant: Variant = {
  id: 'variant-1',
  asset_id: 'asset-1',
  media_kind: 'image',
  workflow_id: null,
  status: 'completed',
  error_message: null,
  image_key: 'images/space/variant-1.png',
  thumb_key: 'images/space/variant-1_thumb.webp',
  recipe: '{}',
  starred: false,
  created_by: 'user-1',
  created_at: 1,
  updated_at: 1,
};

test('manifestImageFromVariant maps variant to video-friendly run image metadata', () => {
  assert.deepEqual(manifestImageFromVariant({
    index: 0,
    variant,
    localPath: 'keyframes/frame-01.png',
    baseUrl: 'https://inventory.example.test',
    spaceId: 'space-1',
  }), {
    index: 0,
    assetId: 'asset-1',
    variantId: 'variant-1',
    imageKey: 'images/space/variant-1.png',
    thumbKey: 'images/space/variant-1_thumb.webp',
    localPath: 'keyframes/frame-01.png',
    webUrl: 'https://inventory.example.test/spaces/space-1/assets/asset-1',
  });
});

test('saveRunManifest writes JSON under .inventory/runs', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-run-'));
  try {
    const manifest: RunManifest = {
      version: 1,
      runId: 'run-1',
      command: 'batch',
      success: true,
      environment: 'stage',
      spaceId: 'space-1',
      baseUrl: 'https://inventory.example.test',
      prompt: 'make frames',
      name: 'Frame',
      assetType: 'scene',
      count: 1,
      mode: 'explore',
      refs: [],
      referenceVariantIds: [],
      outputDir: 'keyframes',
      createdAt: '2026-06-16T00:00:00.000Z',
      completedAt: '2026-06-16T00:00:01.000Z',
      images: [],
      failed: [],
    };

    const manifestPath = await saveRunManifest(manifest, dir);
    const saved = JSON.parse(await readFile(manifestPath, 'utf8')) as RunManifest;

    assert.equal(manifestPath, path.join(dir, '.inventory', 'runs', 'run-1.json'));
    assert.deepEqual(saved, manifest);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
