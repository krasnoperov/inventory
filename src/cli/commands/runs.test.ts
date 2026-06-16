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
    images: [
      {
        index: 1,
        assetId: 'asset-2',
        variantId: 'variant-2',
        imageKey: 'images/space/variant-2.png',
        thumbKey: null,
        localPath: 'keyframes/frame-02.png',
        webUrl: 'https://inventory.example.test/spaces/space-1/assets/asset-2',
      },
      {
        index: 0,
        assetId: 'asset-1',
        variantId: 'variant-1',
        imageKey: 'images/space/variant-1.png',
        thumbKey: null,
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
    assert.deepEqual(exported.images.map((image: { variantId: string }) => image.variantId), ['variant-1', 'variant-2']);
    assert.equal(exported.images[0].absolutePath, path.join(workingDir, 'keyframes/frame-01.png'));
    assert.deepEqual(exported.failed, [{ variantId: 'variant-failed', error: 'failed frame' }]);
    assert.match(output.join('\n'), /Wrote remotion export/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
