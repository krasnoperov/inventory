import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  describeMirrorMismatch,
  getMirrorRegistryPath,
  readMirrorRegistry,
  recordMirrorForFile,
  resolveMirrorForFile,
} from './mirror-store';

test('mirror registry missing file returns an empty registry', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'makefx-mirror-'));
  try {
    const registry = await readMirrorRegistry(projectRoot);
    assert.deepEqual(registry, { version: 1, entries: [] });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('mirror registry records and resolves entries by digest', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'makefx-mirror-'));
  const filePath = path.join(projectRoot, 'cast', 'anna.png');
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, new Uint8Array([1, 2, 3]));

    const entry = await recordMirrorForFile({
      projectRoot,
      baseUrl: 'https://makefx.example.test',
      environment: 'stage',
      spaceId: 'space-1',
      filePath,
      assetId: 'asset-anna',
      variantId: 'variant-anna',
      mediaKind: 'image',
      mediaKey: 'images/space-1/variant-anna.png',
    });

    assert.equal(entry.paths[0], 'cast/anna.png');

    const resolved = await resolveMirrorForFile({
      projectRoot,
      baseUrl: 'https://makefx.example.test',
      environment: 'stage',
      spaceId: 'space-1',
      filePath,
      mediaKind: 'image',
    });

    assert.equal(resolved.digestEntry?.variantId, 'variant-anna');
    assert.equal(resolved.pathEntry?.variantId, 'variant-anna');
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('mirror registry keeps path aliases for the same content digest', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'makefx-mirror-'));
  const firstPath = path.join(projectRoot, 'cast', 'anna.png');
  const secondPath = path.join(projectRoot, 'refs', 'anna-copy.png');
  try {
    await mkdir(path.dirname(firstPath), { recursive: true });
    await mkdir(path.dirname(secondPath), { recursive: true });
    await writeFile(firstPath, new Uint8Array([1, 2, 3]));
    await writeFile(secondPath, new Uint8Array([1, 2, 3]));

    await recordMirrorForFile({
      projectRoot,
      baseUrl: 'https://makefx.example.test',
      spaceId: 'space-1',
      filePath: firstPath,
      assetId: 'asset-anna',
      variantId: 'variant-anna',
      mediaKind: 'image',
    });
    const entry = await recordMirrorForFile({
      projectRoot,
      baseUrl: 'https://makefx.example.test',
      spaceId: 'space-1',
      filePath: secondPath,
      assetId: 'asset-anna',
      variantId: 'variant-anna',
      mediaKind: 'image',
    });

    assert.deepEqual(entry.paths, ['cast/anna.png', 'refs/anna-copy.png']);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('mirror registry isolates entries by base URL and space', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'makefx-mirror-'));
  const filePath = path.join(projectRoot, 'cast', 'anna.png');
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, new Uint8Array([1, 2, 3]));
    await recordMirrorForFile({
      projectRoot,
      baseUrl: 'https://makefx.example.test',
      spaceId: 'space-1',
      filePath,
      assetId: 'asset-anna',
      variantId: 'variant-anna',
      mediaKind: 'image',
    });

    assert.equal((await resolveMirrorForFile({
      projectRoot,
      baseUrl: 'https://other.example.test',
      spaceId: 'space-1',
      filePath,
      mediaKind: 'image',
    })).digestEntry, undefined);
    assert.equal((await resolveMirrorForFile({
      projectRoot,
      baseUrl: 'https://makefx.example.test',
      spaceId: 'space-2',
      filePath,
      mediaKind: 'image',
    })).digestEntry, undefined);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('mirror registry detects a changed file at a known path', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'makefx-mirror-'));
  const filePath = path.join(projectRoot, 'cast', 'anna.png');
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, new Uint8Array([1, 2, 3]));
    await recordMirrorForFile({
      projectRoot,
      baseUrl: 'https://makefx.example.test',
      spaceId: 'space-1',
      filePath,
      assetId: 'asset-anna',
      variantId: 'variant-anna',
      mediaKind: 'image',
    });
    await writeFile(filePath, new Uint8Array([4, 5, 6]));

    const resolved = await resolveMirrorForFile({
      projectRoot,
      baseUrl: 'https://makefx.example.test',
      spaceId: 'space-1',
      filePath,
      mediaKind: 'image',
    });

    assert.equal(resolved.digestEntry, undefined);
    assert.equal(resolved.pathEntry?.variantId, 'variant-anna');
    assert.match(describeMirrorMismatch(filePath, resolved.pathEntry!), /Local reference changed/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('mirror registry moves a path alias when the same file is recorded again', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'makefx-mirror-'));
  const filePath = path.join(projectRoot, 'cast', 'anna.png');
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, new Uint8Array([1, 2, 3]));
    const first = await recordMirrorForFile({
      projectRoot,
      baseUrl: 'https://makefx.example.test',
      spaceId: 'space-1',
      filePath,
      assetId: 'asset-old',
      variantId: 'variant-old',
      mediaKind: 'image',
    });
    await writeFile(filePath, new Uint8Array([4, 5, 6]));
    const second = await recordMirrorForFile({
      projectRoot,
      baseUrl: 'https://makefx.example.test',
      spaceId: 'space-1',
      filePath,
      assetId: 'asset-new',
      variantId: 'variant-new',
      mediaKind: 'image',
    });

    const registry = await readMirrorRegistry(projectRoot);
    const oldEntry = registry.entries.find((entry) => entry.sha256 === first.sha256);
    const newEntry = registry.entries.find((entry) => entry.sha256 === second.sha256);
    assert.deepEqual(oldEntry?.paths, []);
    assert.deepEqual(newEntry?.paths, ['cast/anna.png']);

    const resolved = await resolveMirrorForFile({
      projectRoot,
      baseUrl: 'https://makefx.example.test',
      spaceId: 'space-1',
      filePath,
      mediaKind: 'image',
    });
    assert.equal(resolved.pathEntry?.variantId, 'variant-new');
    assert.equal(resolved.digestEntry?.variantId, 'variant-new');
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('mirror registry reports corrupt JSON with repair guidance', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'makefx-mirror-'));
  try {
    const registryPath = getMirrorRegistryPath(projectRoot);
    await mkdir(path.dirname(registryPath), { recursive: true });
    await writeFile(registryPath, '{nope', 'utf8');
    await assert.rejects(
      () => readMirrorRegistry(projectRoot),
      /Mirror registry is not valid JSON.*delete it so the CLI can recreate it/
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('mirror registry writes the final JSON file', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'makefx-mirror-'));
  const filePath = path.join(projectRoot, 'cast', 'anna.png');
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, new Uint8Array([1, 2, 3]));
    const registryPath = getMirrorRegistryPath(projectRoot);
    await recordMirrorForFile({
      projectRoot,
      baseUrl: 'https://makefx.example.test',
      spaceId: 'space-1',
      filePath,
      assetId: 'asset-anna',
      variantId: 'variant-anna',
      mediaKind: 'image',
    });

    const raw = await readFile(registryPath, 'utf8');
    assert.equal(JSON.parse(raw).entries[0].variantId, 'variant-anna');
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
