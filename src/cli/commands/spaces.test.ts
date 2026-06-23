import test from 'node:test';
import assert from 'node:assert/strict';
import { executeSpaces } from './spaces';
import type { StoredConfig } from '../lib/types';

const space = {
  id: 'space-1',
  name: 'Russafa Market',
  owner_id: 'user-1',
  role: 'owner',
  created_at: '2026-06-16T00:00:00.000Z',
};

const asset = {
  id: 'asset-1',
  name: 'Market Keyframe',
  type: 'scene',
  media_kind: 'image' as const,
  active_variant_id: 'variant-1',
};

function storedConfig(): StoredConfig {
  return {
    environment: 'stage',
    baseUrl: 'https://inventory.example.test',
    clientId: 'makefx-cli',
    token: {
      accessToken: 'token-1',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
    user: null,
    updatedAt: '2026-06-16T00:00:00.000Z',
  };
}

function depsFor(output: string[], options: { assetsStatus?: number } = {}) {
  const requests: Array<{ url: string; method: string; authorization: string | null }> = [];
  const deps = {
    loadConfig: async () => storedConfig(),
    resolveBaseUrl: () => 'https://inventory.example.test',
    saveProjectConfig: async () => '/tmp/project/.inventory/config.json',
    fetch: async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const requestUrl = String(url);
      requests.push({
        url: requestUrl,
        method: init?.method || 'GET',
        authorization: init?.headers instanceof Headers
          ? init.headers.get('authorization')
          : (init?.headers as Record<string, string> | undefined)?.Authorization || null,
      });
      const pathname = new URL(requestUrl).pathname;
      if (pathname === '/api/spaces') {
        return jsonResponse({ success: true, spaces: [space] });
      }
      if (pathname === '/api/spaces/space-1' && init?.method === 'DELETE') {
        return jsonResponse({
          success: true,
          message: 'Space archived successfully. Support can restore it during the retention window.',
        });
      }
      if (pathname === '/api/spaces/space-1') {
        return jsonResponse({ success: true, space });
      }
      if (pathname === '/api/spaces/space-1/assets') {
        return jsonResponse(
          options.assetsStatus ? { error: 'Asset storage not available' } : { success: true, assets: [asset] },
          options.assetsStatus
        );
      }
      return jsonResponse({ error: 'not found' }, 404);
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

test('spaces list supports JSON output for scripts', async () => {
  const output: string[] = [];
  const { deps, requests } = depsFor(output);

  const result = await executeSpaces({ positionals: [], options: { json: 'true', env: 'stage' } }, deps);

  assert.equal(result.type, 'list');
  assert.deepEqual(JSON.parse(output.join('\n')), [space]);
  assert.equal(output.join('\n').includes('Found 1 space'), false);
  assert.deepEqual(requests, [{
    url: 'https://inventory.example.test/api/spaces',
    method: 'GET',
    authorization: 'Bearer token-1',
  }]);
});

test('spaces details supports JSON output without progress text', async () => {
  const output: string[] = [];
  const { deps } = depsFor(output);

  const result = await executeSpaces({ positionals: [], options: { details: 'true', json: 'true' } }, deps);

  assert.equal(result.type, 'details');
  assert.deepEqual(JSON.parse(output.join('\n')), [{
    space,
    assetCount: 1,
    assetSummary: '1 scene (Market Keyframe)',
  }]);
  assert.equal(output.join('\n').includes('Fetching details'), false);
});

test('spaces show supports JSON output with assets', async () => {
  const output: string[] = [];
  const { deps, requests } = depsFor(output);

  const result = await executeSpaces({ positionals: [], options: { id: 'space-1', json: 'true' } }, deps);

  assert.equal(result.type, 'show');
  assert.deepEqual(JSON.parse(output.join('\n')), {
    space,
    assets: [asset],
  });
  assert.deepEqual(requests.map(request => new URL(request.url).pathname), [
    '/api/spaces/space-1',
    '/api/spaces/space-1/assets',
  ]);
});

test('spaces delete archives a space through the API', async () => {
  const output: string[] = [];
  const { deps, requests } = depsFor(output);

  const result = await executeSpaces({ positionals: ['delete', 'space-1'], options: {} }, deps);

  assert.deepEqual(result, {
    type: 'delete',
    spaceId: 'space-1',
    message: 'Space archived successfully. Support can restore it during the retention window.',
  });
  assert.deepEqual(requests.map(request => ({
    path: new URL(request.url).pathname,
    method: request.method,
    authorization: request.authorization,
  })), [{
    path: '/api/spaces/space-1',
    method: 'DELETE',
    authorization: 'Bearer token-1',
  }]);
  assert.equal(output.join('\n'), [
    'Space archived: space-1',
    'Space archived successfully. Support can restore it during the retention window.',
  ].join('\n'));
});

test('spaces delete supports JSON output', async () => {
  const output: string[] = [];
  const { deps } = depsFor(output);

  const result = await executeSpaces({ positionals: ['delete'], options: { id: 'space-1', json: 'true' } }, deps);

  assert.equal(result.type, 'delete');
  assert.deepEqual(JSON.parse(output.join('\n')), {
    success: true,
    message: 'Space archived successfully. Support can restore it during the retention window.',
  });
});

test('spaces details rejects when an asset summary read fails', async () => {
  const output: string[] = [];
  const { deps } = depsFor(output, { assetsStatus: 503 });

  await assert.rejects(
    executeSpaces({ positionals: [], options: { details: 'true', json: 'true' } }, deps),
    /Failed to fetch assets for space space-1: 503/
  );
  assert.equal(output.join('\n'), '');
});

test('spaces show rejects when the asset details read fails', async () => {
  const output: string[] = [];
  const { deps } = depsFor(output, { assetsStatus: 503 });

  await assert.rejects(
    executeSpaces({ positionals: [], options: { id: 'space-1', json: 'true' } }, deps),
    /Failed to fetch assets for space space-1: 503/
  );
  assert.equal(output.join('\n'), '');
});
