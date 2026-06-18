import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { NanoBananaService } from './nanoBananaService';

describe('NanoBananaService model capabilities', () => {
  test('rejects unsupported Flash output size before calling Gemini', async () => {
    const service = new NanoBananaService('test-api-key');

    await assert.rejects(
      () => service.generate({
        prompt: 'A small icon',
        model: 'gemini-2.5-flash-image',
        imageSize: '2K',
      }),
      /gemini-2\.5-flash-image supports only 1K output/
    );
  });

  test('rejects references above selected model limit before calling Gemini', async () => {
    const service = new NanoBananaService('test-api-key');
    const image = { data: 'AAAA', mimeType: 'image/png' };

    await assert.rejects(
      () => service.compose({
        prompt: 'Combine these',
        model: 'gemini-2.5-flash-image',
        images: [image, image],
      }),
      /gemini-2\.5-flash-image supports at most 1 reference image/
    );
  });
});
