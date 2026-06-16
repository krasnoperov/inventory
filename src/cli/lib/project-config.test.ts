import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getProjectConfigPath,
  loadProjectConfig,
  saveProjectConfig,
} from './project-config';

test('saveProjectConfig writes a minimal local project binding', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-project-'));
  try {
    const configPath = await saveProjectConfig({
      environment: 'stage',
      spaceId: 'space-1',
    }, dir);

    const config = await loadProjectConfig(dir);

    assert.equal(configPath, getProjectConfigPath(dir));
    assert.ok(config);
    assert.equal(typeof config.updatedAt, 'string');
    assert.deepEqual(config, {
      version: 1,
      environment: 'stage',
      spaceId: 'space-1',
      updatedAt: config.updatedAt,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadProjectConfig searches parent directories', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-project-'));
  try {
    const child = path.join(dir, 'episodes', 'scene-1');
    await saveProjectConfig({
      environment: 'local',
      spaceId: 'space-local',
    }, dir);

    const config = await loadProjectConfig(child);
    assert.equal(config?.environment, 'local');
    assert.equal(config?.spaceId, 'space-local');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadProjectConfig returns null outside initialized projects', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-project-'));
  try {
    assert.equal(await loadProjectConfig(dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
