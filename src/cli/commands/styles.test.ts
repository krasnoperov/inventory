import test from 'node:test';
import assert from 'node:assert/strict';
import type { StoredConfig } from '../lib/types';
import { parseArgs } from '../lib/utils';
import { executeStyles } from './styles';

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
  name: 'Painterly refs',
  kind: 'style_refs',
  color: '#7c3aed',
  description: null,
  sort_index: 0,
  created_by: 'user-1',
  created_at: 1,
  updated_at: 1,
};

const collectionItem = {
  id: 'item-1',
  collection_id: 'collection-1',
  subject_type: 'asset',
  asset_id: 'asset-1',
  variant_id: null,
  role: 'style_ref',
  pinned_variant_id: 'variant-active',
  sort_index: 0,
  created_by: 'user-1',
  created_at: 1,
  updated_at: 1,
};

const preset = {
  id: 'preset-1',
  name: 'Painterly',
  description: null,
  style_prompt: 'Painterly adventure game',
  collection_id: 'collection-1',
  enabled: true,
  is_default: true,
  created_by: 'user-1',
  created_at: 1,
  updated_at: 1,
  collection_name: 'Painterly refs',
  reference_count: 1,
  style_reference_variant_ids: ['variant-active'],
  style_reference_image_keys: ['images/variant-active.png'],
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

test('style flags parse without consuming following options or positionals', () => {
  assert.deepEqual(
    parseArgs(['presets', 'create', 'Painterly', '--default', '--collection', 'collection-1', '--json']),
    {
      positionals: ['presets', 'create', 'Painterly'],
      options: {
        default: 'true',
        collection: 'collection-1',
        json: 'true',
      },
    }
  );
  assert.deepEqual(
    parseArgs(['prompt text', '--style-preset', 'Painterly', '--no-style']),
    {
      positionals: ['prompt text'],
      options: {
        'style-preset': 'Painterly',
        'no-style': 'true',
      },
    }
  );
});

test('styles collections create posts collection and style_ref items from assets and variants', async () => {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body });

    if (url.pathname === '/api/spaces/space-1/collections' && method === 'POST') {
      assert.equal(body.name, 'Painterly refs');
      return Response.json({ success: true, collection });
    }
    if (url.pathname === '/api/spaces/space-1/assets' && method === 'GET') {
      return Response.json({
        success: true,
        assets: [{
          id: 'asset-1',
          name: 'Style board',
          type: 'reference',
          media_kind: 'image',
          tags: '[]',
          parent_asset_id: null,
          active_variant_id: 'variant-active',
          created_by: 'user-1',
          created_at: 1,
          updated_at: 1,
        }],
      });
    }
    if (url.pathname === '/api/spaces/space-1/collections/collection-1/items' && method === 'POST') {
      if (body.subjectType === 'asset') {
        assert.equal(body.assetId, 'asset-1');
        assert.equal(body.pinnedVariantId, 'variant-active');
      } else {
        assert.equal(body.variantId, 'variant-extra');
      }
      assert.equal(body.role, 'style_ref');
      return Response.json({ success: true, item: { ...collectionItem, id: `item-${body.sortIndex + 1}` } });
    }

    return Response.json({ error: `unexpected ${method} ${url.pathname}` }, { status: 500 });
  };

  const result = await executeStyles({
    positionals: ['collections', 'create', 'Painterly refs'],
    options: { space: 'space-1', refs: 'asset-1,variant-extra' },
  }, depsFor(fetchImpl as typeof fetch));

  assert.equal(result.type, 'collection');
  assert.equal(result.items?.length, 2);
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    'POST /api/spaces/space-1/collections',
    'GET /api/spaces/space-1/assets',
    'POST /api/spaces/space-1/collections/collection-1/items',
    'POST /api/spaces/space-1/collections/collection-1/items',
  ]);
});

test('styles collections update replaces existing style references by default', async () => {
  const calls: Array<{ method: string; path: string }> = [];
  const normalItem = { ...collectionItem, id: 'item-normal', role: 'character' };
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method || 'GET';
    calls.push({ method, path: url.pathname });

    if (url.pathname === '/api/spaces/space-1/assets') {
      return Response.json({ success: true, assets: [] });
    }
    if (url.pathname === '/api/spaces/space-1/collections/collection-1/items' && method === 'GET') {
      return Response.json({ success: true, items: [collectionItem, normalItem] });
    }
    if (url.pathname === '/api/spaces/space-1/collections/collection-1/items/item-1' && method === 'DELETE') {
      return Response.json({ success: true });
    }
    if (url.pathname === '/api/spaces/space-1/collections/collection-1/items' && method === 'POST') {
      return Response.json({
        success: true,
        item: {
          ...collectionItem,
          id: 'item-new',
          subject_type: 'variant',
          asset_id: null,
          variant_id: 'variant-new',
          pinned_variant_id: null,
        },
      });
    }
    if (url.pathname === '/api/spaces/space-1/collections') {
      return Response.json({ success: true, collections: [collection] });
    }

    return Response.json({ error: `unexpected ${method} ${url.pathname}` }, { status: 500 });
  };

  const result = await executeStyles({
    positionals: ['collections', 'update', 'collection-1'],
    options: { space: 'space-1', variants: 'variant-new' },
  }, depsFor(fetchImpl as typeof fetch));

  assert.equal(result.type, 'collection');
  assert.ok(!calls.some((call) => call.method === 'DELETE' && call.path.endsWith('/item-normal')));
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    'GET /api/spaces/space-1/assets',
    'GET /api/spaces/space-1/collections/collection-1/items',
    'DELETE /api/spaces/space-1/collections/collection-1/items/item-1',
    'POST /api/spaces/space-1/collections/collection-1/items',
    'GET /api/spaces/space-1/collections',
  ]);
});

test('styles presets create, disable, and delete use style preset REST payloads', async () => {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body });

    if (url.pathname === '/api/spaces/space-1/style-presets' && method === 'POST') {
      assert.deepEqual(body, {
        name: 'Painterly',
        stylePrompt: 'Painterly adventure game',
        collectionId: 'collection-1',
        enabled: true,
        isDefault: true,
      });
      return Response.json({ success: true, preset });
    }
    if (url.pathname === '/api/spaces/space-1/style-presets/preset-1' && method === 'PATCH') {
      assert.deepEqual(body, { enabled: false });
      return Response.json({ success: true, preset: { ...preset, enabled: false, is_default: false } });
    }
    if (url.pathname === '/api/spaces/space-1/style-presets/preset-1' && method === 'DELETE') {
      return Response.json({ success: true });
    }

    return Response.json({ error: `unexpected ${method} ${url.pathname}` }, { status: 500 });
  };
  const deps = depsFor(fetchImpl as typeof fetch);

  await executeStyles({
    positionals: ['presets', 'create', 'Painterly'],
    options: {
      space: 'space-1',
      collection: 'collection-1',
      prompt: 'Painterly adventure game',
      default: 'true',
    },
  }, deps);
  await executeStyles({
    positionals: ['presets', 'disable', 'preset-1'],
    options: { space: 'space-1' },
  }, deps);
  await executeStyles({
    positionals: ['presets', 'delete', 'preset-1'],
    options: { space: 'space-1' },
  }, deps);

  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    'POST /api/spaces/space-1/style-presets',
    'PATCH /api/spaces/space-1/style-presets/preset-1',
    'DELETE /api/spaces/space-1/style-presets/preset-1',
  ]);
});
