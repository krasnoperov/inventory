import assert from 'node:assert/strict';
import { describe, test, mock } from 'node:test';
import { GoogleVeoService } from './googleVeoService';
import type { GenerateVideosOperation } from '@google/genai';

function createClient(operation: Record<string, unknown>) {
  const generateVideos = mock.fn(async (params: Record<string, unknown>) => ({
    done: true,
    response: {
      generatedVideos: [
        {
          video: {
            videoBytes: 'ZmFrZSB2aWRlbw==',
            mimeType: 'video/mp4',
          },
        },
      ],
    },
    ...operation,
  }) as GenerateVideosOperation);
  const getVideosOperation = mock.fn(async () => operation as unknown as GenerateVideosOperation);

  return {
    client: {
      models: { generateVideos },
      operations: { getVideosOperation },
    },
    generateVideos,
    getVideosOperation,
  };
}

describe('GoogleVeoService', () => {
  test('generates a text-to-video request with Veo defaults', async () => {
    const { client, generateVideos, getVideosOperation } = createClient({});
    const service = new GoogleVeoService('test-key', client);

    const result = await service.generate({ prompt: 'slow pan over a pixel-art village' });

    assert.equal(result.videoData, 'ZmFrZSB2aWRlbw==');
    assert.equal(result.videoMimeType, 'video/mp4');
    assert.equal(result.model, 'veo-3.1-generate-preview');
    assert.equal(result.aspectRatio, '16:9');
    assert.equal(result.resolution, '720p');
    assert.equal(result.durationSeconds, 8);
    assert.equal(result.referenceMode, 'text-to-video');
    assert.equal(getVideosOperation.mock.calls.length, 0);

    const request = generateVideos.mock.calls[0].arguments[0] as {
      model: string;
      prompt: string;
      config: { aspectRatio: string; resolution: string; durationSeconds: number; numberOfVideos: number };
    };
    assert.equal(request.model, 'veo-3.1-generate-preview');
    assert.equal(request.prompt, 'slow pan over a pixel-art village');
    assert.deepEqual(request.config, {
      aspectRatio: '16:9',
      resolution: '720p',
      durationSeconds: 8,
      numberOfVideos: 1,
    });
  });

  test('uses top-level image input for one unstyled source image', async () => {
    const { client, generateVideos } = createClient({});
    const service = new GoogleVeoService('test-key', client);

    const result = await service.generate({
      prompt: 'animate the portrait with subtle breathing',
      sourceImages: [
        { data: 'cG9ydHJhaXQ=', mimeType: 'image/png', label: 'Image 1:' },
      ],
    });

    assert.equal(result.referenceMode, 'image-to-video');

    const request = generateVideos.mock.calls[0].arguments[0] as {
      image?: { imageBytes?: string; mimeType?: string };
      config: {
        lastFrame?: unknown;
        referenceImages?: unknown[];
      };
    };
    assert.deepEqual(request.image, { imageBytes: 'cG9ydHJhaXQ=', mimeType: 'image/png' });
    assert.equal(request.config.lastFrame, undefined);
    assert.equal(request.config.referenceImages, undefined);
  });

  test('uses first and last frame inputs for two unstyled source images', async () => {
    const { client, generateVideos } = createClient({});
    const service = new GoogleVeoService('test-key', client);

    const result = await service.generate({
      prompt: 'slow dolly from the doorway to the desk',
      sourceImages: [
        { data: 'c3RhcnQ=', mimeType: 'image/png', label: 'Image 1:' },
        { data: 'ZW5k', mimeType: 'image/webp', label: 'Image 2:' },
      ],
    });

    assert.equal(result.referenceMode, 'first-last-frame');

    const request = generateVideos.mock.calls[0].arguments[0] as {
      image?: { imageBytes?: string; mimeType?: string };
      config: {
        lastFrame?: { imageBytes?: string; mimeType?: string };
        referenceImages?: unknown[];
      };
    };
    assert.deepEqual(request.image, { imageBytes: 'c3RhcnQ=', mimeType: 'image/png' });
    assert.deepEqual(request.config.lastFrame, { imageBytes: 'ZW5k', mimeType: 'image/webp' });
    assert.equal(request.config.referenceImages, undefined);
  });

  test('uses reference images when style references are present', async () => {
    const { client, generateVideos } = createClient({});
    const service = new GoogleVeoService('test-key', client);

    const result = await service.generate({
      prompt: 'animate the character walking through the scene',
      sourceImages: [
        { data: 'c3R5bGU=', mimeType: 'image/png', label: 'Style ref 1:' },
        { data: 'Y2hhcmFjdGVy', mimeType: 'image/webp', label: 'Image 1:' },
      ],
      styleImageCount: 1,
      aspectRatio: '9:16',
    });

    assert.equal(result.referenceMode, 'reference-images');

    const request = generateVideos.mock.calls[0].arguments[0] as {
      image?: unknown;
      config: {
        aspectRatio: string;
        lastFrame?: unknown;
        referenceImages?: Array<{ image?: { imageBytes?: string; mimeType?: string }; referenceType?: string }>;
      };
    };
    assert.equal(request.image, undefined);
    assert.equal(request.config.lastFrame, undefined);
    assert.equal(request.config.aspectRatio, '9:16');
    assert.deepEqual(request.config.referenceImages, [
      { image: { imageBytes: 'c3R5bGU=', mimeType: 'image/png' }, referenceType: 'STYLE' },
      { image: { imageBytes: 'Y2hhcmFjdGVy', mimeType: 'image/webp' }, referenceType: 'ASSET' },
    ]);
  });

  test('downloads generated videos when the operation returns a URI', async () => {
    const { client } = createClient({
      response: {
        generatedVideos: [
          {
            video: {
              uri: 'https://example.test/generated-video',
              mimeType: 'video/mp4',
            },
          },
        ],
      },
    });
    const fetchMock = mock.method(globalThis, 'fetch', async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers;
      assert.ok(headers instanceof Headers);
      assert.equal(headers.get('x-goog-api-key'), 'test-key');
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Type': 'video/mp4' },
      });
    });
    const service = new GoogleVeoService('test-key', client);

    const result = await service.generate({ prompt: 'orbiting camera move' });

    assert.equal(result.videoData, 'AQID');
    assert.equal(result.videoMimeType, 'video/mp4');
    assert.equal(fetchMock.mock.calls.length, 1);
  });
});
