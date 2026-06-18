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

    assert.equal(result.variant.id, 'variant-1');
    const formData = capturedBodies[0];
    assert.ok(formData instanceof FormData);
    assert.equal(formData.get('assetName'), 'Combat Clip');
    assert.equal(formData.get('assetType'), 'video');
    assert.equal(formData.get('mediaKind'), 'video');

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
