import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { imageRoutes } from './image';
import type { AppContext } from './types';
import { AuthService } from '../features/auth/auth-service';
import { MemberDAO } from '../../dao/member-dao';

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

interface VariantMediaFixture {
  id: string;
  status: string;
  media_key?: string | null;
  media_mime_type?: string | null;
  poster_key?: string | null;
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

function buildApp(input: {
  objects?: Record<string, R2ObjectBody>;
  variants?: Record<string, VariantMediaFixture>;
  isMember?: boolean;
  includeImages?: boolean;
  includeSpacesDO?: boolean;
} = {}) {
  const app = new Hono<AppContext>();
  const calls: GetCall[] = [];
  const variants = input.variants ?? {};
  const includeImages = input.includeImages ?? true;
  const includeSpacesDO = input.includeSpacesDO ?? true;

  app.use('*', async (c, next) => {
    c.env = {
      IMAGES: includeImages ? {
        get: async (key: string, options?: R2GetOptions) => {
          calls.push({ key, options });
          return input.objects?.[key] ?? null;
        },
      } : undefined,
      SPACES_DO: includeSpacesDO ? {
        idFromName: (name: string) => ({ name }),
        get: () => ({
          fetch: async (request: Request) => {
            const variantId = new URL(request.url).pathname.split('/').pop()!;
            const variant = variants[decodeURIComponent(variantId)];
            if (!variant) return new Response(JSON.stringify({ error: 'Variant not found' }), { status: 404 });
            return Response.json(variant);
          },
        }),
      } : undefined,
    } as unknown as AppContext['Bindings'];
    c.set('container', {
      get: (token: unknown) => {
        if (token === AuthService) {
          return {
            verifyJWT: async () => ({ userId: 123 }),
          };
        }
        if (token === MemberDAO) {
          return {
            getMember: async () => input.isMember === false ? null : { role: 'viewer' },
          };
        }
        throw new Error('Unexpected dependency');
      },
    } as never);
    await next();
  });
  app.route('/', imageRoutes);

  return { app, calls };
}

describe('imageRoutes', () => {
  it('continues serving legacy image keys with immutable caching', async () => {
    const { app, calls } = buildApp({
      objects: {
        'images/space/variant.png': makeObject({
          key: 'images/space/variant.png',
          body: 'png-data',
          contentType: 'image/png',
        }),
      },
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
      objects: {
        'images/space/variant.unknown': makeObject({
          key: 'images/space/variant.unknown',
          body: 'image',
        }),
      },
    });

    const res = await app.fetch(new Request('https://app.example/api/images/images/space/variant.unknown'));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'image/png');
  });

  it('serves authenticated variant media_key objects with media MIME inference', async () => {
    const { app, calls } = buildApp({
      variants: {
        'variant-1': { id: 'variant-1', status: 'completed', media_key: 'media/space/variant.mp4' },
      },
      objects: {
        'media/space/variant.mp4': makeObject({
          key: 'media/space/variant.mp4',
          body: 'video-data',
        }),
      },
    });

    const res = await app.fetch(new Request('https://app.example/api/spaces/space-1/variants/variant-1/media', {
      headers: { Authorization: 'Bearer test-token' },
    }));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(calls[0].key, 'media/space/variant.mp4');
    assert.strictEqual(res.headers.get('content-type'), 'video/mp4');
    assert.strictEqual(res.headers.get('accept-ranges'), 'bytes');
    assert.strictEqual(await res.text(), 'video-data');
  });

  it('serves authenticated variant poster_key objects when present', async () => {
    const { app, calls } = buildApp({
      variants: {
        'variant-1': { id: 'variant-1', status: 'completed', media_key: 'media/space/variant.mp4', poster_key: 'posters/space/variant.webp' },
      },
      objects: {
        'posters/space/variant.webp': makeObject({
          key: 'posters/space/variant.webp',
          body: 'poster',
        }),
      },
    });

    const res = await app.fetch(new Request('https://app.example/api/spaces/space-1/variants/variant-1/poster', {
      headers: { Authorization: 'Bearer test-token' },
    }));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(calls[0].key, 'posters/space/variant.webp');
    assert.strictEqual(res.headers.get('content-type'), 'image/webp');
    assert.strictEqual(res.headers.get('accept-ranges'), null);
    assert.strictEqual(await res.text(), 'poster');
  });

  it('preserves stored metadata content type for authenticated variant media', async () => {
    const { app } = buildApp({
      variants: {
        'variant-1': { id: 'variant-1', status: 'completed', media_key: 'media/space/variant.bin' },
      },
      objects: {
        'media/space/variant.bin': makeObject({
          key: 'media/space/variant.bin',
          body: 'audio',
          contentType: 'audio/mpeg',
        }),
      },
    });

    const res = await app.fetch(new Request('https://app.example/api/spaces/space-1/variants/variant-1/media', {
      headers: { Authorization: 'Bearer test-token' },
    }));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'audio/mpeg');
  });

  it('uses variant media_mime_type when R2 metadata and key extension are not specific', async () => {
    const { app } = buildApp({
      variants: {
        'variant-1': {
          id: 'variant-1',
          status: 'completed',
          media_key: 'media/space/variant',
          media_mime_type: 'audio/wav',
        },
      },
      objects: {
        'media/space/variant': makeObject({
          key: 'media/space/variant',
          body: 'audio',
        }),
      },
    });

    const res = await app.fetch(new Request('https://app.example/api/spaces/space-1/variants/variant-1/media', {
      headers: { Authorization: 'Bearer test-token' },
    }));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'audio/wav');
  });

  it('returns 206 for range requests against authenticated variant media', async () => {
    const { app, calls } = buildApp({
      variants: {
        'variant-1': { id: 'variant-1', status: 'completed', media_key: 'media/space/variant.mp4' },
      },
      objects: {
        'media/space/variant.mp4': makeObject({
          key: 'media/space/variant.mp4',
          body: 'cdef',
          contentType: 'video/mp4',
          range: { offset: 2, length: 4 },
          size: 10,
        }),
      },
    });

    const res = await app.fetch(new Request('https://app.example/api/spaces/space-1/variants/variant-1/media', {
      headers: { Authorization: 'Bearer test-token', Range: 'bytes=2-5' },
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
      variants: {
        'variant-1': { id: 'variant-1', status: 'completed', media_key: 'media/space/variant.mp3' },
      },
      objects: {
        'media/space/variant.mp3': makeObject({
          key: 'media/space/variant.mp3',
          body: 'audio-data',
          contentType: 'audio/mpeg',
          httpEtag: '"fresh"',
        }),
      },
    });

    const res = await app.fetch(new Request('https://app.example/api/spaces/space-1/variants/variant-1/media', {
      headers: { Authorization: 'Bearer test-token', 'If-None-Match': '"fresh"' },
    }));

    assert.strictEqual(res.status, 304);
    assert.strictEqual(await res.text(), '');
  });

  it('requires authentication for variant media routes', async () => {
    const { app } = buildApp();
    const res = await app.fetch(new Request('https://app.example/api/spaces/space-1/variants/variant-1/media'));
    assert.strictEqual(res.status, 401);
  });

  it('requires space membership before resolving a variant media key', async () => {
    const { app, calls } = buildApp({
      isMember: false,
      variants: {
        'variant-1': { id: 'variant-1', status: 'completed', media_key: 'media/space/variant.mp4' },
      },
    });

    const res = await app.fetch(new Request('https://app.example/api/spaces/space-1/variants/variant-1/media', {
      headers: { Authorization: 'Bearer test-token' },
    }));

    assert.strictEqual(res.status, 403);
    assert.deepStrictEqual(await res.json(), { error: 'Access denied' });
    assert.strictEqual(calls.length, 0);
  });

  it('returns artifact-specific errors when a variant has no media or poster key', async () => {
    const { app } = buildApp({
      variants: {
        'variant-1': { id: 'variant-1', status: 'completed', media_key: null, poster_key: null },
      },
    });

    const media = await app.fetch(new Request('https://app.example/api/spaces/space-1/variants/variant-1/media', {
      headers: { Authorization: 'Bearer test-token' },
    }));
    assert.strictEqual(media.status, 404);
    assert.deepStrictEqual(await media.json(), { error: 'Variant media not available' });

    const poster = await app.fetch(new Request('https://app.example/api/spaces/space-1/variants/variant-1/poster', {
      headers: { Authorization: 'Bearer test-token' },
    }));
    assert.strictEqual(poster.status, 404);
    assert.deepStrictEqual(await poster.json(), { error: 'Variant poster not available' });
  });

  it('returns media-specific errors when storage is unavailable or missing a key', async () => {
    const noStorageApp = buildApp({
      includeImages: false,
      variants: {
        'variant-1': { id: 'variant-1', status: 'completed', media_key: 'media/space/missing.mp4' },
      },
    }).app;
    const noStorage = await noStorageApp.fetch(new Request('https://app.example/api/spaces/space-1/variants/variant-1/media', {
      headers: { Authorization: 'Bearer test-token' },
    }));
    assert.strictEqual(noStorage.status, 503);
    assert.deepStrictEqual(await noStorage.json(), { error: 'Media storage not configured' });

    const { app } = buildApp({
      variants: {
        'variant-1': { id: 'variant-1', status: 'completed', media_key: 'media/space/missing.mp4' },
      },
    });
    const missing = await app.fetch(new Request('https://app.example/api/spaces/space-1/variants/variant-1/media', {
      headers: { Authorization: 'Bearer test-token' },
    }));
    assert.strictEqual(missing.status, 404);
    assert.deepStrictEqual(await missing.json(), { error: 'Media not found' });
  });
});
