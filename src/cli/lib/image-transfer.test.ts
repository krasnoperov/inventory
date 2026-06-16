import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadImage, looksLikeFilePath } from './image-transfer';

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
        baseUrl: 'https://inventory-stage.example.test',
        imageKey: 'images/space/out.png',
        outputPath,
      }),
      /already exists/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
