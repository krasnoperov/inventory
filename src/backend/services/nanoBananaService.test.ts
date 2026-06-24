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

describe('NanoBananaService request config', () => {
  test('nests aspectRatio/imageSize under imageConfig for Gemini', async () => {
    const service = new NanoBananaService('test-api-key');

    let capturedConfig: Record<string, unknown> | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).ai.models.generateContent = async (request: any) => {
      capturedConfig = request.config;
      return {
        candidates: [
          { content: { parts: [{ inlineData: { mimeType: 'image/webp', data: 'AAAA' } }] } },
        ],
      };
    };

    await service.generate({
      prompt: 'A wide landscape',
      model: 'gemini-3-pro-image-preview',
      aspectRatio: '16:9',
      imageSize: '4K',
    });

    assert.deepEqual(capturedConfig?.imageConfig, { aspectRatio: '16:9', imageSize: '4K' });
    // Must not leak to the top level, where Gemini silently ignores them.
    assert.equal(capturedConfig?.imageSize, undefined);
    assert.equal(capturedConfig?.aspectRatio, undefined);
  });
});
