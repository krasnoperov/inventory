import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeAssets } from './assets';
import { loadProjectConfig, saveProjectConfig, type ProjectConfig } from '../lib/project-config';
import type { StoredConfig } from '../lib/types';

const asset = {
  id: 'asset-1',
  name: 'Russafa Market',
  type: 'scene',
  media_kind: 'video',
  parent_asset_id: null,
  active_variant_id: 'variant-1',
  created_at: Date.UTC(2026, 5, 16, 10, 0, 0),
  updated_at: Date.UTC(2026, 5, 16, 11, 0, 0),
};

const variant = {
  id: 'variant-1',
  asset_id: 'asset-1',
  media_kind: 'video',
  status: 'completed',
  image_key: 'images/space-1/variant-1.png',
  thumb_key: 'thumbs/space-1/variant-1.webp',
  media_key: 'media/space-1/variant-1.mp4',
  media_mime_type: 'video/mp4',
  generation_provenance: JSON.stringify({
    operation: 'generate',
    assetType: 'scene',
    mediaKind: 'video',
    model: 'veo-3.1-generate-preview',
    prompt: 'Market opening shot',
  }),
  provider_metadata: JSON.stringify({
    provider: 'google-veo',
    model: 'veo-3.1-generate-preview',
    operation: 'generate',
    resolution: '720p',
    durationSeconds: 8,
  }),
  recipe: '{}',
  starred: false,
  error_message: null,
  created_at: Date.UTC(2026, 5, 16, 10, 0, 0),
  updated_at: Date.UTC(2026, 5, 16, 11, 0, 0),
};

function projectConfig(): ProjectConfig {
  return {
    version: 1,
    environment: 'stage',
    spaceId: 'space-1',
    updatedAt: '2026-06-16T00:00:00.000Z',
    configPath: '/tmp/project/.inventory/config.json',
    projectRoot: '/tmp/project',
  };
}

function storedConfig(): StoredConfig {
  return {
    environment: 'stage',
    baseUrl: 'https://inventory.example.test',
    clientId: 'forgetray-cli',
    token: {
      accessToken: 'token-1',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
    user: null,
    updatedAt: '2026-06-16T00:00:00.000Z',
  };
}

function depsFor(output: string[], downloads: unknown[] = []) {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const deps = {
    loadConfig: async () => storedConfig(),
    loadProjectConfig: async () => projectConfig(),
    resolveBaseUrl: () => 'https://inventory.example.test',
    fetch: async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);
      requests.push({
        url: requestUrl,
        authorization: init?.headers instanceof Headers
          ? init.headers.get('authorization')
          : (init?.headers as Record<string, string> | undefined)?.Authorization || null,
      });
      const pathname = new URL(requestUrl).pathname;
      if (pathname === '/api/spaces/space-1/assets') {
        return jsonResponse({ success: true, assets: [asset] });
      }
      if (pathname === '/api/spaces/space-1/assets/asset-1') {
        return jsonResponse({
          success: true,
          asset,
          variants: [variant],
          lineage: [{
            id: 'lineage-1',
            parent_variant_id: 'source-variant',
            child_variant_id: 'variant-1',
            relation_type: 'derived',
            severed: false,
            created_at: Date.UTC(2026, 5, 16, 10, 30, 0),
          }],
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    },
    downloadFile: async (input: unknown) => {
      downloads.push(input);
    },
    print: (message: string) => output.push(message),
  };
  return { deps, requests };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('assets lists website assets from the initialized project', async () => {
  const output: string[] = [];
  const { deps, requests } = depsFor(output);

  const result = await executeAssets({ positionals: [], options: {} }, deps);

  assert.equal(result.type, 'list');
  assert.equal(result.assets[0].id, 'asset-1');
  assert.match(output.join('\n'), /Russafa Market/);
  assert.match(output.join('\n'), /Media/);
  assert.match(output.join('\n'), /video/);
  assert.deepEqual(requests, [{
    url: 'https://inventory.example.test/api/spaces/space-1/assets',
    authorization: 'Bearer token-1',
  }]);
});

test('assets discovers project binding from child directories', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inventory-assets-'));
  const child = path.join(root, 'episode', 'scene');
  const previousCwd = process.cwd();
  try {
    await saveProjectConfig({ environment: 'stage', spaceId: 'space-1' }, root);
    await mkdir(child, { recursive: true });
    process.chdir(child);

    const output: string[] = [];
    const { deps } = depsFor(output);
    const result = await executeAssets({ positionals: [], options: {} }, {
      ...deps,
      loadProjectConfig,
    });

    assert.equal(result.type, 'list');
    assert.equal(result.assets[0].id, 'asset-1');
  } finally {
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  }
});

test('assets list and show support JSON output', async () => {
  const listOutput: string[] = [];
  const listDeps = depsFor(listOutput).deps;

  await executeAssets({ positionals: ['list'], options: { json: 'true' } }, listDeps);
  const listed = JSON.parse(listOutput.join('\n'));
  assert.deepEqual(listed[0], {
    id: 'asset-1',
    name: 'Russafa Market',
    type: 'scene',
    media_kind: 'video',
    activeVariantId: 'variant-1',
    parentAssetId: null,
    createdAt: asset.created_at,
    updatedAt: asset.updated_at,
  });

  const showOutput: string[] = [];
  const showDeps = depsFor(showOutput).deps;
  const result = await executeAssets({ positionals: ['show', 'asset-1'], options: { json: 'true' } }, showDeps);
  assert.equal(result.type, 'show');
  const details = JSON.parse(showOutput.join('\n'));
  assert.equal(details.asset.id, 'asset-1');
  assert.equal(details.asset.media_kind, 'video');
  assert.equal(details.variants[0].id, 'variant-1');
  assert.equal(details.variants[0].media_kind, 'video');
  assert.equal(details.variants[0].media_key, 'media/space-1/variant-1.mp4');
  assert.equal(details.variants[0].generation_provenance, variant.generation_provenance);
  assert.equal(details.variants[0].provider_metadata, variant.provider_metadata);
  assert.equal(details.lineage[0].relation_type, 'derived');
});

test('assets show prints asset, variant media kind, and generation metadata', async () => {
  const output: string[] = [];
  const showDeps = depsFor(output).deps;

  const result = await executeAssets({ positionals: ['show', 'asset-1'], options: {} }, showDeps);

  assert.equal(result.type, 'show');
  const text = output.join('\n');
  assert.ok(text.includes('  Media:    video'));
  assert.ok(text.includes('     Media:  video'));
  assert.ok(text.includes('     File:   media/space-1/variant-1.mp4'));
  assert.ok(text.includes('     Provenance: operation=generate assetType=scene mediaKind=video model=veo-3.1-generate-preview prompt=Market opening shot'));
  assert.ok(text.includes('     Provider:   provider=google-veo model=veo-3.1-generate-preview operation=generate resolution=720p durationSeconds=8'));
});

test('assets download resolves a variant ID to its canonical media key', async () => {
  const output: string[] = [];
  const downloads: unknown[] = [];
  const { deps } = depsFor(output, downloads);

  const result = await executeAssets({
    positionals: ['download', 'variant-1'],
    options: { o: 'references/variant.png' },
  }, deps);

  assert.equal(result.type, 'download');
  assert.equal(result.mediaKey, 'media/space-1/variant-1.mp4');
  assert.deepEqual(downloads, [{
    baseUrl: 'https://inventory.example.test',
    accessToken: 'token-1',
    requestPath: '/api/spaces/space-1/variants/variant-1/media',
    outputPath: path.normalize('references/variant.png'),
    force: false,
  }]);
  assert.match(output.join('\n'), /Downloaded media\/space-1\/variant-1.mp4/);
});

test('assets download falls back to a legacy image key when no media key exists', async () => {
  const output: string[] = [];
  const downloads: unknown[] = [];
  const { deps } = depsFor(output, downloads);

  const legacyDeps = {
    ...deps,
    fetch: async (url: string | URL | Request, init?: RequestInit) => {
      const response = await deps.fetch(url, init);
      const pathname = new URL(String(url)).pathname;
      if (pathname !== '/api/spaces/space-1/assets/asset-1') return response;
      const body = await response.json() as { asset: typeof asset; variants: Array<typeof variant>; lineage: unknown[] };
      return jsonResponse({
        ...body,
        variants: [{ ...variant, media_key: null, media_mime_type: null }],
      });
    },
  };

  const result = await executeAssets({
    positionals: ['download', 'variant-1'],
    options: { o: 'references/variant.png' },
  }, legacyDeps);

  assert.equal(result.type, 'download');
  assert.equal(result.mediaKey, 'images/space-1/variant-1.png');
  assert.deepEqual(downloads, [{
    baseUrl: 'https://inventory.example.test',
    accessToken: 'token-1',
    requestPath: '/api/spaces/space-1/variants/variant-1/media',
    outputPath: path.normalize('references/variant.png'),
    force: false,
  }]);
});

test('assets download accepts a direct legacy image key without asset lookup', async () => {
  const output: string[] = [];
  const downloads: unknown[] = [];
  const { deps, requests } = depsFor(output, downloads);

  const result = await executeAssets({
    positionals: ['download', 'images/space-1/direct.png'],
    options: { output: 'direct.png', force: 'true' },
  }, deps);

  assert.equal(result.type, 'download');
  assert.equal(requests.length, 0);
  assert.deepEqual(downloads, [{
    baseUrl: 'https://inventory.example.test',
    accessToken: 'token-1',
    requestPath: '/api/images/images/space-1/direct.png',
    outputPath: 'direct.png',
    force: true,
  }]);
});

test('assets download rejects direct media keys that cannot be variant-authorized', async () => {
  const output: string[] = [];
  const downloads: unknown[] = [];
  const { deps, requests } = depsFor(output, downloads);

  await assert.rejects(
    () => executeAssets({
      positionals: ['download', 'media/space-1/direct.mp3'],
      options: { output: 'direct.mp3', force: 'true' },
    }, deps),
    /Pass a variant ID/
  );

  assert.equal(requests.length, 0);
  assert.deepEqual(downloads, []);
});
