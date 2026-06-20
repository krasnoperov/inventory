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
            if (path === '/internal/collections' && request.method === 'POST') {
              return Response.json({ success: true, collection: body });
            }
            if (/^\/internal\/collections\/[^/]+\/items$/.test(path) && request.method === 'POST') {
              return Response.json({ success: true, item: body });
            }
            if (path === '/internal/relations' && request.method === 'POST') {
              return Response.json({ success: true, relation: body });
            }
            if (path === '/internal/compositions' && request.method === 'POST') {
              return Response.json({ success: true, composition: body });
            }
            if (/^\/internal\/compositions\/[^/]+\/items$/.test(path) && request.method === 'POST') {
              return Response.json({ success: true, item: body });
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

function buildOrganizationImportManifest(): Record<string, any> {
  return {
    version: '1.0',
    exportedAt: '2026-06-16T00:00:00.000Z',
    spaceId: 'source-space',
    spaceName: 'Source',
    assets: [{
      id: 'asset-source',
      name: 'Hero',
      type: 'character',
      mediaKind: 'image',
      tags: [],
      activeVariantId: 'variant-source',
      createdAt: 1,
      variants: [{
        id: 'variant-source',
        assetId: 'asset-source',
        mediaKind: 'image',
        mediaFile: 'images/Hero/variant-source.png',
        imageFile: 'images/Hero/variant-source.png',
        thumbFile: null,
        recipe: { operation: 'generate' },
        createdAt: 2,
      }],
    }],
    lineage: [{
      id: 'lineage-source',
      parentVariantId: 'variant-source',
      childVariantId: 'variant-source',
      relationType: 'derived',
      severed: false,
    }],
    collections: [{ id: 'collection-source', name: 'Opening Kit', description: null, sortIndex: 0 }],
    collectionItems: [{
      id: 'collection-item-source',
      collectionId: 'collection-source',
      subjectType: 'variant',
      assetId: null,
      variantId: 'variant-source',
      role: 'hero',
      pinnedVariantId: null,
      sortIndex: 0,
    }],
    relations: [{
      id: 'relation-source',
      subjectType: 'asset',
      subjectAssetId: 'asset-source',
      subjectVariantId: null,
      objectType: 'variant',
      objectAssetId: null,
      objectVariantId: 'variant-source',
      relationType: 'reference_for',
      label: null,
      context: null,
      metadata: {},
      sortIndex: 0,
    }],
    compositions: [{
      id: 'composition-source',
      name: 'Final Mix',
      description: null,
      status: 'final',
      outputAssetId: 'asset-source',
      outputVariantId: 'variant-source',
      metadata: {},
      sortIndex: 0,
    }],
    compositionItems: [{
      id: 'composition-item-source',
      compositionId: 'composition-source',
      role: 'output',
      label: null,
      assetId: 'asset-source',
      variantId: 'variant-source',
      metadata: {},
      sortIndex: 0,
    }],
  };
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

  it('rejects export when a referenced variant media object is missing', async () => {
    const { app } = buildApp({
      state: {
        assets: [{
          id: 'asset-1',
          name: 'Hero',
          type: 'character',
          media_kind: 'image',
          tags: '[]',
          active_variant_id: 'variant-missing',
          created_at: 1,
        }],
        variants: [
          {
            id: 'variant-present',
            asset_id: 'asset-1',
            media_kind: 'image',
            image_key: 'images/space-1/variant-present.png',
            thumb_key: null,
            media_key: 'images/space-1/variant-present.png',
            media_mime_type: 'image/png',
            media_size_bytes: 10,
            media_width: 100,
            media_height: 100,
            media_duration_ms: null,
            recipe: '{"operation":"generate"}',
            created_at: 2,
          },
          {
            id: 'variant-missing',
            asset_id: 'asset-1',
            media_kind: 'image',
            image_key: 'images/space-1/variant-missing.png',
            thumb_key: null,
            media_key: 'images/space-1/variant-missing.png',
            media_mime_type: 'image/png',
            media_size_bytes: 10,
            media_width: 100,
            media_height: 100,
            media_duration_ms: null,
            recipe: '{"operation":"refine"}',
            created_at: 3,
          },
        ],
        lineage: [{
          id: 'lineage-1',
          parent_variant_id: 'variant-present',
          child_variant_id: 'variant-missing',
          relation_type: 'refined',
          severed: 0,
        }],
        collections: [{ id: 'collection-1', name: 'Opening Kit', description: null, sort_index: 0 }],
        collectionItems: [{
          id: 'collection-item-1',
          collection_id: 'collection-1',
          subject_type: 'variant',
          asset_id: null,
          variant_id: 'variant-missing',
          role: 'hero',
          pinned_variant_id: 'variant-missing',
          sort_index: 0,
        }],
        relations: [{
          id: 'relation-1',
          subject_type: 'asset',
          subject_asset_id: 'asset-1',
          subject_variant_id: null,
          object_type: 'variant',
          object_asset_id: null,
          object_variant_id: 'variant-missing',
          relation_type: 'reference_for',
          label: null,
          context: null,
          metadata: '{}',
          sort_index: 0,
        }],
        compositions: [{
          id: 'composition-1',
          name: 'Final Mix',
          description: null,
          status: 'final',
          output_asset_id: 'asset-1',
          output_variant_id: 'variant-missing',
          metadata: '{}',
          sort_index: 0,
        }],
        compositionItems: [{
          id: 'composition-item-1',
          composition_id: 'composition-1',
          role: 'output',
          label: null,
          asset_id: 'asset-1',
          variant_id: 'variant-missing',
          metadata: '{}',
          sort_index: 0,
        }],
      },
      objects: {
        'images/space-1/variant-present.png': makeObject('images/space-1/variant-present.png', 'present-image', 'image/png'),
      },
    });

    const res = await app.fetch(new Request('https://app.example/api/spaces/space-1/export', {
      headers: { Authorization: 'Bearer test-token' },
    }));

    assert.equal(res.status, 409);
    assert.match(await res.text(), /missing media object for variant variant-missing/);
  });

  it('exports organization records and full variant provenance', async () => {
    const longPrompt = `A production prompt ${'with exact wording '.repeat(20)}model suffix`;
    const { app } = buildApp({
      state: {
        assets: [{
          id: 'asset-1',
          name: 'Hero',
          type: 'character',
          media_kind: 'image',
          tags: '[]',
          active_variant_id: 'variant-2',
          created_at: 1,
        }],
        variants: [
          {
            id: 'variant-1',
            asset_id: 'asset-1',
            media_kind: 'image',
            image_key: 'images/space-1/variant-1.png',
            thumb_key: null,
            media_key: 'images/space-1/variant-1.png',
            media_mime_type: 'image/png',
            media_size_bytes: 10,
            media_width: 100,
            media_height: 100,
            media_duration_ms: null,
            generation_provenance: JSON.stringify({ prompt: longPrompt, model: 'provider-model-id-without-truncation' }),
            provider_metadata: JSON.stringify({ providerRequestId: 'request-id-without-truncation' }),
            recipe: '{"operation":"generate"}',
            created_at: 2,
          },
          {
            id: 'variant-2',
            asset_id: 'asset-1',
            media_kind: 'image',
            image_key: 'images/space-1/variant-2.png',
            thumb_key: null,
            media_key: 'images/space-1/variant-2.png',
            media_mime_type: 'image/png',
            media_size_bytes: 12,
            media_width: 100,
            media_height: 100,
            media_duration_ms: null,
            generation_provenance: JSON.stringify({ prompt: 'child prompt' }),
            provider_metadata: null,
            recipe: '{"operation":"refine"}',
            created_at: 3,
          },
        ],
        lineage: [{
          id: 'lineage-1',
          parent_variant_id: 'variant-1',
          child_variant_id: 'variant-2',
          relation_type: 'refined',
          severed: 1,
        }],
        collections: [{
          id: 'collection-1',
          name: 'Opening Kit',
          description: 'Launch assets',
          sort_index: 4,
        }],
        collectionItems: [{
          id: 'collection-item-1',
          collection_id: 'collection-1',
          subject_type: 'variant',
          asset_id: null,
          variant_id: 'variant-2',
          role: 'hero',
          pinned_variant_id: 'variant-2',
          sort_index: 5,
        }],
        relations: [{
          id: 'relation-1',
          subject_type: 'asset',
          subject_asset_id: 'asset-1',
          subject_variant_id: null,
          object_type: 'variant',
          object_asset_id: null,
          object_variant_id: 'variant-2',
          relation_type: 'reference_for',
          label: 'Paintover source',
          context: '{"label":"paintover"}',
          metadata: '{"confidence":"approved"}',
          sort_index: 6,
        }],
        compositions: [{
          id: 'composition-1',
          name: 'Final Mix',
          description: 'Composite output',
          status: 'final',
          output_asset_id: 'asset-1',
          output_variant_id: 'variant-2',
          metadata: '{"shot":"010"}',
          sort_index: 7,
        }],
        compositionItems: [{
          id: 'composition-item-1',
          composition_id: 'composition-1',
          role: 'output',
          label: 'Final frame',
          asset_id: 'asset-1',
          variant_id: 'variant-2',
          metadata: '{"layer":"final"}',
          sort_index: 8,
        }],
      },
      objects: {
        'images/space-1/variant-1.png': makeObject('images/space-1/variant-1.png', 'parent-image', 'image/png'),
        'images/space-1/variant-2.png': makeObject('images/space-1/variant-2.png', 'child-image', 'image/png'),
      },
    });

    const res = await app.fetch(new Request('https://app.example/api/spaces/space-1/export', {
      headers: { Authorization: 'Bearer test-token' },
    }));

    assert.equal(res.status, 200);
    const unzipped = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(unzipped['manifest.json'])) as any;
    const exportedVariant = manifest.assets[0].variants[0];
    assert.equal(exportedVariant.generation_provenance.prompt, longPrompt);
    assert.equal(exportedVariant.generation_provenance.model, 'provider-model-id-without-truncation');
    assert.equal(exportedVariant.provider_metadata.providerRequestId, 'request-id-without-truncation');
    assert.deepEqual(manifest.lineage[0], {
      id: 'lineage-1',
      parentVariantId: 'variant-1',
      childVariantId: 'variant-2',
      relationType: 'refined',
      severed: true,
    });
    assert.equal(manifest.collections[0].name, 'Opening Kit');
    assert.equal(manifest.collectionItems[0].pinnedVariantId, 'variant-2');
    assert.equal(manifest.relations[0].relationType, 'reference_for');
    assert.equal(manifest.relations[0].label, 'Paintover source');
    assert.deepEqual(manifest.relations[0].metadata, { confidence: 'approved' });
    assert.deepEqual(manifest.compositions[0].metadata, { shot: '010' });
    assert.equal(manifest.compositionItems[0].label, 'Final frame');
    assert.deepEqual(manifest.compositionItems[0].metadata, { layer: 'final' });
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

  it('rejects missing import media before mutating the target space', async () => {
    const manifest = {
      version: '1.0',
      exportedAt: '2026-06-16T00:00:00.000Z',
      spaceId: 'source-space',
      spaceName: 'Source',
      assets: [{
        id: 'asset-source',
        name: 'Hero',
        type: 'character',
        mediaKind: 'image',
        tags: [],
        activeVariantId: 'variant-missing',
        createdAt: 1,
        variants: [
          {
            id: 'variant-present',
            assetId: 'asset-source',
            mediaKind: 'image',
            mediaFile: 'images/Hero/variant-present.png',
            imageFile: 'images/Hero/variant-present.png',
            thumbFile: null,
            recipe: { operation: 'generate' },
            createdAt: 2,
          },
          {
            id: 'variant-missing',
            assetId: 'asset-source',
            mediaKind: 'image',
            mediaFile: 'images/Hero/variant-missing.png',
            imageFile: 'images/Hero/variant-missing.png',
            thumbFile: null,
            recipe: { operation: 'refine' },
            createdAt: 3,
          },
        ],
      }],
      lineage: [{
        id: 'lineage-source',
        parentVariantId: 'variant-present',
        childVariantId: 'variant-missing',
        relationType: 'refined',
        severed: false,
      }],
      collections: [{ id: 'collection-source', name: 'Opening Kit', description: null, sortIndex: 0 }],
      collectionItems: [{
        id: 'collection-item-source',
        collectionId: 'collection-source',
        subjectType: 'variant',
        assetId: null,
        variantId: 'variant-missing',
        role: 'hero',
        pinnedVariantId: 'variant-missing',
        sortIndex: 0,
      }],
      relations: [{
        id: 'relation-source',
        subjectType: 'asset',
        subjectAssetId: 'asset-source',
        subjectVariantId: null,
        objectType: 'variant',
        objectAssetId: null,
        objectVariantId: 'variant-missing',
        relationType: 'reference_for',
        label: null,
        context: null,
        metadata: {},
        sortIndex: 0,
      }],
      compositions: [{
        id: 'composition-source',
        name: 'Final Mix',
        description: null,
        status: 'final',
        outputAssetId: 'asset-source',
        outputVariantId: 'variant-missing',
        metadata: {},
        sortIndex: 0,
      }],
      compositionItems: [{
        id: 'composition-item-source',
        compositionId: 'composition-source',
        role: 'output',
        label: null,
        assetId: 'asset-source',
        variantId: 'variant-missing',
        metadata: {},
        sortIndex: 0,
      }],
    };
    const zip = zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'images/Hero/variant-present.png': strToU8('present-image'),
    });
    const formData = new FormData();
    formData.set('file', new File([zip], 'export.zip', { type: 'application/zip' }));
    const { app, puts, doCalls } = buildApp();

    const res = await app.fetch(new Request('https://app.example/api/spaces/space-1/import', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
      body: formData,
    }));

    assert.equal(res.status, 400);
    assert.match(await res.text(), /missing media for variant variant-missing/);
    assert.equal(doCalls.length, 0);
    assert.equal(puts.length, 0);
  });

  it('rejects invalid organization vocabulary before mutating the target space', async () => {
    const cases: Array<{
      name: string;
      mutate: (manifest: Record<string, any>) => void;
      expected: RegExp;
    }> = [
      {
        name: 'lineage relation type',
        mutate: (manifest) => { manifest.lineage[0].relationType = 'bogus'; },
        expected: /Lineage relationType must be derived, refined, or forked/,
      },
      {
        name: 'collection item subject type',
        mutate: (manifest) => { manifest.collectionItems[0].subjectType = 'bogus'; },
        expected: /Collection item collection-item-source subjectType must be asset or variant/,
      },
      {
        name: 'manual relation subject type',
        mutate: (manifest) => { manifest.relations[0].subjectType = 'bogus'; },
        expected: /Relation relation-source subject subjectType must be asset or variant/,
      },
      {
        name: 'manual relation type',
        mutate: (manifest) => { manifest.relations[0].relationType = 'bogus'; },
        expected: /Relation relation-source relationType is invalid/,
      },
      {
        name: 'composition status',
        mutate: (manifest) => { manifest.compositions[0].status = 'published'; },
        expected: /Composition composition-source status must be draft or final/,
      },
      {
        name: 'composition item role',
        mutate: (manifest) => { manifest.compositionItems[0].role = 'bogus'; },
        expected: /Composition item composition-item-source role is invalid/,
      },
    ];

    for (const testCase of cases) {
      const manifest = buildOrganizationImportManifest();
      testCase.mutate(manifest);
      const zip = zipSync({
        'manifest.json': strToU8(JSON.stringify(manifest)),
        'images/Hero/variant-source.png': strToU8('source-image'),
      });
      const formData = new FormData();
      formData.set('file', new File([zip], 'export.zip', { type: 'application/zip' }));
      const { app, puts, doCalls } = buildApp();

      const res = await app.fetch(new Request('https://app.example/api/spaces/space-1/import', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-token' },
        body: formData,
      }));

      assert.equal(res.status, 400, testCase.name);
      assert.match(await res.text(), testCase.expected, testCase.name);
      assert.equal(doCalls.length, 0, testCase.name);
      assert.equal(puts.length, 0, testCase.name);
    }
  });

  it('imports organization records with remapped relation, composition, and severed lineage IDs', async () => {
    const manifest = {
      version: '1.0',
      exportedAt: '2026-06-16T00:00:00.000Z',
      spaceId: 'source-space',
      spaceName: 'Source',
      assets: [{
        id: 'asset-source',
        name: 'Hero',
        type: 'character',
        mediaKind: 'image',
        tags: [],
        activeVariantId: 'variant-child',
        createdAt: 1,
        variants: [
          {
            id: 'variant-parent',
            assetId: 'asset-source',
            mediaKind: 'image',
            mediaFile: 'images/Hero/variant-parent.png',
            imageFile: 'images/Hero/variant-parent.png',
            thumbFile: null,
            recipe: { operation: 'generate', prompt: 'parent' },
            generation_provenance: { prompt: 'parent prompt', model: 'model-parent' },
            provider_metadata: { providerRequestId: 'request-parent' },
            createdAt: 2,
          },
          {
            id: 'variant-child',
            assetId: 'asset-source',
            mediaKind: 'image',
            mediaFile: 'images/Hero/variant-child.png',
            imageFile: 'images/Hero/variant-child.png',
            thumbFile: null,
            recipe: { operation: 'refine', prompt: 'child' },
            generation_provenance: { prompt: 'child prompt', model: 'model-child' },
            provider_metadata: { providerRequestId: 'request-child' },
            createdAt: 3,
          },
        ],
      }],
      lineage: [{
        id: 'lineage-source',
        parentVariantId: 'variant-parent',
        childVariantId: 'variant-child',
        relationType: 'refined',
        severed: true,
      }],
      collections: [{
        id: 'collection-source',
        name: 'Opening Kit',
        description: 'Launch assets',
        sortIndex: 1,
      }],
      collectionItems: [{
        id: 'collection-item-source',
        collectionId: 'collection-source',
        subjectType: 'variant',
        assetId: null,
        variantId: 'variant-child',
        role: 'hero',
        pinnedVariantId: 'variant-child',
        sortIndex: 2,
      }],
      relations: [{
        id: 'relation-source',
        subjectType: 'asset',
        subjectAssetId: 'asset-source',
        subjectVariantId: null,
        objectType: 'variant',
        objectAssetId: null,
        objectVariantId: 'variant-child',
        relationType: 'reference_for',
        label: 'Paintover source',
        context: '{"label":"paintover"}',
        metadata: { confidence: 'approved' },
        sortIndex: 3,
      }],
      compositions: [{
        id: 'composition-source',
        name: 'Final Mix',
        description: 'Composite output',
        status: 'final',
        outputAssetId: 'asset-source',
        outputVariantId: 'variant-child',
        metadata: { shot: '010' },
        sortIndex: 4,
      }],
      compositionItems: [{
        id: 'composition-item-source',
        compositionId: 'composition-source',
        role: 'output',
        label: 'Final frame',
        assetId: 'asset-source',
        variantId: 'variant-child',
        metadata: { layer: 'final' },
        sortIndex: 5,
      }],
    };
    const zip = zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'images/Hero/variant-parent.png': strToU8('parent-image'),
      'images/Hero/variant-child.png': strToU8('child-image'),
    });
    const formData = new FormData();
    formData.set('file', new File([zip], 'export.zip', { type: 'application/zip' }));
    const { app, doCalls } = buildApp();

    const res = await app.fetch(new Request('https://app.example/api/spaces/space-1/import', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
      body: formData,
    }));

    assert.equal(res.status, 200);
    const body = await res.json() as { imported: Record<string, number> };
    assert.deepEqual(body.imported, {
      assets: 1,
      variants: 2,
      lineage: 1,
      collections: 1,
      collectionItems: 1,
      relations: 1,
      compositions: 1,
      compositionItems: 1,
    });

    const assetId = doCalls.find((call) => call.path === '/internal/create-asset')!.body!.id;
    const applyCalls = doCalls.filter((call) => call.path === '/internal/apply-variant');
    const parentVariantId = applyCalls[0].body!.variantId;
    const childVariantId = applyCalls[1].body!.variantId;
    assert.notEqual(assetId, 'asset-source');
    assert.notEqual(parentVariantId, 'variant-parent');
    assert.notEqual(childVariantId, 'variant-child');
    assert.deepEqual(applyCalls[1].body!.generationProvenance, { prompt: 'child prompt', model: 'model-child' });
    assert.deepEqual(applyCalls[1].body!.providerMetadata, { providerRequestId: 'request-child' });

    const lineageCall = doCalls.find((call) => call.path === '/internal/add-lineage')!;
    assert.deepEqual(lineageCall.body, {
      parentVariantId,
      childVariantId,
      relationType: 'refined',
      severed: true,
    });

    const collectionItemCall = doCalls.find((call) => /^\/internal\/collections\/[^/]+\/items$/.test(call.path))!;
    assert.equal(collectionItemCall.body!.variantId, childVariantId);
    assert.equal(collectionItemCall.body!.pinnedVariantId, childVariantId);
    assert.equal(collectionItemCall.body!.role, 'hero');

    const relationCall = doCalls.find((call) => call.path === '/internal/relations')!;
    assert.deepEqual(relationCall.body!.subject, { subjectType: 'asset', assetId });
    assert.deepEqual(relationCall.body!.object, { subjectType: 'variant', variantId: childVariantId });
    assert.equal(relationCall.body!.relationType, 'reference_for');
    assert.equal(relationCall.body!.label, 'Paintover source');
    assert.equal(relationCall.body!.context, '{"label":"paintover"}');
    assert.deepEqual(relationCall.body!.metadata, { confidence: 'approved' });

    const compositionCall = doCalls.find((call) => call.path === '/internal/compositions')!;
    assert.equal(compositionCall.body!.outputAssetId, assetId);
    assert.equal(compositionCall.body!.outputVariantId, childVariantId);
    assert.deepEqual(compositionCall.body!.metadata, { shot: '010' });

    const compositionItemCall = doCalls.find((call) => /^\/internal\/compositions\/[^/]+\/items$/.test(call.path))!;
    assert.equal(compositionItemCall.body!.assetId, assetId);
    assert.equal(compositionItemCall.body!.variantId, childVariantId);
    assert.equal(compositionItemCall.body!.role, 'output');
    assert.equal(compositionItemCall.body!.label, 'Final frame');
    assert.deepEqual(compositionItemCall.body!.metadata, { layer: 'final' });
  });

  it('rejects organization records that reference unknown variants', async () => {
    const manifest = {
      version: '1.0',
      exportedAt: '2026-06-16T00:00:00.000Z',
      spaceId: 'source-space',
      spaceName: 'Source',
      assets: [],
      lineage: [],
      collections: [{ id: 'collection-1', name: 'Broken', description: null, sortIndex: 0 }],
      collectionItems: [{
        id: 'item-1',
        collectionId: 'collection-1',
        subjectType: 'variant',
        assetId: null,
        variantId: 'missing-variant',
        role: 'custom',
        pinnedVariantId: null,
        sortIndex: 0,
      }],
    };
    const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)) });
    const formData = new FormData();
    formData.set('file', new File([zip], 'export.zip', { type: 'application/zip' }));
    const { app, doCalls } = buildApp();

    const res = await app.fetch(new Request('https://app.example/api/spaces/space-1/import', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
      body: formData,
    }));

    assert.equal(res.status, 400);
    assert.match(await res.text(), /unknown variant: missing-variant/);
    assert.equal(doCalls.filter((call) => call.path !== '/internal/state').length, 0);
  });
});
