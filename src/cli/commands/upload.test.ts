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
      const requestUrl = String(url);
      const method = init?.method ?? 'GET';
      const headers = init?.headers as Record<string, string> | undefined;
      assert.equal(headers?.Authorization, 'Bearer token-1');

      if (method === 'GET' && requestUrl === 'https://inventory.example.test/api/spaces/space-1/assets') {
        return Response.json({
          assets: [
            { id: 'asset-source', name: 'Source', type: 'reference', media_kind: 'image', active_variant_id: 'variant-source' },
            { id: 'asset-anna', name: 'Anna', type: 'character', media_kind: 'image', active_variant_id: 'variant-anna' },
            { id: 'asset-roman', name: 'Roman', type: 'character', media_kind: 'image', active_variant_id: 'variant-roman' },
            { id: 'asset-bg', name: 'Cocina Background', type: 'scene', media_kind: 'image', active_variant_id: 'variant-bg' },
          ],
        });
      }

      if (method === 'GET' && requestUrl === 'https://inventory.example.test/api/spaces/space-1/assets/asset-source') {
        return Response.json({
          asset: { id: 'asset-source', name: 'Source', media_kind: 'image' },
          variants: [{ id: 'variant-source', asset_id: 'asset-source', media_kind: 'image' }],
          lineage: [],
        });
      }

      if (method === 'GET' && requestUrl === 'https://inventory.example.test/api/spaces/space-1/assets/asset-anna') {
        return Response.json({
          asset: { id: 'asset-anna', name: 'Anna', media_kind: 'image' },
          variants: [{ id: 'variant-anna', asset_id: 'asset-anna', media_kind: 'image' }],
          lineage: [],
        });
      }

      if (method === 'GET' && requestUrl === 'https://inventory.example.test/api/spaces/space-1/assets/asset-roman') {
        return Response.json({
          asset: { id: 'asset-roman', name: 'Roman', media_kind: 'image' },
          variants: [{ id: 'variant-roman', asset_id: 'asset-roman', media_kind: 'image' }],
          lineage: [],
        });
      }

      if (method === 'GET' && requestUrl === 'https://inventory.example.test/api/spaces/space-1/assets/asset-bg') {
        return Response.json({
          asset: { id: 'asset-bg', name: 'Cocina Background', media_kind: 'image' },
          variants: [{ id: 'variant-bg', asset_id: 'asset-bg', media_kind: 'image' }],
          lineage: [],
        });
      }

      assert.equal(requestUrl, 'https://inventory.example.test/api/spaces/space-1/upload');
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
            operation: 'upload',
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
    assert.equal(formData.has('operation'), false);
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

test('upload records a mirror entry after successful upload', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-upload-command-'));
  const filePath = path.join(dir, 'clip.mp4');
  const capturedBodies: BodyInit[] = [];
  const output: string[] = [];
  const mirrorRecords: unknown[] = [];

  try {
    await writeFile(filePath, new Uint8Array([1, 2, 3]));
    await executeUpload({
      positionals: [filePath],
      options: { space: 'space-1', name: 'Combat Clip', type: 'video' },
    }, {
      ...depsFor(capturedBodies, output),
      recordMirrorForFile: async (input) => {
        mirrorRecords.push(input);
        return {
          version: 1,
          baseUrl: input.baseUrl,
          environment: input.environment,
          spaceId: input.spaceId,
          sha256: 'hash-1',
          sizeBytes: 3,
          paths: ['clip.mp4'],
          assetId: input.assetId,
          variantId: input.variantId,
          mediaKind: input.mediaKind ?? 'image',
          mediaKey: input.mediaKey,
          updatedAt: '2026-06-26T00:00:00.000Z',
        };
      },
    });

    assert.deepEqual(mirrorRecords, [{
      projectRoot: undefined,
      baseUrl: 'https://inventory.example.test',
      environment: 'production',
      spaceId: 'space-1',
      filePath,
      assetId: 'asset-1',
      variantId: 'variant-1',
      mediaKind: 'video',
      mediaKey: 'media/space-1/variant-1.mp4',
    }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload does not record a mirror entry when upload fails', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-upload-command-'));
  const filePath = path.join(dir, 'clip.mp4');
  const output: string[] = [];
  const mirrorRecords: unknown[] = [];

  try {
    await writeFile(filePath, new Uint8Array([1, 2, 3]));
    await assert.rejects(
      () => executeUpload({
        positionals: [filePath],
        options: { space: 'space-1', name: 'Combat Clip', type: 'video' },
      }, {
        ...depsFor([], output),
        fetch: async () => Response.json({ error: 'failed' }, { status: 500 }),
        recordMirrorForFile: async (input) => {
          mirrorRecords.push(input);
          throw new Error('unexpected mirror record');
        },
      }),
      /Upload failed: failed/
    );
    assert.deepEqual(mirrorRecords, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload sends single-file provenance and lineage metadata', async () => {
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
    assert.equal(formData.has('operation'), false);
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
    assert.match(output.join('\n'), /Uploading/);
    assert.match(output.join('\n'), /Source variant: variant-source \(refined\)/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload accepts multiple source variants for imported scene lineage', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-upload-command-'));
  const filePath = path.join(dir, 'cocina.png');
  const capturedBodies: BodyInit[] = [];
  const output: string[] = [];

  try {
    await writeFile(filePath, new Uint8Array([1, 2, 3]));
    await executeUpload({
      positionals: [filePath],
      options: {
        space: 'space-1',
        name: 'Cocina',
        type: 'scene',
        'source-variants': 'variant-anna, variant-roman, variant-bg',
      },
    }, depsFor(capturedBodies, output));

    const formData = capturedBodies[0];
    assert.ok(formData instanceof FormData);
    assert.deepEqual(JSON.parse(String(formData.get('lineage'))), [
      { parentVariantId: 'variant-anna', relationType: 'derived' },
      { parentVariantId: 'variant-roman', relationType: 'derived' },
      { parentVariantId: 'variant-bg', relationType: 'derived' },
    ]);
    assert.match(output.join('\n'), /Source variants: variant-anna, variant-roman, variant-bg \(derived\)/);
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

test('upload treats JSON files as unsupported direct media instead of manifests', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-upload-command-'));
  const filePath = path.join(dir, 'upload.json');
  const capturedBodies: BodyInit[] = [];
  const output: string[] = [];

  try {
    await writeFile(filePath, '{"records":[]}', 'utf8');
    await assert.rejects(
      () => executeUpload({
        positionals: [filePath],
        options: { space: 'space-1', name: 'Upload' },
      }, depsFor(capturedBodies, output)),
      /Invalid file type "\.json"/
    );
    assert.equal(capturedBodies.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('upload rejects dry-run because direct upload is the only workflow', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-upload-command-'));
  const filePath = path.join(dir, 'hero.png');
  const capturedBodies: BodyInit[] = [];
  const output: string[] = [];

  try {
    await writeFile(filePath, new Uint8Array([1, 2, 3]));
    await assert.rejects(
      () => executeUpload({
        positionals: [filePath],
        options: { space: 'space-1', name: 'Hero', 'dry-run': 'true' },
      }, depsFor(capturedBodies, output)),
      /--dry-run is not supported for direct file upload/
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
