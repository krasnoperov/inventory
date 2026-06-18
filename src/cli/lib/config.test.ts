import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getConfigPath,
  loadStoredConfig,
  removeConfig,
  saveConfig,
} from './config';
import type { StoredConfig } from './types';

function storedConfig(environment: string): StoredConfig {
  return {
    environment,
    baseUrl: `https://${environment}.example.test`,
    clientId: 'makefx-cli',
    token: {
      accessToken: `${environment}-token`,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
    user: null,
    updatedAt: '2026-06-16T00:00:00.000Z',
  };
}

test('saveConfig stores staging credentials under the normalized stage key', async () => {
  const previousConfigHome = process.env.XDG_CONFIG_HOME;
  const configHome = await mkdtemp(path.join(os.tmpdir(), 'inventory-cli-config-'));

  try {
    process.env.XDG_CONFIG_HOME = configHome;
    await saveConfig(storedConfig('staging'));

    const saved = JSON.parse(await readFile(await getConfigPath(), 'utf8')) as {
      configs: Record<string, StoredConfig>;
    };

    assert.deepEqual(Object.keys(saved.configs), ['stage']);
    assert.equal(saved.configs.stage.environment, 'stage');
    assert.equal((await loadStoredConfig('stage'))?.token.accessToken, 'staging-token');
  } finally {
    if (previousConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = previousConfigHome;
    }
    await rm(configHome, { recursive: true, force: true });
  }
});

test('loadStoredConfig and removeConfig support legacy staging credentials', async () => {
  const previousConfigHome = process.env.XDG_CONFIG_HOME;
  const configHome = await mkdtemp(path.join(os.tmpdir(), 'inventory-cli-config-'));

  try {
    process.env.XDG_CONFIG_HOME = configHome;
    const legacy = storedConfig('staging');
    await saveConfig(storedConfig('production'));

    const configPath = await getConfigPath();
    const saved = JSON.parse(await readFile(configPath, 'utf8')) as {
      configs: Record<string, StoredConfig>;
    };
    saved.configs.staging = legacy;
    delete saved.configs.stage;
    await writeFile(configPath, JSON.stringify(saved, null, 2), 'utf8');

    assert.equal((await loadStoredConfig('stage'))?.token.accessToken, 'staging-token');

    await removeConfig('stage');
    assert.equal(await loadStoredConfig('stage'), null);
    assert.equal((await loadStoredConfig('production'))?.token.accessToken, 'production-token');
  } finally {
    if (previousConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = previousConfigHome;
    }
    await rm(configHome, { recursive: true, force: true });
  }
});
