import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeRuns } from './runs';
import type { ProjectConfig } from '../lib/project-config';
import {
  listRunManifests,
  readRunManifest,
  resolveRunManifest,
  saveRunManifest,
  type RunManifest,
} from '../lib/run-manifest';

function manifest(overrides: Partial<RunManifest> = {}): RunManifest {
  const runId = overrides.runId || 'run-1';
  return {
    version: 1,
    runId,
    command: 'batch',
    mediaKind: 'image',
    success: true,
    environment: 'stage',
    spaceId: 'space-1',
    baseUrl: 'https://inventory.example.test',
    prompt: 'make frames',
    name: 'Keyframes',
    assetType: 'scene',
    count: 2,
    mode: 'set',
    refs: ['variant-ref'],
    referenceVariantIds: ['variant-ref'],
    outputDir: 'keyframes',
    createdAt: '2026-06-16T00:00:00.000Z',
    completedAt: '2026-06-16T00:00:01.000Z',
    media: [
      {
        index: 1,
        mediaKind: 'image',
        assetId: 'asset-2',
        variantId: 'variant-2',
        mediaKey: 'images/space/variant-2.png',
        imageKey: 'images/space/variant-2.png',
        thumbKey: null,
        mimeType: 'image/png',
        sizeBytes: null,
        width: null,
        height: null,
        durationMs: null,
        localPath: 'keyframes/frame-02.png',
        webUrl: 'https://inventory.example.test/spaces/space-1/assets/asset-2',
      },
      {
        index: 0,
        mediaKind: 'image',
        assetId: 'asset-1',
        variantId: 'variant-1',
        mediaKey: 'images/space/variant-1.png',
        imageKey: 'images/space/variant-1.png',
        thumbKey: null,
        mimeType: 'image/png',
        sizeBytes: null,
        width: null,
        height: null,
        durationMs: null,
        localPath: 'keyframes/frame-01.png',
        webUrl: 'https://inventory.example.test/spaces/space-1/assets/asset-1',
      },
    ],
    images: [
      {
        index: 1,
        mediaKind: 'image',
        assetId: 'asset-2',
        variantId: 'variant-2',
        mediaKey: 'images/space/variant-2.png',
        imageKey: 'images/space/variant-2.png',
        thumbKey: null,
        mimeType: 'image/png',
        sizeBytes: null,
        width: null,
        height: null,
        durationMs: null,
        localPath: 'keyframes/frame-02.png',
        webUrl: 'https://inventory.example.test/spaces/space-1/assets/asset-2',
      },
      {
        index: 0,
        mediaKind: 'image',
        assetId: 'asset-1',
        variantId: 'variant-1',
        mediaKey: 'images/space/variant-1.png',
        imageKey: 'images/space/variant-1.png',
        thumbKey: null,
        mimeType: 'image/png',
        sizeBytes: null,
        width: null,
        height: null,
        durationMs: null,
        localPath: 'keyframes/frame-01.png',
        webUrl: 'https://inventory.example.test/spaces/space-1/assets/asset-1',
      },
    ],
    failed: [],
    ...overrides,
  };
}

function depsFor(projectRoot: string, output: string[]) {
  const projectConfig: ProjectConfig = {
    version: 1,
    environment: 'stage',
    spaceId: 'space-1',
    updatedAt: '2026-06-16T00:00:00.000Z',
    configPath: path.join(projectRoot, '.inventory', 'config.json'),
    projectRoot,
  };

  return {
    loadProjectConfig: async () => projectConfig,
    listRunManifests,
    readRunManifest,
    resolveRunManifest,
    writeFile,
    print: (message: string) => output.push(message),
  };
}

test('runs lists manifests from the initialized project root', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-runs-'));
  try {
    await saveRunManifest(manifest({ runId: 'older', createdAt: '2026-06-16T00:00:00.000Z' }), dir);
    await saveRunManifest(manifest({ runId: 'newer', createdAt: '2026-06-16T00:01:00.000Z' }), dir);
    const output: string[] = [];

    const result = await executeRuns({ positionals: [], options: {} }, depsFor(dir, output));

    assert.equal(result.type, 'list');
    assert.deepEqual(result.records.map((record) => record.manifest.runId), ['newer', 'older']);
    assert.match(output.join('\n'), /Found 2 run\(s\)/);
    assert.match(output.join('\n'), /newer/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runs show supports --latest and JSON output by run ID', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-runs-'));
  try {
    await saveRunManifest(manifest({ runId: 'older', createdAt: '2026-06-16T00:00:00.000Z' }), dir);
    await saveRunManifest(manifest({ runId: 'newer', createdAt: '2026-06-16T00:01:00.000Z' }), dir);

    const latestOutput: string[] = [];
    const latest = await executeRuns(
      { positionals: ['show'], options: { latest: 'true' } },
      depsFor(dir, latestOutput)
    );
    assert.equal(latest.type, 'show');
    assert.equal(latest.record.manifest.runId, 'newer');
    assert.match(latestOutput.join('\n'), /Run newer/);

    const jsonOutput: string[] = [];
    const byId = await executeRuns(
      { positionals: ['show', 'older'], options: { json: 'true' } },
      depsFor(dir, jsonOutput)
    );
    assert.equal(byId.type, 'show');
    assert.equal(JSON.parse(jsonOutput.join('\n')).runId, 'older');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runs export writes ordered Remotion keyframe data', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-runs-'));
  try {
    const workingDir = path.join(dir, 'episode', 'scene');
    await saveRunManifest(manifest({
      runId: 'run-export',
      workingDir,
      failed: [{ variantId: 'variant-failed', error: 'failed frame' }],
      success: false,
    }), dir);
    const outputPath = path.join(dir, 'keyframes.json');
    const output: string[] = [];

    const result = await executeRuns({
      positionals: ['export'],
      options: {
        latest: 'true',
        format: 'remotion',
        o: outputPath,
      },
    }, depsFor(dir, output));

    assert.equal(result.type, 'export');
    const exported = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(exported.format, 'remotion-keyframes');
    assert.equal(exported.runId, 'run-export');
    assert.deepEqual(exported.media.map((media: { variantId: string }) => media.variantId), ['variant-1', 'variant-2']);
    assert.equal(exported.media[0].absolutePath, path.join(workingDir, 'keyframes/frame-01.png'));
    assert.deepEqual(exported.images.map((image: { variantId: string }) => image.variantId), ['variant-1', 'variant-2']);
    assert.equal(exported.images[0].absolutePath, path.join(workingDir, 'keyframes/frame-01.png'));
    assert.deepEqual(exported.failed, [{ variantId: 'variant-failed', error: 'failed frame' }]);
    assert.match(output.join('\n'), /Wrote remotion export/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runs export defaults to generic ordered media handoff data', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-runs-'));
  try {
    const workingDir = path.join(dir, 'episode', 'scene');
    await saveRunManifest(manifest({
      runId: 'run-media-export',
      workingDir,
      mediaKind: 'audio',
      media: [
        {
          index: 0,
          mediaKind: 'audio',
          assetId: 'asset-audio',
          variantId: 'variant-audio',
          mediaKey: 'media/space/variant-audio.wav',
          imageKey: null,
          thumbKey: null,
          mimeType: 'audio/wav',
          sizeBytes: 1234,
          width: null,
          height: null,
          durationMs: 2500,
          localPath: 'audio/cue-01.wav',
          webUrl: 'https://inventory.example.test/spaces/space-1/assets/asset-audio',
        },
      ],
      images: [],
    }), dir);
    const outputPath = path.join(dir, 'media-run.json');
    const output: string[] = [];

    const result = await executeRuns({
      positionals: ['export'],
      options: {
        latest: 'true',
        o: outputPath,
      },
    }, depsFor(dir, output));

    assert.equal(result.type, 'export');
    assert.equal(result.format, 'media');
    const exported = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(exported.format, 'media-handoff');
    assert.deepEqual(exported.media.map((media: { variantId: string }) => media.variantId), ['variant-audio']);
    assert.equal(exported.media[0].absolutePath, path.join(workingDir, 'audio/cue-01.wav'));
    assert.deepEqual(exported.images, []);
    assert.match(output.join('\n'), /Wrote media export/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runs export remotion-scenes sorts production scenes by timeline', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-runs-'));
  try {
    await saveRunManifest(manifest({
      runId: 'shot-02',
      createdAt: '2026-06-16T00:02:00.000Z',
      scene: {
        productionId: 's01e01-a2',
        shotId: 's01e01-a2-02',
        sceneLabel: 'Escalera',
        timelineStartMs: 72760,
        durationMs: 39600,
        sourceRefs: ['variant-keyframe-2'],
        sourceVariantIds: ['variant-keyframe-2'],
      },
      media: [{
        index: 0,
        mediaKind: 'video',
        assetId: 'asset-video-2',
        variantId: 'variant-video-2',
        mediaKey: 'media/space/variant-video-2.mp4',
        imageKey: null,
        thumbKey: null,
        mimeType: 'video/mp4',
        sizeBytes: null,
        width: null,
        height: null,
        durationMs: 39600,
        localPath: 'clips/clip-002.mp4',
        webUrl: 'https://inventory.example.test/spaces/space-1/assets/asset-video-2',
      }],
      images: [],
    }), dir);
    await saveRunManifest(manifest({
      runId: 'shot-01',
      createdAt: '2026-06-16T00:01:00.000Z',
      scene: {
        productionId: 's01e01-a2',
        shotId: 's01e01-a2-01',
        sceneLabel: 'Cocina',
        timelineStartMs: 0,
        durationMs: 73000,
        sourceRefs: ['variant-keyframe-1'],
        sourceVariantIds: ['variant-keyframe-1'],
      },
    }), dir);
    const output: string[] = [];

    const result = await executeRuns({
      positionals: ['export'],
      options: {
        format: 'remotion-scenes',
        'production-id': 's01e01-a2',
      },
    }, depsFor(dir, output));

    assert.equal(result.type, 'export');
    const exported = result.exportData as { scenes: Array<{ sceneLabel: string; timelineStartMs: number; mediaKind: string }> };
    assert.deepEqual(exported.scenes.map((scene) => scene.sceneLabel), ['Cocina', 'Escalera']);
    assert.deepEqual(exported.scenes.map((scene) => scene.timelineStartMs), [0, 72760]);
    assert.deepEqual(exported.scenes.map((scene) => scene.mediaKind), ['image', 'video']);
    const lines = output.join('\n').split('\n');
    assert.match(lines[0], /^--scene '0\|Cocina\|.*keyframes\/frame-01\.png'$/);
    assert.match(lines[1], /^--scene '72760\|Escalera\|.*clips\/clip-002\.mp4'$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runs export remotion-scenes fails clearly when required scene metadata is missing', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-runs-'));
  try {
    await saveRunManifest(manifest({
      runId: 'missing-label',
      scene: {
        productionId: 's01e01-a2',
        timelineStartMs: 0,
        sourceRefs: [],
        sourceVariantIds: [],
      },
    }), dir);

    await assert.rejects(
      () => executeRuns({
        positionals: ['export'],
        options: {
          latest: 'true',
          format: 'remotion-scenes',
        },
      }, depsFor(dir, [])),
      /missing scene label: missing-label/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runs export remotion-scenes prefers video clip assets over image fallback', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-runs-'));
  try {
    await saveRunManifest(manifest({
      runId: 'video-shot',
      scene: {
        productionId: 's01e01-a2',
        shotId: 's01e01-a2-01',
        sceneLabel: 'Bar',
        timelineStartMs: 112360,
        durationMs: 5000,
        motionPrompt: 'handheld move',
        sourceRefs: ['variant-keyframe'],
        sourceVariantIds: ['variant-keyframe'],
      },
      mediaKind: 'video',
      media: [
        {
          index: 0,
          mediaKind: 'image',
          assetId: 'asset-keyframe',
          variantId: 'variant-keyframe',
          mediaKey: 'images/space/variant-keyframe.png',
          imageKey: 'images/space/variant-keyframe.png',
          thumbKey: null,
          mimeType: 'image/png',
          sizeBytes: null,
          width: null,
          height: null,
          durationMs: null,
          localPath: 'keyframes/shot-01.png',
          webUrl: 'https://inventory.example.test/spaces/space-1/assets/asset-keyframe',
        },
        {
          index: 1,
          mediaKind: 'video',
          assetId: 'asset-video',
          variantId: 'variant-video',
          mediaKey: 'media/space/variant-video.mp4',
          imageKey: null,
          thumbKey: null,
          mimeType: 'video/mp4',
          sizeBytes: null,
          width: null,
          height: null,
          durationMs: 5000,
          localPath: 'clips/clip-001.mp4',
          webUrl: 'https://inventory.example.test/spaces/space-1/assets/asset-video',
        },
      ],
      images: [],
    }), dir);
    const outputPath = path.join(dir, 'scenes.json');

    const result = await executeRuns({
      positionals: ['export'],
      options: {
        latest: 'true',
        format: 'remotion-scenes',
        json: 'true',
        o: outputPath,
      },
    }, depsFor(dir, []));

    assert.equal(result.type, 'export');
    const exported = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(exported.format, 'remotion-scenes');
    assert.equal(exported.scenes[0].mediaKind, 'video');
    assert.equal(exported.scenes[0].variantId, 'variant-video');
    assert.match(exported.scenes[0].absolutePath, /clips\/clip-001\.mp4$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
