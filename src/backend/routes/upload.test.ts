import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { uploadRoutes } from './upload';
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
  body: Record<string, unknown>;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function makeObject(key: string, body: Uint8Array, contentType?: string): R2ObjectBody {
  return {
    key,
    version: 'version',
    size: body.byteLength,
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
    body: new Blob([toArrayBuffer(body)]).stream(),
    bodyUsed: false,
    arrayBuffer: async () => toArrayBuffer(body),
    bytes: async () => body,
    text: async () => new TextDecoder().decode(body),
    json: async <T>() => JSON.parse(new TextDecoder().decode(body)) as T,
    blob: async () => new Blob([toArrayBuffer(body)]),
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

function buildApp(options: { role?: 'owner' | 'editor' | 'viewer' | null } = {}) {
  const app = new Hono<AppContext>();
  const puts: PutCall[] = [];
  const deletes: string[] = [];
  const doCalls: DoCall[] = [];
  const stored = new Map<string, { body: Uint8Array; contentType?: string }>();

  const bucket = {
    put: async (key: string, value: unknown, putOptions?: R2PutOptions) => {
      const body = await toBytes(value);
      const contentType = putOptions?.httpMetadata instanceof Headers
        ? putOptions.httpMetadata.get('content-type') ?? undefined
        : putOptions?.httpMetadata?.contentType;
      puts.push({ key, body, contentType });
      stored.set(key, { body, contentType });
      return null;
    },
    get: async (key: string) => {
      const object = stored.get(key);
      return object ? makeObject(key, object.body, object.contentType) : null;
    },
    delete: async (key: string) => {
      deletes.push(key);
      stored.delete(key);
    },
  };

  app.use('*', async (c, next) => {
    c.env = {
      ENVIRONMENT: 'local',
      IMAGES: bucket,
      SPACES_DO: {
        idFromName: (name: string) => ({ name }),
        get: () => ({
          fetch: async (request: Request) => {
            const path = new URL(request.url).pathname;
            const body = await request.json<Record<string, unknown>>();
            doCalls.push({ path, body });

            if (path === '/internal/upload-placeholder') {
              return Response.json({
                variant: { id: body.variantId, status: 'uploading', media_kind: body.mediaKind },
                asset: body.assetName ? { id: 'asset-new', name: body.assetName, media_kind: body.mediaKind } : undefined,
                assetId: body.assetId ?? 'asset-new',
              });
            }

            if (path === '/internal/complete-upload') {
              return Response.json({
                variant: {
                  id: body.variantId,
                  status: 'completed',
                  image_key: body.imageKey,
                  thumb_key: body.thumbKey,
                  media_key: body.mediaKey,
                  media_mime_type: body.mediaMimeType,
                  media_size_bytes: body.mediaSizeBytes,
                },
              });
            }

            if (path === '/internal/fail-upload') {
              return Response.json({ variant: { id: body.variantId, status: 'failed' } });
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
  app.route('/', uploadRoutes);

  return { app, puts, deletes, doCalls };
}

function uploadRequest(spaceId: string, formData: FormData): Request {
  return new Request(`https://app.example/api/spaces/${spaceId}/upload`, {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token' },
    body: formData,
  });
}

function styleUploadRequest(spaceId: string, formData: FormData): Request {
  return new Request(`https://app.example/api/spaces/${spaceId}/style-images`, {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token' },
    body: formData,
  });
}

describe('uploadRoutes', () => {
  it('uploads video as canonical media for a new asset', async () => {
    const { app, puts, doCalls } = buildApp();
    const formData = new FormData();
    formData.append('file', new File([new Uint8Array([1, 2, 3])], 'clip.mp4', { type: 'video/mp4' }));
    formData.append('assetName', 'Combat Clip');
    formData.append('assetType', 'animation');

    const res = await app.fetch(uploadRequest('space-1', formData));
    const body = await res.json() as { success: boolean; variant: { media_key: string; image_key: null; thumb_key: null } };

    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(puts.length, 1);
    assert.match(puts[0].key, /^media\/space-1\/.+\.mp4$/);
    assert.strictEqual(puts[0].contentType, 'video/mp4');

    const placeholder = doCalls.find((call) => call.path === '/internal/upload-placeholder');
    assert.ok(placeholder);
    assert.strictEqual(placeholder.body.assetName, 'Combat Clip');
    assert.strictEqual(placeholder.body.assetType, 'animation');
    assert.strictEqual(placeholder.body.mediaKind, 'video');
    const recipe = JSON.parse(String(placeholder.body.recipe)) as Record<string, unknown>;
    assert.strictEqual(recipe.operation, 'upload');
    assert.strictEqual(recipe.mediaKind, 'video');
    assert.strictEqual(recipe.mimeType, 'video/mp4');

    const complete = doCalls.find((call) => call.path === '/internal/complete-upload');
    assert.ok(complete);
    assert.strictEqual(complete.body.imageKey, null);
    assert.strictEqual(complete.body.thumbKey, null);
    assert.strictEqual(complete.body.mediaKey, puts[0].key);
    assert.strictEqual(complete.body.mediaMimeType, 'video/mp4');
    assert.strictEqual(complete.body.mediaSizeBytes, 3);
  });

  it('uploads audio as a variant for an existing asset', async () => {
    const { app, puts, doCalls } = buildApp();
    const formData = new FormData();
    formData.append('file', new File([new Uint8Array([9, 8])], 'theme.mp3', { type: 'audio/mpeg' }));
    formData.append('assetId', 'asset-audio');

    const res = await app.fetch(uploadRequest('space-1', formData));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(puts.length, 1);
    assert.match(puts[0].key, /^media\/space-1\/.+\.mp3$/);
    assert.strictEqual(puts[0].contentType, 'audio/mpeg');

    const placeholder = doCalls.find((call) => call.path === '/internal/upload-placeholder');
    assert.ok(placeholder);
    assert.strictEqual(placeholder.body.assetId, 'asset-audio');
    assert.strictEqual(placeholder.body.mediaKind, 'audio');

    const complete = doCalls.find((call) => call.path === '/internal/complete-upload');
    assert.ok(complete);
    assert.strictEqual(complete.body.imageKey, null);
    assert.strictEqual(complete.body.thumbKey, null);
    assert.strictEqual(complete.body.mediaKey, puts[0].key);
  });

  it('rejects mediaKind values that do not match the uploaded file', async () => {
    const { app, puts, doCalls } = buildApp();
    const formData = new FormData();
    formData.append('file', new File([new Uint8Array([1])], 'clip.mp4', { type: 'video/mp4' }));
    formData.append('assetName', 'Bad Clip');
    formData.append('mediaKind', 'image');

    const res = await app.fetch(uploadRequest('space-1', formData));
    const body = await res.json() as { error: string };

    assert.strictEqual(res.status, 400);
    assert.match(body.error, /does not match/);
    assert.strictEqual(puts.length, 0);
    assert.strictEqual(doCalls.length, 0);
  });

  it('keeps style image uploads image-only', async () => {
    const { app, puts, doCalls } = buildApp();
    const formData = new FormData();
    formData.append('file', new File([new Uint8Array([9, 8])], 'theme.mp3', { type: 'audio/mpeg' }));

    const res = await app.fetch(styleUploadRequest('space-1', formData));
    const body = await res.json() as { error: string };

    assert.strictEqual(res.status, 400);
    assert.match(body.error, /Invalid file type/);
    assert.match(body.error, /image\/png/);
    assert.doesNotMatch(body.error, /audio\/mpeg/);
    assert.strictEqual(puts.length, 0);
    assert.strictEqual(doCalls.length, 0);
  });
});
