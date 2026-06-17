import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  manifestImageFromVariant,
  manifestMediaFromVariant,
  readRunManifest,
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
    mediaKind: 'image',
    assetId: 'asset-1',
    variantId: 'variant-1',
    mediaKey: 'images/space/variant-1.png',
    imageKey: 'images/space/variant-1.png',
    thumbKey: 'images/space/variant-1_thumb.webp',
    mimeType: null,
    sizeBytes: null,
    width: null,
    height: null,
    durationMs: null,
    localPath: 'keyframes/frame-01.png',
    webUrl: 'https://inventory.example.test/spaces/space-1/assets/asset-1',
  });
});

test('manifestMediaFromVariant maps audio and video media metadata', () => {
  assert.deepEqual(manifestMediaFromVariant({
    index: 0,
    variant: {
      ...variant,
      media_kind: 'audio',
      image_key: null,
      thumb_key: null,
      media_key: 'media/space/variant-1.wav',
      media_mime_type: 'audio/wav',
      media_size_bytes: 1234,
      media_duration_ms: 2500,
    },
    localPath: 'audio/cue-01.wav',
    baseUrl: 'https://inventory.example.test',
    spaceId: 'space-1',
  }), {
    index: 0,
    mediaKind: 'audio',
    assetId: 'asset-1',
    variantId: 'variant-1',
    mediaKey: 'media/space/variant-1.wav',
    imageKey: null,
    thumbKey: null,
    mimeType: 'audio/wav',
    sizeBytes: 1234,
    width: null,
    height: null,
    durationMs: 2500,
    localPath: 'audio/cue-01.wav',
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
      mediaKind: 'image',
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
      media: [],
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

test('readRunManifest normalizes legacy image-only manifests', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-run-legacy-'));
  try {
    const manifestPath = path.join(dir, '.inventory', 'runs', 'legacy.json');
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, JSON.stringify({
      version: 1,
      runId: 'legacy',
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
      images: [{
        index: 0,
        assetId: 'asset-1',
        variantId: 'variant-1',
        imageKey: 'images/space/variant-1.png',
        thumbKey: null,
        localPath: 'keyframes/frame-01.png',
        webUrl: 'https://inventory.example.test/spaces/space-1/assets/asset-1',
      }],
      failed: [],
    }), 'utf8');

    const record = await readRunManifest(manifestPath);

    assert.equal(record.manifest.mediaKind, 'image');
    assert.equal(record.manifest.media[0].mediaKey, 'images/space/variant-1.png');
    assert.equal(record.manifest.images[0].imageKey, 'images/space/variant-1.png');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
