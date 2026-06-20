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
