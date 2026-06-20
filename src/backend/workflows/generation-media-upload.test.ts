import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Buffer } from 'node:buffer';
import type { Env } from '../../core/types';
import { uploadGeneratedMedia, type MediaUploadResult } from './generation-media-upload';

/**
 * Cloudflare Workflows caps each step's output at 1 MiB. These tests feed
 * multi-MB media payloads through uploadGeneratedMedia and assert that the
 * returned value (which becomes a step output) stays tiny — i.e. the bytes go
 * to R2 and never cross the step boundary. See INV-63 / ./README.md.
 */

const STEP_OUTPUT_CAP_BYTES = 1024 * 1024; // 1 MiB

type StoredObject = { bytes: Uint8Array; contentType?: string };

function createMockImages() {
  const store = new Map<string, StoredObject>();
  const bucket = {
    store,
    async put(key: string, value: Uint8Array | ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      store.set(key, { bytes, contentType: opts?.httpMetadata?.contentType });
      return {};
    },
    async get(key: string) {
      const entry = store.get(key);
      if (!entry) return null;
      const { bytes } = entry;
      return {
        httpMetadata: { contentType: entry.contentType },
        async arrayBuffer() {
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
      };
    },
  };
  return bucket;
}

function createEnv(images: ReturnType<typeof createMockImages>): Env {
  // ENVIRONMENT undefined => createThumbnail takes the local path (reads R2,
  // no network), keeping the test hermetic.
  return { IMAGES: images, INVENTORY_IMAGE_PROVIDER: 'fake' } as unknown as Env;
}

/** Serialized size of a step's return value, as Cloudflare would persist it. */
function stepOutputBytes(result: MediaUploadResult): number {
  return Buffer.byteLength(JSON.stringify(result), 'utf8');
}

describe('uploadGeneratedMedia — no binary blob crosses a step boundary', () => {
  test('video: multi-MB payload goes to R2; step output stays under 1 MiB', async () => {
    const images = createMockImages();
    const env = createEnv(images);

    // ~1.5 MiB of valid base64 ("AAAA" => 3 zero bytes). Returning this as a
    // step output is exactly the bug that broke production video generation.
    const videoData = 'A'.repeat(2_000_000);

    const result = await uploadGeneratedMedia(
      env,
      {
        videoData,
        videoMimeType: 'video/mp4',
        model: 'veo-3.1-fast-generate-preview',
        aspectRatio: '16:9',
        resolution: '720p',
        durationSeconds: 8,
        generateAudio: true,
      } as never,
      { spaceId: 'space_1', variantId: 'var_1', operation: 'derive', refCount: 1, requestId: 'req_1', jobId: 'var_1' }
    );

    assert.equal(result.mediaKey, 'media/space_1/var_1.mp4');
    assert.equal(result.imageKey, null);
    assert.equal(result.mediaMimeType, 'video/mp4');
    assert.equal(result.mediaDurationMs, 8000);
    assert.equal(result.providerMetadata?.generateAudio, true);
    assert.equal(result.providerMetadata?.videoTier, 'fast');

    // The payload landed in R2…
    const stored = images.store.get('media/space_1/var_1.mp4');
    assert.ok(stored, 'video bytes must be written to R2');
    assert.equal(result.mediaSizeBytes, stored.bytes.byteLength);
    assert.ok(stored.bytes.byteLength > STEP_OUTPUT_CAP_BYTES, 'sanity: payload exceeds the 1 MiB cap');

    // …and the step output is tiny (keys + metadata only).
    assert.ok(
      stepOutputBytes(result) < 2_000,
      `step output must be far below 1 MiB, got ${stepOutputBytes(result)} bytes`
    );
    assert.ok(!JSON.stringify(result).includes(videoData.slice(0, 64)), 'raw payload must not appear in the step output');
  });

  test('image: multi-MB payload goes to R2; step output stays under 1 MiB', async () => {
    const images = createMockImages();
    const env = createEnv(images);

    // Valid PNG signature + ~1.6 MiB body so detectImageType => png.
    const header = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const bytes = new Uint8Array(header.length + 1_600_000);
    bytes.set(header);
    const imageData = Buffer.from(bytes).toString('base64');

    const result = await uploadGeneratedMedia(
      env,
      {
        imageData,
        imageMimeType: 'image/png',
        model: 'gemini-3-pro-image-preview',
        aspectRatio: '1:1',
      } as never,
      { spaceId: 'space_1', variantId: 'var_2', operation: 'generate', refCount: 0, requestId: 'req_2', jobId: 'var_2' }
    );

    assert.equal(result.mediaKey, 'images/space_1/var_2.png');
    assert.equal(result.imageKey, 'images/space_1/var_2.png');
    assert.equal(result.thumbKey, 'images/space_1/var_2_thumb.webp');

    const stored = images.store.get('images/space_1/var_2.png');
    assert.ok(stored, 'image bytes must be written to R2');
    assert.ok(stored.bytes.byteLength > STEP_OUTPUT_CAP_BYTES, 'sanity: payload exceeds the 1 MiB cap');
    assert.ok(images.store.has('images/space_1/var_2_thumb.webp'), 'thumbnail must be written to R2');

    assert.ok(
      stepOutputBytes(result) < 2_000,
      `step output must be far below 1 MiB, got ${stepOutputBytes(result)} bytes`
    );
    assert.ok(!JSON.stringify(result).includes(imageData.slice(0, 64)), 'raw payload must not appear in the step output');
  });

  test('video: preserves requested no-audio metadata', async () => {
    const images = createMockImages();
    const env = createEnv(images);

    const result = await uploadGeneratedMedia(
      env,
      {
        videoData: 'ZmFrZSB2aWRlbw==',
        videoMimeType: 'video/mp4',
        model: 'veo-3.1-fast-generate-preview',
        aspectRatio: '9:16',
        resolution: '720p',
        durationSeconds: 4,
        referenceMode: 'text-to-video',
        generateAudio: false,
      },
      { spaceId: 'space_1', variantId: 'var_silent', operation: 'generate', refCount: 0, requestId: 'req_silent', jobId: 'var_silent' }
    );

    assert.equal(result.providerMetadata?.generateAudio, false);
    assert.equal(result.providerMetadata?.durationSeconds, 4);
  });
});
