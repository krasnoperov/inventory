import test from 'node:test';
import assert from 'node:assert/strict';
import type { StoredConfig } from '../lib/types';
import { executeCollections } from './collections';

const config: StoredConfig = {
  environment: 'stage',
  baseUrl: 'https://makefx-stage.example.test',
  clientId: 'test',
  token: {
    accessToken: 'token',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  },
  user: {},
  updatedAt: new Date().toISOString(),
};

const collection = {
  id: 'collection-1',
  name: 'Cast',
  kind: 'custom',
  color: null,
  description: null,
  sort_index: 0,
  created_by: 'user-1',
  created_at: 1,
  updated_at: 1,
};

const assetItem = {
  id: 'item-asset',
  collection_id: 'collection-1',
  subject_type: 'asset',
  asset_id: 'asset-1',
  variant_id: null,
  role: 'character',
  pinned_variant_id: 'variant-active',
  sort_index: 0,
  created_by: 'user-1',
  created_at: 1,
  updated_at: 1,
};

const variantItem = {
  id: 'item-variant',
  collection_id: 'collection-1',
  subject_type: 'variant',
  asset_id: null,
  variant_id: 'variant-1',
  role: 'pose',
  pinned_variant_id: null,
  sort_index: 1,
  created_by: 'user-1',
  created_at: 1,
  updated_at: 1,
};

function depsFor(fetchImpl: typeof fetch, output: string[] = []) {
  return {
    loadConfig: async () => config,
    loadProjectConfig: async () => null,
    resolveBaseUrl: () => 'https://makefx-stage.example.test',
    fetch: fetchImpl,
    print: (message: string) => output.push(message),
  };
}

test('collections create sends ordinary collection metadata', async () => {
  const output: string[] = [];
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body });

    if (url.pathname === '/api/spaces/space-1/collections' && method === 'POST') {
      assert.deepEqual(body, {
        name: 'Cast',
        kind: 'cast',
        color: '#2f9e73',
        description: 'Main character refs',
        sortIndex: 2,
      });
      return Response.json({ success: true, collection: { ...collection, kind: 'cast', color: '#2f9e73' } });
    }

    return Response.json({ error: `unexpected ${method} ${url.pathname}` }, { status: 500 });
  };

  const result = await executeCollections({
    positionals: ['create', 'Cast'],
    options: {
      space: 'space-1',
      kind: 'cast',
      color: '#2f9e73',
      description: 'Main character refs',
      'sort-index': '2',
    },
  }, depsFor(fetchImpl as typeof fetch, output));

  assert.equal(result.type, 'collection');
  assert.equal(output.join('\n'), 'Created collection collection-1 (Cast)');
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    'POST /api/spaces/space-1/collections',
  ]);
});

test('collections add groups existing assets and variants', async () => {
  const output: string[] = [];
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body });

    if (url.pathname === '/api/spaces/space-1/collections/collection-1/items' && method === 'POST') {
      if (body.subjectType === 'asset') {
        assert.deepEqual(body, {
          subjectType: 'asset',
          assetId: 'asset-1',
          role: 'character',
          pinnedVariantId: 'variant-active',
        });
        return Response.json({ success: true, item: assetItem });
      }
      assert.deepEqual(body, {
        subjectType: 'variant',
        variantId: 'variant-1',
        role: 'character',
        pinnedVariantId: 'variant-active',
      });
      return Response.json({ success: true, item: variantItem });
    }

    return Response.json({ error: `unexpected ${method} ${url.pathname}` }, { status: 500 });
  };

  const result = await executeCollections({
    positionals: ['add', 'collection-1'],
    options: {
      space: 'space-1',
      asset: 'asset-1',
      variant: 'variant-1',
      role: 'character',
      'pinned-variant': 'variant-active',
    },
  }, depsFor(fetchImpl as typeof fetch, output));

  assert.equal(result.type, 'items-added');
  assert.equal(result.items.length, 2);
  assert.equal(output.join('\n'), 'Added 2 items to collection-1');
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    'POST /api/spaces/space-1/collections/collection-1/items',
    'POST /api/spaces/space-1/collections/collection-1/items',
  ]);
});

test('collections item update, reorder, remove, and JSON list use collection item REST endpoints', async () => {
  const output: string[] = [];
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body });

    if (url.pathname === '/api/spaces/space-1/collections/collection-1/items' && method === 'GET') {
      return Response.json({ success: true, items: [assetItem, variantItem] });
    }
    if (url.pathname === '/api/spaces/space-1/collections/collection-1/items/item-asset' && method === 'PATCH') {
      assert.deepEqual(body, { role: 'hero', pinnedVariantId: null, sortIndex: 3 });
      return Response.json({ success: true, item: { ...assetItem, role: 'hero', pinned_variant_id: null, sort_index: 3 } });
    }
    if (url.pathname === '/api/spaces/space-1/collections/collection-1/items/reorder' && method === 'POST') {
      assert.deepEqual(body, { itemIds: ['item-variant', 'item-asset'] });
      return Response.json({ success: true, items: [variantItem, assetItem] });
    }
    if (url.pathname === '/api/spaces/space-1/collections/collection-1/items/item-variant' && method === 'DELETE') {
      return Response.json({ success: true });
    }

    return Response.json({ error: `unexpected ${method} ${url.pathname}` }, { status: 500 });
  };
  const deps = depsFor(fetchImpl as typeof fetch, output);

  const listed = await executeCollections({
    positionals: ['items', 'collection-1'],
    options: { space: 'space-1', json: 'true' },
  }, deps);
  const updated = await executeCollections({
    positionals: ['update-item', 'collection-1', 'item-asset'],
    options: { space: 'space-1', role: 'hero', 'pinned-variant': 'none', 'sort-index': '3' },
  }, deps);
  const reordered = await executeCollections({
    positionals: ['reorder', 'collection-1'],
    options: { space: 'space-1', items: 'item-variant,item-asset' },
  }, deps);
  const removed = await executeCollections({
    positionals: ['remove', 'collection-1', 'item-variant'],
    options: { space: 'space-1' },
  }, deps);

  assert.equal(listed.type, 'items');
  assert.equal(updated.type, 'item');
  assert.equal(reordered.type, 'items');
  assert.equal(removed.type, 'item-delete');
  assert.deepEqual(JSON.parse(output[0]).map((item: { id: string }) => item.id), ['item-asset', 'item-variant']);
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    'GET /api/spaces/space-1/collections/collection-1/items',
    'PATCH /api/spaces/space-1/collections/collection-1/items/item-asset',
    'POST /api/spaces/space-1/collections/collection-1/items/reorder',
    'DELETE /api/spaces/space-1/collections/collection-1/items/item-variant',
  ]);
});
