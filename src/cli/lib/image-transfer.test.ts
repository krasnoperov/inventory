import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadImage, looksLikeFilePath, uploadLocalImageAsReference } from './image-transfer';

test('looksLikeFilePath recognizes local paths and supported image filenames', () => {
  assert.equal(looksLikeFilePath('./ref.png'), true);
  assert.equal(looksLikeFilePath('refs/ref.webp'), true);
  assert.equal(looksLikeFilePath('ref.jpg'), true);
  assert.equal(looksLikeFilePath('variant-id-123'), false);
});

test('downloadImage refuses to overwrite without force', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-download-'));
  const outputPath = path.join(dir, 'out.png');
  await writeFile(outputPath, 'existing');

  try {
    await assert.rejects(
      () => downloadImage({
        baseUrl: 'https://makefx-stage.example.test',
        imageKey: 'images/space/out.png',
        outputPath,
      }),
      /already exists/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('uploadLocalImageAsReference sends image media kind', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inventory-upload-'));
  const filePath = path.join(dir, 'ref.png');
  const originalFetch = globalThis.fetch;
  const capturedBodies: BodyInit[] = [];

  await writeFile(filePath, 'png');
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.body) {
      capturedBodies.push(init.body);
    }
    return new Response(JSON.stringify({
      success: true,
      asset: { id: 'asset-ref', name: 'Reference', type: 'reference' },
      variant: {
        id: 'variant-ref',
        asset_id: 'asset-ref',
        image_key: 'images/ref.png',
        thumb_key: 'thumbs/ref.webp',
        status: 'completed',
        recipe: '{}',
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    await uploadLocalImageAsReference({
      baseUrl: 'https://makefx-stage.example.test',
      accessToken: 'token',
      spaceId: 'space-1',
      filePath,
    });

    const formData = capturedBodies[0];
    assert.ok(formData instanceof FormData);
    assert.equal(formData.get('assetType'), 'reference');
    assert.equal(formData.get('mediaKind'), 'image');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});
