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

function depsFor(capturedBodies: BodyInit[], output: string[]) {
  return {
    loadConfig: async () => storedConfig(),
    resolveBaseUrl: () => 'https://inventory.example.test',
    fetch: async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(url), 'https://inventory.example.test/api/spaces/space-1/upload');
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer token-1');
      if (init?.body) capturedBodies.push(init.body);
      return new Response(JSON.stringify({
        success: true,
        asset: { id: 'asset-1', name: 'Combat Clip', type: 'video' },
        variant: {
          id: 'variant-1',
          asset_id: 'asset-1',
          media_kind: 'video',
          image_key: null,
          thumb_key: null,
          media_key: 'media/space-1/variant-1.mp4',
          media_mime_type: 'video/mp4',
          media_size_bytes: 3,
          status: 'completed',
          recipe: JSON.stringify({
            operation: 'upload',
            originalFilename: 'clip.mp4',
            uploadedAt: '2026-06-16T00:00:00.000Z',
          }),
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
