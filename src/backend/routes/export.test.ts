import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { exportRoutes } from './export';
import type { AppContext } from './types';
import { AuthService } from '../features/auth/auth-service';
import { MemberDAO } from '../../dao/member-dao';

interface PutCall {
  key: string;
  body: Uint8Array;
  contentType?: string;
}

interface DoCall {
  path: string;
  body?: Record<string, unknown>;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function makeObject(key: string, body: string, contentType?: string): R2ObjectBody {
  const bytes = new TextEncoder().encode(body);
  return {
    key,
    version: 'version',
    size: bytes.byteLength,
    etag: 'etag',
    httpEtag: '"etag"',
    checksums: {} as R2Checksums,
    uploaded: new Date('2026-01-01T00:00:00.000Z'),
    httpMetadata: contentType ? { contentType } : undefined,
    customMetadata: undefined,
    range: undefined,
    storageClass: 'Standard',
    ssecKeyMd5: undefined,
    writeHttpMetadata(headers: Headers) {
      if (contentType) headers.set('Content-Type', contentType);
    },
    body: new Blob([toArrayBuffer(bytes)]).stream(),
    bodyUsed: false,
    arrayBuffer: async () => toArrayBuffer(bytes),
    bytes: async () => bytes,
    text: async () => body,
    json: async <T>() => JSON.parse(body) as T,
    blob: async () => new Blob([toArrayBuffer(bytes)]),
  };
}

async function toBytes(value: unknown): Promise<Uint8Array> {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  if (typeof value === 'string') return new TextEncoder().encode(value);
  throw new Error('Unsupported R2 put body');
}

function buildApp(options: {
  state?: Record<string, unknown>;
  objects?: Record<string, R2ObjectBody>;
  role?: 'owner' | 'editor' | 'viewer' | null;
} = {}) {
  const app = new Hono<AppContext>();
  const puts: PutCall[] = [];
  const doCalls: DoCall[] = [];
  const stored = new Map<string, { body: Uint8Array; contentType?: string }>();

  app.use('*', async (c, next) => {
    c.env = {
      IMAGES: {
        get: async (key: string) => {
          const storedObject = stored.get(key);
          if (storedObject) {
            return makeObject(key, new TextDecoder().decode(storedObject.body), storedObject.contentType);
          }
          return options.objects?.[key] ?? null;
        },
        put: async (key: string, value: unknown, putOptions?: R2PutOptions) => {
          const body = await toBytes(value);
          const contentType = putOptions?.httpMetadata instanceof Headers
            ? putOptions.httpMetadata.get('content-type') ?? undefined
            : putOptions?.httpMetadata?.contentType;
          puts.push({ key, body, contentType });
          stored.set(key, { body, contentType });
          return null;
        },
      },
      SPACES_DO: {
        idFromName: (name: string) => ({ name }),
        get: () => ({
          fetch: async (request: Request) => {
            const path = new URL(request.url).pathname;
            const body = request.method === 'GET'
              ? undefined
              : await request.json<Record<string, unknown>>();
            doCalls.push({ path, body });

            if (path === '/internal/state') {
              return Response.json(options.state ?? { assets: [], variants: [], lineage: [] });
            }
            if (path === '/internal/create-asset') {
              return Response.json({ success: true });
            }
            if (path === '/internal/apply-variant') {
              return Response.json({ created: true, variant: body });
            }
            if (path === '/internal/set-active') {
              return Response.json({ success: true });
            }
            if (path === '/internal/add-lineage') {
              return Response.json({ success: true, id: 'lineage-new' });
            }
            return Response.json({ error: 'Unexpected DO route' }, { status: 404 });
          },
        }),
      },
    } as unknown as AppContext['Bindings'];

    c.set('container', {
      get: (token: unknown) => {
        if (token === AuthService) {
          return { verifyJWT: async () => ({ userId: 7 }) };
        }
        if (token === MemberDAO) {
          return {
            getMember: async () => options.role === null ? null : { role: options.role ?? 'editor' },
          };
        }
        throw new Error('Unexpected dependency');
      },
    } as never);
    await next();
  });

  app.route('/', exportRoutes);
  return { app, puts, doCalls };
}

describe('exportRoutes', () => {
  it('exports media-only generated video variants as canonical media files', async () => {
    const { app } = buildApp({
      state: {
        assets: [{
          id: 'asset-video',
          name: 'Cutscene',
          type: 'animation',
          media_kind: 'video',
          tags: '[]',
          active_variant_id: 'variant-video',
          created_at: 1_780_000_000_000,
        }],
        variants: [{
          id: 'variant-video',
          asset_id: 'asset-video',
          media_kind: 'video',
          image_key: null,
          thumb_key: null,
          media_key: 'media/space-1/variant-video.mp4',
          media_mime_type: 'video/mp4',
          media_size_bytes: 10,
          media_width: null,
          media_height: null,
          media_duration_ms: 8000,
          recipe: '{"operation":"generate"}',
          created_at: 1_780_000_000_001,
        }],
        lineage: [],
      },
      objects: {
        'media/space-1/variant-video.mp4': makeObject(
          'media/space-1/variant-video.mp4',
          'video-data',
          'video/mp4'
        ),
      },
    });

    const res = await app.fetch(new Request('https://app.example/api/spaces/space-1/export', {
      headers: { Authorization: 'Bearer test-token' },
    }));

    assert.equal(res.status, 200);
    const unzipped = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(unzipped['manifest.json'])) as {
      assets: Array<{ variants: Array<{ mediaFile: string; imageFile: string | null; thumbFile: string | null; mediaKey: string }> }>;
    };
    const variant = manifest.assets[0].variants[0];
    assert.equal(variant.mediaFile, 'media/Cutscene/variant-video.mp4');
    assert.equal(variant.imageFile, null);
    assert.equal(variant.thumbFile, null);
    assert.equal(variant.mediaKey, 'media/space-1/variant-video.mp4');
    assert.equal(strFromU8(unzipped[variant.mediaFile]), 'video-data');
  });

  it('imports media-only video variants without requiring legacy image files', async () => {
    const manifest = {
      version: '1.0',
      exportedAt: '2026-06-16T00:00:00.000Z',
      spaceId: 'source-space',
      spaceName: 'Source',
      assets: [{
        id: 'asset-video',
        name: 'Cutscene',
        type: 'animation',
        mediaKind: 'video',
        tags: [],
        activeVariantId: 'variant-video',
        createdAt: 1_780_000_000_000,
        variants: [{
          id: 'variant-video',
          assetId: 'asset-video',
          mediaKind: 'video',
          mediaKey: 'media/source/variant-video.mp4',
          mediaMimeType: 'video/mp4',
          mediaSizeBytes: 10,
          mediaWidth: null,
          mediaHeight: null,
          mediaDurationMs: 8000,
          mediaFile: 'media/Cutscene/variant-video.mp4',
          imageFile: null,
          thumbFile: null,
          recipe: { operation: 'generate' },
          createdAt: 1_780_000_000_001,
        }],
      }],
      lineage: [],
    };
    const zip = zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'media/Cutscene/variant-video.mp4': strToU8('video-data'),
    });
    const formData = new FormData();
    formData.set('file', new File([zip], 'export.zip', { type: 'application/zip' }));
    const { app, puts, doCalls } = buildApp();

    const res = await app.fetch(new Request('https://app.example/api/spaces/space-1/import', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
      body: formData,
    }));

    assert.equal(res.status, 200);
    const applyCall = doCalls.find((call) => call.path === '/internal/apply-variant');
    assert.ok(applyCall?.body);
    assert.equal(applyCall.body.mediaKind, 'video');
    assert.equal(applyCall.body.imageKey, null);
    assert.equal(applyCall.body.thumbKey, null);
    assert.match(String(applyCall.body.mediaKey), /^media\/space-1\/.+\.mp4$/);
    assert.equal(applyCall.body.mediaMimeType, 'video/mp4');
    assert.equal(applyCall.body.mediaDurationMs, 8000);
    assert.deepEqual(puts.map((put) => ({
      key: put.key,
      body: new TextDecoder().decode(put.body),
      contentType: put.contentType,
    })), [{
      key: applyCall.body.mediaKey,
      body: 'video-data',
      contentType: 'video/mp4',
    }]);
  });
});
