import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeImport } from './import';
import type { StoredConfig } from '../lib/types';

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

interface FetchCall {
  url: string;
  method: string;
  body?: BodyInit | null;
}

function makeDeps(calls: FetchCall[], output: string[]) {
  const uploads = new Map<string, { assetId: string; variantId: string }>();
  return {
    loadConfig: async () => storedConfig(),
    loadProjectConfig: async () => null,
    resolveBaseUrl: () => 'https://inventory.example.test',
    fetch: async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ url: requestUrl, method, body: init?.body });
      const parsed = new URL(requestUrl);

      assert.equal((init?.headers as Record<string, string> | undefined)?.Authorization, 'Bearer token-1');

      if (method === 'GET' && parsed.pathname === '/api/spaces/space-1/assets') {
        return Response.json({
          assets: [
            { id: 'asset-existing', name: 'Existing', type: 'character', media_kind: 'image', active_variant_id: 'variant-existing' },
            { id: 'asset-source', name: 'Source', type: 'reference', media_kind: 'image', active_variant_id: 'variant-external' },
            { id: 'asset-thumb-target', name: 'Thumb Target', type: 'scene', media_kind: 'image', active_variant_id: 'variant-thumb-target' },
          ],
        });
      }

      if (method === 'GET' && parsed.pathname === '/api/spaces/space-1/assets/asset-existing') {
        return Response.json({
          asset: { id: 'asset-existing', name: 'Existing', media_kind: 'image' },
          variants: [{ id: 'variant-existing', asset_id: 'asset-existing', media_kind: 'image' }],
          lineage: [],
        });
      }

      if (method === 'GET' && parsed.pathname === '/api/spaces/space-1/assets/asset-source') {
        return Response.json({
          asset: { id: 'asset-source', name: 'Source', media_kind: 'image' },
          variants: [{ id: 'variant-external', asset_id: 'asset-source', media_kind: 'image' }],
          lineage: [],
        });
      }

      if (method === 'GET' && parsed.pathname === '/api/spaces/space-1/assets/asset-thumb-target') {
        return Response.json({
          asset: { id: 'asset-thumb-target', name: 'Thumb Target', media_kind: 'image' },
          variants: [{ id: 'variant-thumb-target', asset_id: 'asset-thumb-target', media_kind: 'image' }],
          lineage: [],
        });
      }

      if (method === 'GET' && parsed.pathname === '/api/spaces/space-1/collections') {
        return Response.json({
          success: true,
          collections: [
            { id: 'collection-cast', name: 'Cast', description: null, sort_index: 0, created_by: 'user-1', created_at: 1, updated_at: 1 },
            { id: 'collection-style', name: 'Painterly refs', description: null, sort_index: 1, created_by: 'user-1', created_at: 1, updated_at: 1 },
          ],
        });
      }

      if (method === 'GET' && parsed.pathname === '/api/spaces/space-1/compositions') {
        return Response.json({
          success: true,
          compositions: [
            { id: 'composition-opening', name: 'Opening Shot', description: null, status: 'draft', output_asset_id: null, output_variant_id: null, metadata: '{}', sort_index: 0, created_by: 'user-1', created_at: 1, updated_at: 1 },
          ],
        });
      }

      if (method === 'GET' && parsed.pathname === '/api/spaces/space-1/style-presets') {
        return Response.json({
          success: true,
          presets: [
            { id: 'preset-existing', name: 'Existing Style', description: null, style_prompt: '', collection_id: 'collection-style', enabled: true, is_default: false, created_by: 'user-1', created_at: 1, updated_at: 1, collection_name: 'Painterly refs', reference_count: 1, style_reference_variant_ids: [], style_reference_image_keys: [] },
          ],
        });
      }

      if (method === 'POST' && parsed.pathname === '/api/spaces/space-1/upload') {
        assert.ok(init?.body instanceof FormData);
        const formData = init.body;
        const file = formData.get('file');
        assert.ok(file instanceof File);
        const key = file.name.includes('base') ? 'base' : 'child';
        const assetId = formData.get('assetId')?.toString() || `asset-${key}`;
        const variantId = `variant-${key}`;
        uploads.set(key, { assetId, variantId });
        const lineage = JSON.parse(String(formData.get('lineage') ?? '[]')) as Array<{ parentVariantId: string }>;
        return Response.json({
          success: true,
          asset: formData.get('assetName') ? {
            id: assetId,
            name: String(formData.get('assetName')),
            type: String(formData.get('assetType') ?? 'character'),
            media_kind: 'image',
            tags: '[]',
            parent_asset_id: null,
            active_variant_id: variantId,
            created_by: 'user-1',
            created_at: 1,
            updated_at: 1,
          } : undefined,
          variant: {
            id: variantId,
            asset_id: assetId,
            media_kind: 'image',
            workflow_id: null,
            status: 'completed',
            error_message: null,
            image_key: `images/space-1/${variantId}.png`,
            thumb_key: `images/space-1/${variantId}_thumb.webp`,
            media_key: `images/space-1/${variantId}.png`,
            recipe: '{}',
            starred: false,
            created_by: 'user-1',
            created_at: 1,
            updated_at: 1,
          },
          lineage: lineage.map((entry, index) => ({
            id: `lineage-${key}-${index}`,
            parent_variant_id: entry.parentVariantId,
            child_variant_id: variantId,
            relation_type: 'derived',
            severed: false,
            created_at: 1,
          })),
        });
      }

      if (method === 'POST' && parsed.pathname === '/api/spaces/space-1/collections') {
        const body = JSON.parse(String(init?.body)) as { name: string };
        return Response.json({
          success: true,
          collection: { id: `collection-${body.name.toLowerCase().replace(/\s+/g, '-')}`, name: body.name, description: null, sort_index: 2, created_by: 'user-1', created_at: 1, updated_at: 1 },
        });
      }

      const collectionItemMatch = parsed.pathname.match(/^\/api\/spaces\/space-1\/collections\/([^/]+)\/items$/);
      if (method === 'POST' && collectionItemMatch) {
        const body = JSON.parse(String(init?.body)) as { role: string };
        return Response.json({
          success: true,
          item: { id: `collection-item-${body.role}-${calls.length}`, collection_id: collectionItemMatch[1], subject_type: 'asset', asset_id: null, variant_id: null, role: body.role, pinned_variant_id: null, sort_index: 0, created_by: 'user-1', created_at: 1, updated_at: 1 },
        });
      }

      if (method === 'POST' && parsed.pathname === '/api/spaces/space-1/relations') {
        const body = JSON.parse(String(init?.body)) as { relationType: string };
        return Response.json({
          success: true,
          relation: { id: `relation-${body.relationType}`, subject_type: 'variant', subject_asset_id: null, subject_variant_id: null, object_type: 'asset', object_asset_id: null, object_variant_id: null, relation_type: body.relationType, label: null, context: null, metadata: '{}', sort_index: 0, created_by: 'user-1', created_at: 1, updated_at: 1 },
        });
      }

      if (method === 'POST' && parsed.pathname === '/api/spaces/space-1/compositions') {
        const body = JSON.parse(String(init?.body)) as { name: string };
        return Response.json({
          success: true,
          composition: { id: `composition-${body.name.toLowerCase().replace(/\s+/g, '-')}`, name: body.name, description: null, status: 'draft', output_asset_id: null, output_variant_id: null, metadata: '{}', sort_index: 1, created_by: 'user-1', created_at: 1, updated_at: 1 },
        });
      }

      const compositionItemMatch = parsed.pathname.match(/^\/api\/spaces\/space-1\/compositions\/([^/]+)\/items$/);
      if (method === 'POST' && compositionItemMatch) {
        const body = JSON.parse(String(init?.body)) as { role: string };
        return Response.json({
          success: true,
          item: { id: `composition-item-${body.role}-${calls.length}`, composition_id: compositionItemMatch[1], role: body.role, label: null, asset_id: null, variant_id: 'variant-base', metadata: '{}', sort_index: 0, created_by: 'user-1', created_at: 1, updated_at: 1 },
        });
      }

      if (method === 'POST' && parsed.pathname === '/api/spaces/space-1/style-presets') {
        const body = JSON.parse(String(init?.body)) as { id?: string; name: string };
        return Response.json({
          success: true,
          preset: { id: body.id ?? `preset-${body.name.toLowerCase().replace(/\s+/g, '-')}`, name: body.name, description: null, style_prompt: '', collection_id: 'collection-style', enabled: true, is_default: false, created_by: 'user-1', created_at: 1, updated_at: 1, collection_name: 'Painterly refs', reference_count: 1, style_reference_variant_ids: [], style_reference_image_keys: [] },
        });
      }

      if (method === 'PATCH' && parsed.pathname === '/api/spaces/space-1/style-presets/preset-existing') {
        const body = JSON.parse(String(init?.body)) as { name: string };
        return Response.json({
          success: true,
          preset: { id: 'preset-existing', name: body.name, description: null, style_prompt: '', collection_id: 'collection-style', enabled: true, is_default: true, created_by: 'user-1', created_at: 1, updated_at: 2, collection_name: 'Painterly refs', reference_count: 1, style_reference_variant_ids: [], style_reference_image_keys: [] },
        });
      }

      return Response.json({ error: `Unexpected request ${method} ${parsed.pathname}` }, { status: 500 });
    },
    readFile,
    stat,
    print: (message: string) => output.push(message),
  };
}

test('import dry-run validates targets and source variants without uploading', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'makefx-import-'));
  const calls: FetchCall[] = [];
  const output: string[] = [];
  try {
    await writeFile(path.join(dir, 'base.png'), new Uint8Array([1, 2, 3]));
    const manifestPath = path.join(dir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({
      records: [{
        key: 'base',
        file: 'base.png',
        assetId: 'asset-existing',
        prompt: 'external prompt',
        model: 'model-1',
        provider: 'provider-1',
        lineage: [{ sourceVariantId: 'variant-external', relationType: 'derived' }],
      }],
    }));

    const result = await executeImport({
      positionals: [manifestPath],
      options: { space: 'space-1', 'dry-run': 'true', json: 'true' },
    }, makeDeps(calls, output));

    assert.equal(result.dryRun, true);
    assert.equal(calls.filter((call) => call.method === 'POST').length, 0);
    assert.match(output.join('\n'), /"dryRun": true/);
    assert.match(output.join('\n'), /"lineageInputs": 1/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('import resolves same-batch lineage before uploading dependents', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'makefx-import-'));
  const calls: FetchCall[] = [];
  const output: string[] = [];
  try {
    await writeFile(path.join(dir, 'base.png'), new Uint8Array([1]));
    await writeFile(path.join(dir, 'child.png'), new Uint8Array([2]));
    const manifestPath = path.join(dir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({
      records: [
        {
          key: 'child',
          file: 'child.png',
          name: 'Child',
          activeVariantBehavior: 'set-active',
          prompt: 'child prompt',
          model: 'model-child',
          provider: 'provider-child',
          providerMetadata: { seed: 7 },
          generationProvenance: { sampler: 'test' },
          lineage: [
            { sourceFile: 'base', relationType: 'refined' },
            { sourceVariantId: 'variant-external', relationType: 'derived' },
          ],
        },
        {
          key: 'base',
          file: 'base.png',
          name: 'Base',
        },
      ],
    }));

    const result = await executeImport({
      positionals: [manifestPath],
      options: { space: 'space-1', json: 'true' },
    }, makeDeps(calls, output));

    assert.equal(result.dryRun, false);
    const postCalls = calls.filter((call) => call.method === 'POST');
    assert.equal(postCalls.length, 2);
    const firstForm = postCalls[0].body as FormData;
    const secondForm = postCalls[1].body as FormData;
    assert.equal((firstForm.get('file') as File).name, 'base.png');
    assert.equal((secondForm.get('file') as File).name, 'child.png');
    assert.equal(secondForm.get('activeVariantBehavior'), 'set-active');
    assert.equal(secondForm.get('prompt'), 'child prompt');
    assert.equal(secondForm.get('model'), 'model-child');
    assert.equal(secondForm.get('provider'), 'provider-child');
    assert.deepEqual(JSON.parse(String(secondForm.get('providerMetadata'))), { seed: 7 });
    assert.deepEqual(JSON.parse(String(secondForm.get('generationProvenance'))), { sampler: 'test' });
    assert.deepEqual(JSON.parse(String(secondForm.get('lineage'))), [
      { parentVariantId: 'variant-base', relationType: 'refined' },
      { parentVariantId: 'variant-external', relationType: 'derived' },
    ]);
    assert.equal(output.length, 1);
    const json = JSON.parse(output[0]) as { records: Array<{ lineageIds: string[] }> };
    assert.deepEqual(json.records[1].lineageIds, ['lineage-child-0', 'lineage-child-1']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('import places records in existing and created collections with pinned variants', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'makefx-import-'));
  const calls: FetchCall[] = [];
  const output: string[] = [];
  try {
    await writeFile(path.join(dir, 'base.png'), new Uint8Array([1]));
    const manifestPath = path.join(dir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({
      collections: [{ name: 'Backgrounds', create: true }],
      records: [{
        key: 'base',
        file: 'base.png',
        name: 'Base',
        collections: [
          { collection: 'Cast', role: 'character', subjectType: 'asset' },
          { collection: 'Backgrounds', role: 'background', subjectType: 'variant', pinnedVariantBehavior: 'none' },
        ],
      }],
    }));

    const result = await executeImport({
      positionals: [manifestPath],
      options: { space: 'space-1', json: 'true' },
    }, makeDeps(calls, output));

    assert.equal(result.dryRun, false);
    assert.deepEqual(result.collectionIds, ['collection-backgrounds']);
    assert.equal(result.collectionItemIds.length, 2);
    const itemBodies = calls
      .filter((call) => call.method === 'POST' && call.url.includes('/collections/') && call.url.endsWith('/items'))
      .map((call) => JSON.parse(String(call.body)));
    assert.deepEqual(itemBodies.map((body) => ({
      subjectType: body.subjectType,
      assetId: body.assetId,
      variantId: body.variantId,
      role: body.role,
      pinnedVariantId: body.pinnedVariantId,
    })), [
      { subjectType: 'asset', assetId: 'asset-base', variantId: undefined, role: 'character', pinnedVariantId: 'variant-base' },
      { subjectType: 'variant', assetId: undefined, variantId: 'variant-base', role: 'background', pinnedVariantId: null },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('import rejects missing collections in dry-run before uploading', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'makefx-import-'));
  const calls: FetchCall[] = [];
  const output: string[] = [];
  try {
    await writeFile(path.join(dir, 'base.png'), new Uint8Array([1]));
    const manifestPath = path.join(dir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({
      records: [{
        key: 'base',
        file: 'base.png',
        name: 'Base',
        collections: [{ collection: 'Missing', role: 'member' }],
      }],
    }));

    await assert.rejects(
      () => executeImport({
        positionals: [manifestPath],
        options: { space: 'space-1', 'dry-run': 'true' },
      }, makeDeps(calls, output)),
      /Collection not found/
    );
    assert.equal(calls.filter((call) => call.method === 'POST').length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('import adds composition slot placements for imported variants', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'makefx-import-'));
  const calls: FetchCall[] = [];
  const output: string[] = [];
  try {
    await writeFile(path.join(dir, 'final.png'), new Uint8Array([1]));
    const manifestPath = path.join(dir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({
      records: [{
        key: 'final',
        file: 'final.png',
        name: 'Final',
        compositionItems: [{
          composition: 'Opening Shot',
          role: 'output',
          label: 'Final frame',
          metadata: { layer: 'final' },
        }],
      }],
    }));

    const result = await executeImport({
      positionals: [manifestPath],
      options: { space: 'space-1', json: 'true' },
    }, makeDeps(calls, output));

    assert.equal(result.dryRun, false);
    assert.equal(result.compositionItemIds.length, 1);
    const itemBody = calls
      .filter((call) => call.method === 'POST' && call.url.includes('/compositions/') && call.url.endsWith('/items'))
      .map((call) => JSON.parse(String(call.body)))[0];
    assert.deepEqual(itemBody, {
      role: 'output',
      label: 'Final frame',
      assetId: 'asset-child',
      variantId: 'variant-child',
      metadata: { layer: 'final' },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('import creates manual relations for same-batch and existing targets', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'makefx-import-'));
  const calls: FetchCall[] = [];
  const output: string[] = [];
  try {
    await writeFile(path.join(dir, 'thumb.png'), new Uint8Array([1]));
    const manifestPath = path.join(dir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({
      records: [{
        key: 'thumb',
        file: 'thumb.png',
        name: 'Thumb',
      }],
      relations: [{
        subject: { recordKey: 'thumb', subjectType: 'variant' },
        object: { assetId: 'asset-thumb-target', subjectType: 'asset' },
        relationType: 'thumbnail_for',
        label: 'Thumbnail',
      }],
    }));

    const result = await executeImport({
      positionals: [manifestPath],
      options: { space: 'space-1', json: 'true' },
    }, makeDeps(calls, output));

    assert.equal(result.dryRun, false);
    assert.deepEqual(result.relationIds, ['relation-thumbnail_for']);
    const relationBody = calls
      .filter((call) => call.method === 'POST' && call.url.endsWith('/relations'))
      .map((call) => JSON.parse(String(call.body)))[0];
    assert.deepEqual(relationBody.subject, { subjectType: 'variant', variantId: 'variant-child' });
    assert.deepEqual(relationBody.object, { subjectType: 'asset', assetId: 'asset-thumb-target' });
    assert.equal(relationBody.relationType, 'thumbnail_for');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('import creates style references and style presets from named style collections', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'makefx-import-'));
  const calls: FetchCall[] = [];
  const output: string[] = [];
  try {
    await writeFile(path.join(dir, 'style.png'), new Uint8Array([1]));
    const manifestPath = path.join(dir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({
      records: [{
        key: 'style',
        file: 'style.png',
        name: 'Style Ref',
        styleCollections: ['Painterly refs'],
      }],
      stylePresets: [{
        name: 'Painterly',
        create: true,
        collection: 'Painterly refs',
        stylePrompt: 'Painterly adventure game',
        default: true,
      }],
    }));

    const result = await executeImport({
      positionals: [manifestPath],
      options: { space: 'space-1', json: 'true' },
    }, makeDeps(calls, output));

    assert.equal(result.dryRun, false);
    assert.equal(result.collectionItemIds.length, 1);
    assert.deepEqual(result.stylePresetIds, ['preset-painterly']);
    const collectionItemBody = calls
      .filter((call) => call.method === 'POST' && call.url.includes('/collections/collection-style/items'))
      .map((call) => JSON.parse(String(call.body)))[0];
    assert.equal(collectionItemBody.role, 'style_ref');
    assert.equal(collectionItemBody.pinnedVariantId, 'variant-child');
    const presetBody = calls
      .filter((call) => call.method === 'POST' && call.url.endsWith('/style-presets'))
      .map((call) => JSON.parse(String(call.body)))[0];
    assert.equal(presetBody.collectionId, 'collection-style');
    assert.equal(presetBody.isDefault, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('import upserts a missing id-based style preset by creating it', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'makefx-import-'));
  const calls: FetchCall[] = [];
  const output: string[] = [];
  try {
    await writeFile(path.join(dir, 'style.png'), new Uint8Array([1]));
    const manifestPath = path.join(dir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({
      records: [{
        key: 'style',
        file: 'style.png',
        name: 'Style Ref',
      }],
      stylePresets: [{
        id: 'preset-new',
        name: 'New Style',
        upsert: true,
        collection: 'Painterly refs',
      }],
    }));

    const result = await executeImport({
      positionals: [manifestPath],
      options: { space: 'space-1', json: 'true' },
    }, makeDeps(calls, output));

    assert.equal(result.dryRun, false);
    assert.deepEqual(result.stylePresetIds, ['preset-new']);
    const presetMutations = calls.filter((call) => call.url.endsWith('/style-presets') && call.method !== 'GET');
    assert.deepEqual(presetMutations.map((call) => call.method), ['POST']);
    assert.equal(calls.some((call) => call.method === 'PATCH' && call.url.includes('/style-presets/preset-new')), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('import rejects missing id-based style preset updates before uploading', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'makefx-import-'));
  const calls: FetchCall[] = [];
  const output: string[] = [];
  try {
    await writeFile(path.join(dir, 'style.png'), new Uint8Array([1]));
    const manifestPath = path.join(dir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({
      records: [{
        key: 'style',
        file: 'style.png',
        name: 'Style Ref',
      }],
      stylePresets: [{
        id: 'preset-missing',
        name: 'Missing Style',
        update: true,
        collection: 'Painterly refs',
      }],
    }));

    await assert.rejects(
      () => executeImport({
        positionals: [manifestPath],
        options: { space: 'space-1', 'dry-run': 'true' },
      }, makeDeps(calls, output)),
      /Style preset not found for update: preset-missing/
    );
    assert.equal(calls.filter((call) => call.method === 'POST').length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('import dry-run validates organization references and reports planned ids without upload', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'makefx-import-'));
  const calls: FetchCall[] = [];
  const output: string[] = [];
  try {
    await writeFile(path.join(dir, 'map.png'), new Uint8Array([1]));
    const manifestPath = path.join(dir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({
      collections: [{ name: 'Maps', create: true }],
      compositions: [{ name: 'Map Board', create: true, output: { recordKey: 'map', subjectType: 'variant' } }],
      records: [{
        key: 'map',
        file: 'map.png',
        name: 'Map',
      }],
      collectionItems: [{ collection: 'Maps', recordKey: 'map', role: 'map', subjectType: 'asset' }],
      compositionItems: [{ composition: 'Map Board', recordKey: 'map', role: 'map' }],
      relations: [{
        subject: { recordKey: 'map', subjectType: 'variant' },
        object: { variantId: 'variant-external', subjectType: 'variant' },
        relationType: 'map_for',
      }],
      stylePresets: [{ name: 'Existing Style', update: true, collection: 'Painterly refs' }],
    }));

    const result = await executeImport({
      positionals: [manifestPath],
      options: { space: 'space-1', 'dry-run': 'true', json: 'true' },
    }, makeDeps(calls, output));

    assert.equal(result.dryRun, true);
    assert.equal(calls.filter((call) => call.method === 'POST').length, 0);
    assert.deepEqual(result.collections, [{ name: 'Maps', create: true }]);
    assert.equal(result.collectionItems, 1);
    assert.equal(result.relations, 1);
    assert.deepEqual(result.compositions, [{ name: 'Map Board', create: true }]);
    assert.equal(result.compositionItems, 1);
    assert.deepEqual(result.stylePresets, [{ name: 'Existing Style', action: 'update' }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('import rejects invalid lineage relation types before server requests', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'makefx-import-'));
  const calls: FetchCall[] = [];
  const output: string[] = [];
  try {
    await writeFile(path.join(dir, 'bad.png'), new Uint8Array([1]));
    const manifestPath = path.join(dir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({
      records: [{
        key: 'bad',
        file: 'bad.png',
        name: 'Bad',
        lineage: [{ sourceVariantId: 'variant-external', relationType: 'related' }],
      }],
    }));

    await assert.rejects(
      () => executeImport({
        positionals: [manifestPath],
        options: { space: 'space-1', 'dry-run': 'true' },
      }, makeDeps(calls, output)),
      /relationType must be derived, refined, or forked/
    );
    assert.equal(calls.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
