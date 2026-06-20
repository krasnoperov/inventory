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

function buildApp(options: {
  role?: 'owner' | 'editor' | 'viewer' | null;
  completeUploadErrorForParent?: string;
} = {}) {
  const app = new Hono<AppContext>();
  const puts: PutCall[] = [];
  const deletes: string[] = [];
  const doCalls: DoCall[] = [];
  const stored = new Map<string, { body: Uint8Array; contentType?: string }>();
  const placeholders = new Map<string, Record<string, unknown>>();

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
              placeholders.set(String(body.variantId), body);
              const assetId = String(body.assetId ?? 'asset-new');
              const mediaKind = body.mediaKind === 'image' || body.mediaKind === 'audio' || body.mediaKind === 'video'
                ? body.mediaKind
                : 'image';

              return Response.json({
                variant: {
                  id: body.variantId,
                  asset_id: assetId,
                  media_kind: mediaKind,
                  workflow_id: null,
                  status: 'uploading',
                  error_message: null,
                  image_key: null,
                  thumb_key: null,
                  media_key: null,
                  media_mime_type: null,
                  media_size_bytes: null,
                  media_width: null,
                  media_height: null,
                  media_duration_ms: null,
                  transcript_key: null,
                  transcript_mime_type: null,
                  transcript_size_bytes: null,
                  word_timings_key: null,
                  word_timings_mime_type: null,
                  word_timings_size_bytes: null,
                  render_metadata_key: null,
                  render_metadata_mime_type: null,
                  render_metadata_size_bytes: null,
                  recipe: String(body.recipe ?? '{}'),
                  starred: false,
                  created_by: '7',
                  created_at: 1_780_000_000_000,
                  updated_at: 1_780_000_000_000,
                },
                asset: body.assetName ? {
                  id: assetId,
                  name: String(body.assetName),
                  type: String(body.assetType ?? 'character'),
                  media_kind: mediaKind,
                  tags: '[]',
                  parent_asset_id: null,
                  active_variant_id: null,
                  created_by: '7',
                  created_at: 1_780_000_000_000,
                  updated_at: 1_780_000_000_000,
                } : undefined,
                assetId,
              });
            }

            if (path === '/internal/complete-upload') {
              const placeholder = placeholders.get(String(body.variantId)) ?? {};
              const mediaKind = placeholder.mediaKind === 'image' || placeholder.mediaKind === 'audio' || placeholder.mediaKind === 'video'
                ? placeholder.mediaKind
                : 'image';
              const lineageInputs = Array.isArray(body.lineage)
                ? body.lineage as Array<{ parentVariantId?: string; relationType?: string }>
                : [];
              if (
                options.completeUploadErrorForParent &&
                lineageInputs.some((lineage) => lineage.parentVariantId === options.completeUploadErrorForParent)
              ) {
                return Response.json({ error: 'Lineage parent variant not found' }, { status: 404 });
              }

              return Response.json({
                variant: {
                  id: body.variantId,
                  asset_id: String(placeholder.assetId ?? 'asset-new'),
                  media_kind: mediaKind,
                  workflow_id: null,
                  status: 'completed',
                  error_message: null,
                  image_key: body.imageKey,
                  thumb_key: body.thumbKey,
                  media_key: body.mediaKey,
                  media_mime_type: body.mediaMimeType,
                  media_size_bytes: body.mediaSizeBytes,
                  media_width: body.mediaWidth,
                  media_height: body.mediaHeight,
                  media_duration_ms: body.mediaDurationMs,
                  transcript_key: body.transcriptKey,
                  transcript_mime_type: body.transcriptMimeType,
                  transcript_size_bytes: body.transcriptSizeBytes,
                  word_timings_key: body.wordTimingsKey,
                  word_timings_mime_type: body.wordTimingsMimeType,
                  word_timings_size_bytes: body.wordTimingsSizeBytes,
                  render_metadata_key: body.renderMetadataKey,
                  render_metadata_mime_type: body.renderMetadataMimeType,
                  render_metadata_size_bytes: body.renderMetadataSizeBytes,
                  recipe: String(placeholder.recipe ?? '{}'),
                  starred: false,
                  created_by: '7',
                  created_at: 1_780_000_000_000,
                  updated_at: 1_780_000_000_000,
                },
                lineage: lineageInputs.map((lineage, index) => ({
                  id: `lineage-${index + 1}`,
                  parent_variant_id: lineage.parentVariantId,
                  child_variant_id: body.variantId,
                  relation_type: lineage.relationType,
                  severed: false,
                  created_at: 1_780_000_000_000,
                })),
              });
            }

            if (path === '/internal/fail-upload') {
              return Response.json({ variant: { id: body.variantId, status: 'failed' } });
            }

            if (path === '/internal/add-lineage') {
              return Response.json({
                success: true,
                lineage: {
                  id: `lineage-${doCalls.filter((call) => call.path === '/internal/add-lineage').length}`,
                  parent_variant_id: body.parentVariantId,
                  child_variant_id: body.childVariantId,
                  relation_type: body.relationType,
                  severed: false,
                  created_at: 1_780_000_000_000,
                },
              });
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

function oversizedUploadRequest(path: string): Request {
  return new Request(`https://app.example${path}`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Length': String(18 * 1024 * 1024),
    },
    body: '',
  });
}

function oversizedUploadRequestWithoutLength(path: string): Request {
  return new Request(`https://app.example${path}`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'multipart/form-data; boundary=test',
    },
    body: new Uint8Array(18 * 1024 * 1024),
  });
}

function invalidLengthUploadRequest(path: string): Request {
  return new Request(`https://app.example${path}`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Length': 'not-a-number',
    },
    body: '',
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

  it('stores import provenance, provider metadata, active behavior, and lineage', async () => {
    const { app, doCalls } = buildApp();
    const formData = new FormData();
    formData.append('file', new File([new Uint8Array([1, 2, 3])], 'hero.png', { type: 'image/png' }));
    formData.append('assetName', 'Hero');
    formData.append('assetType', 'character');
    formData.append('operation', 'import');
    formData.append('prompt', 'hero prompt');
    formData.append('model', 'external-model-1');
    formData.append('provider', 'external-provider');
    formData.append('providerMetadata', JSON.stringify({ seed: 42 }));
    formData.append('generationProvenance', JSON.stringify({ workflow: 'local-tool' }));
    formData.append('activeVariantBehavior', 'set-active');
    formData.append('lineage', JSON.stringify([
      { parentVariantId: 'variant-source', relationType: 'derived' },
    ]));

    const res = await app.fetch(uploadRequest('space-1', formData));
    const body = await res.json() as { success: boolean; lineage: Array<{ id: string }> };

    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.success, true);
    assert.deepStrictEqual(body.lineage.map((lineage) => lineage.id), ['lineage-1']);

    const placeholder = doCalls.find((call) => call.path === '/internal/upload-placeholder');
    assert.ok(placeholder);
    const recipe = JSON.parse(String(placeholder.body.recipe)) as Record<string, unknown>;
    assert.strictEqual(recipe.operation, 'import');
    assert.strictEqual(recipe.prompt, 'hero prompt');
    assert.strictEqual(recipe.model, 'external-model-1');
    assert.strictEqual(recipe.modelProvider, 'external-provider');
    assert.strictEqual(recipe.workflow, 'local-tool');
    assert.deepStrictEqual(recipe.parentVariantIds, ['variant-source']);

    const complete = doCalls.find((call) => call.path === '/internal/complete-upload');
    assert.ok(complete);
    assert.deepStrictEqual(complete.body.providerMetadata, { seed: 42 });
    assert.strictEqual(complete.body.activeVariantBehavior, 'set_active');
    assert.deepStrictEqual(complete.body.lineage, [
      { parentVariantId: 'variant-source', relationType: 'derived' },
    ]);

    assert.strictEqual(doCalls.some((call) => call.path === '/internal/add-lineage'), false);
  });

  it('rejects lineage on non-import uploads before creating placeholders', async () => {
    const { app, puts, doCalls } = buildApp();
    const formData = new FormData();
    formData.append('file', new File([new Uint8Array([1, 2, 3])], 'hero.png', { type: 'image/png' }));
    formData.append('assetName', 'Hero');
    formData.append('lineage', JSON.stringify([
      { parentVariantId: 'variant-source', relationType: 'derived' },
    ]));

    const res = await app.fetch(uploadRequest('space-1', formData));
    const body = await res.json() as { error: string };

    assert.strictEqual(res.status, 400);
    assert.match(body.error, /operation=import/);
    assert.strictEqual(puts.length, 0);
    assert.strictEqual(doCalls.length, 0);
  });

  it('fails and cleans uploaded bytes when import lineage parent is missing at completion', async () => {
    const { app, puts, deletes, doCalls } = buildApp({
      completeUploadErrorForParent: 'deleted-source',
    });
    const formData = new FormData();
    formData.append('file', new File([new Uint8Array([1, 2, 3])], 'hero.png', { type: 'image/png' }));
    formData.append('assetName', 'Hero');
    formData.append('operation', 'import');
    formData.append('lineage', JSON.stringify([
      { parentVariantId: 'deleted-source', relationType: 'derived' },
    ]));

    const res = await app.fetch(uploadRequest('space-1', formData));
    const body = await res.json() as { error: string };

    assert.strictEqual(res.status, 404);
    assert.match(body.error, /Lineage parent variant not found/);
    assert.ok(puts.length >= 1);
    assert.ok(deletes.includes(puts[0].key));

    const complete = doCalls.find((call) => call.path === '/internal/complete-upload');
    assert.ok(complete);
    assert.deepStrictEqual(complete.body.lineage, [
      { parentVariantId: 'deleted-source', relationType: 'derived' },
    ]);
    const fail = doCalls.find((call) => call.path === '/internal/fail-upload');
    assert.ok(fail);
    assert.strictEqual(fail.body.variantId, complete.body.variantId);
    assert.strictEqual(doCalls.some((call) => call.path === '/internal/add-lineage'), false);
  });

  it('uploads audio transcript, word timings, and render metadata sidecars', async () => {
    const { app, puts, doCalls } = buildApp();
    const formData = new FormData();
    formData.append('file', new File([new Uint8Array([9, 8])], 'theme.mp3', { type: 'audio/mpeg' }));
    formData.append('assetId', 'asset-audio');
    formData.append('transcript', new File(['hello world'], 'transcript.txt', { type: 'text/plain' }));
    formData.append('wordTimings', new File(['[{"word":"hello","start":0}]'], 'words.json', { type: 'application/json' }));
    formData.append('renderMetadata', new File(['{"engine":"test"}'], 'render.json', { type: 'application/json' }));

    const res = await app.fetch(uploadRequest('space-1', formData));
    const body = await res.json() as {
      success: boolean;
      variant: {
        transcript_key: string;
        word_timings_key: string;
        render_metadata_key: string;
      };
    };

    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(puts.length, 4);
    assert.match(puts[1].key, /^sidecars\/space-1\/.+\/transcript\.txt$/);
    assert.strictEqual(puts[1].contentType, 'text/plain');
    assert.match(puts[2].key, /^sidecars\/space-1\/.+\/word_timings\.json$/);
    assert.strictEqual(puts[2].contentType, 'application/json');
    assert.match(puts[3].key, /^sidecars\/space-1\/.+\/render_metadata\.json$/);
    assert.strictEqual(puts[3].contentType, 'application/json');

    const placeholder = doCalls.find((call) => call.path === '/internal/upload-placeholder');
    assert.ok(placeholder);
    const recipe = JSON.parse(String(placeholder.body.recipe)) as { sidecars: Array<{ kind: string; key: string }> };
    assert.deepStrictEqual(recipe.sidecars.map((sidecar) => sidecar.kind), [
      'transcript',
      'wordTimings',
      'renderMetadata',
    ]);

    const complete = doCalls.find((call) => call.path === '/internal/complete-upload');
    assert.ok(complete);
    assert.strictEqual(complete.body.transcriptKey, puts[1].key);
    assert.strictEqual(complete.body.transcriptMimeType, 'text/plain');
    assert.strictEqual(complete.body.transcriptSizeBytes, 11);
    assert.strictEqual(complete.body.wordTimingsKey, puts[2].key);
    assert.strictEqual(complete.body.wordTimingsMimeType, 'application/json');
    assert.strictEqual(complete.body.renderMetadataKey, puts[3].key);
    assert.strictEqual(complete.body.renderMetadataMimeType, 'application/json');
    assert.strictEqual(body.variant.transcript_key, puts[1].key);
    assert.strictEqual(body.variant.word_timings_key, puts[2].key);
    assert.strictEqual(body.variant.render_metadata_key, puts[3].key);
  });

  it('rejects sidecar files on non-audio uploads', async () => {
    const { app, puts, doCalls } = buildApp();
    const formData = new FormData();
    formData.append('file', new File([new Uint8Array([1, 2, 3])], 'clip.mp4', { type: 'video/mp4' }));
    formData.append('assetName', 'Combat Clip');
    formData.append('transcript', new File(['hello'], 'transcript.txt', { type: 'text/plain' }));

    const res = await app.fetch(uploadRequest('space-1', formData));
    const body = await res.json() as { error: string };

    assert.strictEqual(res.status, 400);
    assert.match(body.error, /Audio sidecars/);
    assert.strictEqual(puts.length, 0);
    assert.strictEqual(doCalls.length, 0);
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

  it('rejects oversized upload bodies before parsing form data', async () => {
    const { app, puts, doCalls } = buildApp();

    const res = await app.fetch(oversizedUploadRequest('/api/spaces/space-1/upload'));
    const body = await res.json() as { error: string };

    assert.strictEqual(res.status, 413);
    assert.match(body.error, /10MB plus up to 3 sidecars of 2MB each/);
    assert.strictEqual(puts.length, 0);
    assert.strictEqual(doCalls.length, 0);
  });

  it('rejects oversized upload bodies without relying on Content-Length', async () => {
    const { app, puts, doCalls } = buildApp();

    const res = await app.fetch(oversizedUploadRequestWithoutLength('/api/spaces/space-1/upload'));
    const body = await res.json() as { error: string };

    assert.strictEqual(res.status, 413);
    assert.match(body.error, /10MB plus up to 3 sidecars of 2MB each/);
    assert.strictEqual(puts.length, 0);
    assert.strictEqual(doCalls.length, 0);
  });

  it('rejects invalid Content-Length upload headers before parsing form data', async () => {
    const { app, puts, doCalls } = buildApp();

    const res = await app.fetch(invalidLengthUploadRequest('/api/spaces/space-1/upload'));
    const body = await res.json() as { error: string };

    assert.strictEqual(res.status, 400);
    assert.match(body.error, /Invalid Content-Length/);
    assert.strictEqual(puts.length, 0);
    assert.strictEqual(doCalls.length, 0);
  });

});
