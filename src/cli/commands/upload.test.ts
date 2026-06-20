import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeUpload } from './upload';
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

function depsFor(capturedBodies: BodyInit[], output: string[]) {
  return {
    loadConfig: async () => storedConfig(),
    loadProjectConfig: async () => null,
    resolveBaseUrl: () => 'https://inventory.example.test',
    fetch: async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(url), 'https://inventory.example.test/api/spaces/space-1/upload');
      const headers = init?.headers as Record<string, string> | undefined;
      assert.equal(headers?.Authorization, 'Bearer token-1');
      if (init?.body) capturedBodies.push(init.body);
      return new Response(JSON.stringify({
        success: true,
        asset: {
          id: 'asset-1',
          name: 'Combat Clip',
          type: 'video',
          media_kind: 'video',
          tags: '[]',
          parent_asset_id: null,
          active_variant_id: 'variant-1',
          created_by: 'user-1',
          created_at: 1_780_000_000_000,
          updated_at: 1_780_000_000_000,
        },
        variant: {
          id: 'variant-1',
          asset_id: 'asset-1',
          media_kind: 'video',
          workflow_id: null,
          image_key: null,
          thumb_key: null,
          media_key: 'media/space-1/variant-1.mp4',
          media_mime_type: 'video/mp4',
          media_size_bytes: 3,
          media_width: null,
          media_height: null,
          media_duration_ms: null,
          status: 'completed',
          error_message: null,
          recipe: JSON.stringify({
            operation: 'import',
            originalFilename: 'clip.mp4',
            uploadedAt: '2026-06-16T00:00:00.000Z',
          }),
          starred: false,
          created_by: 'user-1',
          created_at: 1_780_000_000_000,
          updated_at: 1_780_000_000_000,
        },
      }), { headers: { 'content-type': 'application/json' } });
    },
    readFile,
    stat,
    print: (message: string) => output.push(message),
  };
}

interface FetchCall {
  url: string;
  method: string;
  body?: BodyInit | null;
}

function depsForOrganization(calls: FetchCall[], output: string[]) {
  return {
    loadConfig: async () => storedConfig(),
    loadProjectConfig: async () => null,
    resolveBaseUrl: () => 'https://inventory.example.test',
    fetch: async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ url: requestUrl, method, body: init?.body });
      const headers = init?.headers as Record<string, string> | undefined;
      assert.equal(headers?.Authorization, 'Bearer token-1');

      if (method === 'POST' && requestUrl === 'https://inventory.example.test/api/spaces/space-1/upload') {
        return Response.json({
          success: true,
          asset: {
            id: 'asset-1',
            name: 'Hero',
            type: 'character',
            media_kind: 'image',
            tags: '[]',
            parent_asset_id: null,
            active_variant_id: 'variant-1',
            created_by: 'user-1',
            created_at: 1_780_000_000_000,
            updated_at: 1_780_000_000_000,
          },
          variant: {
            id: 'variant-1',
            asset_id: 'asset-1',
            media_kind: 'image',
            workflow_id: null,
            image_key: 'images/space-1/variant-1.png',
            thumb_key: 'images/space-1/variant-1_thumb.webp',
            media_key: 'images/space-1/variant-1.png',
            media_mime_type: 'image/png',
            media_size_bytes: 3,
            media_width: null,
            media_height: null,
            media_duration_ms: null,
            status: 'completed',
            error_message: null,
            recipe: '{}',
            starred: false,
            created_by: 'user-1',
            created_at: 1_780_000_000_000,
            updated_at: 1_780_000_000_000,
          },
        });
      }

      if (method === 'POST' && requestUrl === 'https://inventory.example.test/api/spaces/space-1/collections/collection-cast/items') {
        return Response.json({
          success: true,
          item: {
            id: 'collection-item-1',
            collection_id: 'collection-cast',
            subject_type: 'asset',
            asset_id: 'asset-1',
            variant_id: null,
            role: 'character',
            pinned_variant_id: 'variant-1',
            sort_index: 0,
            created_by: 'user-1',
            created_at: 1,
            updated_at: 1,
          },
        });
      }

      if (method === 'POST' && requestUrl === 'https://inventory.example.test/api/spaces/space-1/relations') {
        return Response.json({
          success: true,
          relation: {
            id: 'relation-1',
            subject_type: 'variant',
            subject_asset_id: null,
            subject_variant_id: 'variant-1',
            object_type: 'asset',
            object_asset_id: 'asset-target',
            object_variant_id: null,
            relation_type: 'thumbnail_for',
            label: 'thumbnail',
            context: null,
            metadata: '{}',
            sort_index: 0,
            created_by: 'user-1',
            created_at: 1,
            updated_at: 1,
          },
        });
      }

      return Response.json({ error: `Unexpected request ${method} ${requestUrl}` }, { status: 500 });
    },
    readFile,
    stat,
    print: (message: string) => output.push(message),
  };
}

test('upload sends video files with explicit media kind and MIME type', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-upload-command-'));
  const filePath = path.join(dir, 'clip.mp4');
  const capturedBodies: BodyInit[] = [];
  const output: string[] = [];

  try {
    await writeFile(filePath, new Uint8Array([1, 2, 3]));
    const result = await executeUpload({
      positionals: [filePath],
      options: { space: 'space-1', name: 'Combat Clip', type: 'video' },
    }, depsFor(capturedBodies, output));

    assert.ok('variant' in result);
    assert.equal(result.variant.id, 'variant-1');
    const formData = capturedBodies[0];
    assert.ok(formData instanceof FormData);
    assert.equal(formData.get('operation'), 'import');
    assert.equal(formData.get('assetName'), 'Combat Clip');
    assert.equal(formData.get('assetType'), 'video');
    assert.equal(formData.get('mediaKind'), 'video');
    assert.equal(formData.get('activeVariantBehavior'), 'if-missing');

    const file = formData.get('file');
    assert.ok(file instanceof File);
    assert.equal(file.name, 'clip.mp4');
    assert.equal(file.type, 'video/mp4');
    assert.match(output.join('\n'), /Media kind: video/);
    assert.match(output.join('\n'), /File:\s+media\/space-1\/variant-1.mp4/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload sends single-file import provenance and lineage metadata', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-upload-command-'));
  const filePath = path.join(dir, 'paintover.png');
  const capturedBodies: BodyInit[] = [];
  const output: string[] = [];

  try {
    await writeFile(filePath, new Uint8Array([1, 2, 3]));
    await executeUpload({
      positionals: [filePath],
      options: {
        space: 'space-1',
        asset: 'asset-1',
        prompt: 'clean silhouette paintover',
        model: 'external-model',
        provider: 'local-tool',
        'provider-metadata': '{"seed":42}',
        'generation-provenance': '{"workflow":"paintover-v1"}',
        'source-variant': 'variant-source',
        'relation-type': 'refined',
        'active-variant-behavior': 'set-active',
      },
    }, depsFor(capturedBodies, output));

    const formData = capturedBodies[0];
    assert.ok(formData instanceof FormData);
    assert.equal(formData.get('operation'), 'import');
    assert.equal(formData.get('assetId'), 'asset-1');
    assert.equal(formData.get('prompt'), 'clean silhouette paintover');
    assert.equal(formData.get('model'), 'external-model');
    assert.equal(formData.get('provider'), 'local-tool');
    assert.equal(formData.get('activeVariantBehavior'), 'set-active');
    assert.deepEqual(JSON.parse(String(formData.get('providerMetadata'))), { seed: 42 });
    assert.deepEqual(JSON.parse(String(formData.get('generationProvenance'))), { workflow: 'paintover-v1' });
    assert.deepEqual(JSON.parse(String(formData.get('lineage'))), [
      { parentVariantId: 'variant-source', relationType: 'refined' },
    ]);
    assert.match(output.join('\n'), /Importing/);
    assert.match(output.join('\n'), /Source variant: variant-source \(refined\)/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload creates collection placement and manual relation without a manifest', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-upload-command-'));
  const filePath = path.join(dir, 'hero.png');
  const calls: FetchCall[] = [];
  const output: string[] = [];

  try {
    await writeFile(filePath, new Uint8Array([1, 2, 3]));
    const result = await executeUpload({
      positionals: [filePath],
      options: {
        space: 'space-1',
        name: 'Hero',
        type: 'character',
        collection: 'collection-cast',
        'collection-role': 'character',
        'manual-relation': 'thumbnail_for:asset:asset-target',
        'manual-relation-label': 'thumbnail',
        'manual-relation-context': '{"source":"upload"}',
        'manual-relation-metadata': '{"priority":1}',
      },
    }, depsForOrganization(calls, output));

    assert.ok('variant' in result);
    assert.deepEqual(result.organization, {
      collectionItemIds: ['collection-item-1'],
      relationIds: ['relation-1'],
    });

    const collectionCall = calls.find((call) => call.url.endsWith('/collections/collection-cast/items'));
    assert.ok(collectionCall);
    assert.deepEqual(JSON.parse(String(collectionCall.body)), {
      subjectType: 'asset',
      assetId: 'asset-1',
      role: 'character',
      pinnedVariantId: 'variant-1',
    });

    const relationCall = calls.find((call) => call.url.endsWith('/relations'));
    assert.ok(relationCall);
    assert.deepEqual(JSON.parse(String(relationCall.body)), {
      subject: { subjectType: 'variant', variantId: 'variant-1' },
      object: { subjectType: 'asset', assetId: 'asset-target' },
      relationType: 'thumbnail_for',
      label: 'thumbnail',
      context: { source: 'upload' },
      metadata: { priority: 1 },
    });
    assert.match(output.join('\n'), /Collection items: collection-item-1/);
    assert.match(output.join('\n'), /Relations:\s+relation-1/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload rejects malformed manual relation specs before sending a request', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-upload-command-'));
  const filePath = path.join(dir, 'hero.png');
  const capturedBodies: BodyInit[] = [];
  const output: string[] = [];

  try {
    await writeFile(filePath, new Uint8Array([1, 2, 3]));
    await assert.rejects(
      () => executeUpload({
        positionals: [filePath],
        options: {
          space: 'space-1',
          name: 'Hero',
          'manual-relation': 'thumbnail_for:asset-target',
        },
      }, depsFor(capturedBodies, output)),
      /--manual-relation entries must use/
    );
    assert.equal(capturedBodies.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload supports audio WebM when requested explicitly', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-upload-command-'));
  const filePath = path.join(dir, 'recording.webm');
  const capturedBodies: BodyInit[] = [];
  const output: string[] = [];

  try {
    await writeFile(filePath, new Uint8Array([1, 2, 3]));
    await executeUpload({
      positionals: [filePath],
      options: { space: 'space-1', name: 'Recording', type: 'audio', 'media-kind': 'audio' },
    }, depsFor(capturedBodies, output));

    const formData = capturedBodies[0];
    assert.ok(formData instanceof FormData);
    assert.equal(formData.get('mediaKind'), 'audio');

    const file = formData.get('file');
    assert.ok(file instanceof File);
    assert.equal(file.name, 'recording.webm');
    assert.equal(file.type, 'audio/webm');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload rejects malformed provenance JSON before sending a request', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-upload-command-'));
  const filePath = path.join(dir, 'hero.png');
  const capturedBodies: BodyInit[] = [];
  const output: string[] = [];

  try {
    await writeFile(filePath, new Uint8Array([1, 2, 3]));
    await assert.rejects(
      () => executeUpload({
        positionals: [filePath],
        options: { space: 'space-1', name: 'Hero', 'provider-metadata': '[]' },
      }, depsFor(capturedBodies, output)),
      /--provider-metadata must be a JSON object/
    );
    assert.equal(capturedBodies.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload rejects relation type without a source variant before sending a request', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-upload-command-'));
  const filePath = path.join(dir, 'hero.png');
  const capturedBodies: BodyInit[] = [];
  const output: string[] = [];

  try {
    await writeFile(filePath, new Uint8Array([1, 2, 3]));
    await assert.rejects(
      () => executeUpload({
        positionals: [filePath],
        options: { space: 'space-1', name: 'Hero', 'relation-type': 'refined' },
      }, depsFor(capturedBodies, output)),
      /--relation-type requires --source-variant/
    );
    assert.equal(capturedBodies.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload rejects explicit media kind mismatches before sending a request', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-upload-command-'));
  const filePath = path.join(dir, 'theme.mp3');
  const capturedBodies: BodyInit[] = [];
  const output: string[] = [];

  try {
    await writeFile(filePath, new Uint8Array([1, 2, 3]));
    await assert.rejects(
      () => executeUpload({
        positionals: [filePath],
        options: { space: 'space-1', name: 'Theme', 'media-kind': 'video' },
      }, depsFor(capturedBodies, output)),
      /does not match/
    );
    assert.equal(capturedBodies.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload resolves missing space and env from project config', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-upload-command-'));
  const filePath = path.join(dir, 'clip.mp4');
  const capturedBodies: BodyInit[] = [];
  const output: string[] = [];
  let loadedEnv = '';

  try {
    await writeFile(filePath, new Uint8Array([1, 2, 3]));
    await executeUpload({
      positionals: [filePath],
      options: { name: 'Combat Clip', type: 'video' },
    }, {
      ...depsFor(capturedBodies, output),
      loadProjectConfig: async () => ({
        version: 1,
        environment: 'production',
        spaceId: 'space-1',
        updatedAt: '2026-06-16T00:00:00.000Z',
      }),
      loadConfig: async (env) => {
        loadedEnv = env || '';
        return storedConfig();
      },
    });

    assert.equal(loadedEnv, 'production');
    assert.equal(capturedBodies.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
