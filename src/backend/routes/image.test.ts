import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { imageRoutes } from './image';
import type { AppContext } from './types';

interface FakeObjectInput {
  key: string;
  body: string;
  contentType?: string;
  httpEtag?: string;
  range?: R2Range;
  size?: number;
}

interface GetCall {
  key: string;
  options?: R2GetOptions;
}

function makeObject(input: FakeObjectInput): R2ObjectBody {
  const body = new TextEncoder().encode(input.body);
  return {
    key: input.key,
    version: 'version',
    size: input.size ?? body.byteLength,
    etag: 'etag',
    httpEtag: input.httpEtag ?? '"etag"',
    checksums: {} as R2Checksums,
    uploaded: new Date('2026-01-01T00:00:00.000Z'),
    httpMetadata: input.contentType ? { contentType: input.contentType } : undefined,
    customMetadata: undefined,
    range: input.range,
    storageClass: 'Standard',
    ssecKeyMd5: undefined,
    writeHttpMetadata(headers: Headers) {
      if (input.contentType) headers.set('Content-Type', input.contentType);
    },
    body: new Blob([body]).stream(),
    bodyUsed: false,
    arrayBuffer: async () => body.buffer,
    bytes: async () => body,
    text: async () => input.body,
    json: async <T>() => JSON.parse(input.body) as T,
    blob: async () => new Blob([body]),
  };
}

function buildApp(objects: Record<string, R2ObjectBody> = {}) {
  const app = new Hono<AppContext>();
  const calls: GetCall[] = [];

  app.use('*', async (c, next) => {
    c.env = {
      IMAGES: {
        get: async (key: string, options?: R2GetOptions) => {
          calls.push({ key, options });
          return objects[key] ?? null;
        },
      },
    } as unknown as AppContext['Bindings'];
    await next();
  });
  app.route('/', imageRoutes);

  return { app, calls };
}

function buildAppWithoutStorage() {
  const app = new Hono<AppContext>();
  app.use('*', async (c, next) => {
    c.env = {} as AppContext['Bindings'];
    await next();
  });
  app.route('/', imageRoutes);
  return app;
}

describe('imageRoutes', () => {
  it('continues serving legacy image keys with immutable caching', async () => {
    const { app, calls } = buildApp({
      'images/space/variant.png': makeObject({
        key: 'images/space/variant.png',
        body: 'png-data',
        contentType: 'image/png',
      }),
    });

    const res = await app.fetch(new Request('https://app.example/api/images/images/space/variant.png'));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(calls[0].key, 'images/space/variant.png');
    assert.strictEqual(calls[0].options, undefined);
    assert.strictEqual(res.headers.get('content-type'), 'image/png');
    assert.strictEqual(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.strictEqual(res.headers.get('etag'), '"etag"');
    assert.strictEqual(await res.text(), 'png-data');
  });

  it('keeps image/png as the legacy image content-type fallback', async () => {
    const { app } = buildApp({
      'images/space/variant.unknown': makeObject({
        key: 'images/space/variant.unknown',
        body: 'image',
      }),
    });

    const res = await app.fetch(new Request('https://app.example/api/images/images/space/variant.unknown'));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'image/png');
  });

  it('serves generic media_key objects with media MIME inference', async () => {
    const { app, calls } = buildApp({
      'media/space/variant.mp4': makeObject({
        key: 'media/space/variant.mp4',
        body: 'video-data',
      }),
    });

    const res = await app.fetch(new Request('https://app.example/api/media/media/space/variant.mp4'));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(calls[0].key, 'media/space/variant.mp4');
    assert.strictEqual(res.headers.get('content-type'), 'video/mp4');
    assert.strictEqual(res.headers.get('accept-ranges'), 'bytes');
    assert.strictEqual(await res.text(), 'video-data');
  });

  it('preserves stored metadata content type for generic media', async () => {
    const { app } = buildApp({
      'media/space/variant.bin': makeObject({
        key: 'media/space/variant.bin',
        body: 'audio',
        contentType: 'audio/mpeg',
      }),
    });

    const res = await app.fetch(new Request('https://app.example/api/media/media/space/variant.bin'));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'audio/mpeg');
  });

  it('returns 206 for range requests against generic media', async () => {
    const { app, calls } = buildApp({
      'media/space/variant.mp4': makeObject({
        key: 'media/space/variant.mp4',
        body: 'cdef',
        contentType: 'video/mp4',
        range: { offset: 2, length: 4 },
        size: 10,
      }),
    });

    const res = await app.fetch(new Request('https://app.example/api/media/media/space/variant.mp4', {
      headers: { Range: 'bytes=2-5' },
    }));

    assert.strictEqual(res.status, 206);
    assert(calls[0].options?.range instanceof Headers);
    assert.strictEqual(res.headers.get('content-range'), 'bytes 2-5/10');
    assert.strictEqual(res.headers.get('content-length'), '4');
    assert.strictEqual(res.headers.get('accept-ranges'), 'bytes');
    assert.strictEqual(await res.text(), 'cdef');
  });

  it('returns 304 when the client already has the current object', async () => {
    const { app } = buildApp({
      'media/space/variant.mp3': makeObject({
        key: 'media/space/variant.mp3',
        body: 'audio-data',
        contentType: 'audio/mpeg',
        httpEtag: '"fresh"',
      }),
    });

    const res = await app.fetch(new Request('https://app.example/api/media/media/space/variant.mp3', {
      headers: { 'If-None-Match': '"fresh"' },
    }));

    assert.strictEqual(res.status, 304);
    assert.strictEqual(await res.text(), '');
  });

  it('returns media-specific errors when storage is unavailable or missing a key', async () => {
    const noStorage = await buildAppWithoutStorage().fetch(new Request('https://app.example/api/media/media/space/missing.mp4'));
    assert.strictEqual(noStorage.status, 503);
    assert.deepStrictEqual(await noStorage.json(), { error: 'Media storage not configured' });

    const { app } = buildApp();
    const missing = await app.fetch(new Request('https://app.example/api/media/media/space/missing.mp4'));
    assert.strictEqual(missing.status, 404);
    assert.deepStrictEqual(await missing.json(), { error: 'Media not found' });
  });
});
