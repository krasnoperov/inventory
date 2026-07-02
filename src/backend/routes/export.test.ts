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
            if (path === '/internal/style-presets' && request.method === 'POST') {
              return Response.json({ success: true, preset: body });
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
  };
}

function addSecondAsset(manifest: Record<string, any>): void {
  manifest.assets.push({
    id: 'asset-other',
    name: 'Other',
    type: 'prop',
    mediaKind: 'image',
    tags: [],
    activeVariantId: 'variant-other',
    createdAt: 3,
    variants: [{
      id: 'variant-other',
      assetId: 'asset-other',
      mediaKind: 'image',
      mediaFile: 'images/Other/variant-other.png',
      imageFile: 'images/Other/variant-other.png',
      thumbFile: null,
      recipe: { operation: 'generate' },
      createdAt: 4,
    }],
  });
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

  it('skips in-progress placeholder variants while exporting completed content', async () => {
    const { app } = buildApp({
      state: {
        assets: [
          {
            id: 'asset-1',
            name: 'Hero',
            type: 'character',
            media_kind: 'image',
            tags: '[]',
            active_variant_id: 'variant-pending',
            created_at: 1,
          },
          {
            id: 'asset-pending-only',
            name: 'Sketch',
            type: 'prop',
            media_kind: 'image',
            tags: '[]',
            active_variant_id: 'variant-only-pending',
            created_at: 4,
          },
        ],
        variants: [
          {
            id: 'variant-complete',
            asset_id: 'asset-1',
            media_kind: 'image',
            status: 'completed',
            image_key: 'images/space-1/variant-complete.png',
            thumb_key: null,
            media_key: 'images/space-1/variant-complete.png',
            media_mime_type: 'image/png',
            media_size_bytes: 10,
            media_width: 100,
            media_height: 100,
            media_duration_ms: null,
            recipe: '{"operation":"generate"}',
            created_at: 2,
          },
          {
            id: 'variant-pending',
            asset_id: 'asset-1',
            media_kind: 'image',
            status: 'pending',
            image_key: null,
            thumb_key: null,
            media_key: null,
            media_mime_type: null,
            media_size_bytes: null,
            media_width: null,
            media_height: null,
            media_duration_ms: null,
            recipe: '{"operation":"refine"}',
            created_at: 3,
          },
          {
            id: 'variant-only-pending',
            asset_id: 'asset-pending-only',
            media_kind: 'image',
            status: 'uploading',
            image_key: null,
            thumb_key: null,
            media_key: null,
            media_mime_type: null,
            media_size_bytes: null,
            media_width: null,
            media_height: null,
            media_duration_ms: null,
            recipe: '{"operation":"upload"}',
            created_at: 5,
          },
        ],
        lineage: [{
          id: 'lineage-pending',
          parent_variant_id: 'variant-complete',
          child_variant_id: 'variant-pending',
          relation_type: 'refined',
          severed: 0,
        }],
        collections: [{ id: 'collection-1', name: 'Opening Kit', description: null, sort_index: 0 }],
        collectionItems: [
          {
            id: 'collection-item-pending',
            collection_id: 'collection-1',
            subject_type: 'variant',
            asset_id: null,
            variant_id: 'variant-pending',
            role: 'hero',
            pinned_variant_id: null,
            sort_index: 0,
          },
          {
            id: 'collection-item-asset',
            collection_id: 'collection-1',
            subject_type: 'asset',
            asset_id: 'asset-1',
            variant_id: null,
            role: 'asset',
            pinned_variant_id: 'variant-pending',
            sort_index: 1,
          },
        ],
        relations: [{
          id: 'relation-pending',
          subject_type: 'asset',
          subject_asset_id: 'asset-1',
          subject_variant_id: null,
          object_type: 'variant',
          object_asset_id: null,
          object_variant_id: 'variant-pending',
          relation_type: 'reference_for',
          label: null,
          context: null,
          metadata: '{}',
          sort_index: 0,
        }],
      },
      objects: {
        'images/space-1/variant-complete.png': makeObject('images/space-1/variant-complete.png', 'complete-image', 'image/png'),
      },
    });

    const res = await app.fetch(new Request('https://app.example/api/spaces/space-1/export', {
      headers: { Authorization: 'Bearer test-token' },
    }));

    assert.equal(res.status, 200);
    const unzipped = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(unzipped['manifest.json'])) as any;
    assert.deepEqual(manifest.assets.map((asset: { id: string }) => asset.id), ['asset-1']);
    assert.deepEqual(manifest.assets[0].variants.map((variant: { id: string }) => variant.id), ['variant-complete']);
    assert.equal(manifest.assets[0].activeVariantId, null);
    assert.deepEqual(manifest.lineage, []);
    assert.deepEqual(manifest.collectionItems.map((item: { id: string }) => item.id), ['collection-item-asset']);
    assert.equal(manifest.collectionItems[0].pinnedVariantId, null);
    assert.equal('relations' in manifest, false);
    assert.equal('compositions' in manifest, false);
    assert.equal('compositionItems' in manifest, false);
    assert.equal(strFromU8(unzipped[manifest.assets[0].variants[0].mediaFile]), 'complete-image');
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
    assert.equal('relations' in manifest, false);
    assert.equal('compositions' in manifest, false);
    assert.equal('compositionItems' in manifest, false);
  });

  it('round-trips asset-backed style presets and exact style provenance', async () => {
    const styleRecipe = {
      operation: 'generate',
      prompt: '[Style: Painterly adventure game] A market stall',
      stylePresetId: 'preset-style',
      styleCollectionId: 'collection-style',
      styleReferenceVariantIds: ['variant-style-a', 'variant-style-b'],
      styleReferenceImageKeys: ['images/source/style-a.png', 'images/source/style-b.png'],
      styleImageKeys: ['images/source/style-a.png', 'images/source/style-b.png'],
      sourceImageKeys: ['images/source/style-a.png', 'images/source/style-b.png'],
    };
    const { app: exportApp } = buildApp({
      state: {
        assets: [
          {
            id: 'asset-style',
            name: 'Style Sheet',
            type: 'style-sheet',
            media_kind: 'image',
            tags: '["style"]',
            active_variant_id: 'variant-style-b',
            created_at: 1,
          },
          {
            id: 'asset-output',
            name: 'Market Stall',
            type: 'prop',
            media_kind: 'image',
            tags: '[]',
            active_variant_id: 'variant-output',
            created_at: 4,
          },
        ],
        variants: [
          {
            id: 'variant-style-a',
            asset_id: 'asset-style',
            media_kind: 'image',
            status: 'completed',
            image_key: 'images/source/style-a.png',
            thumb_key: null,
            media_key: 'images/source/style-a.png',
            media_mime_type: 'image/png',
            media_size_bytes: 7,
            media_width: 64,
            media_height: 64,
            media_duration_ms: null,
            recipe: '{"operation":"upload"}',
            created_at: 2,
          },
          {
            id: 'variant-style-b',
            asset_id: 'asset-style',
            media_kind: 'image',
            status: 'completed',
            image_key: 'images/source/style-b.png',
            thumb_key: null,
            media_key: 'images/source/style-b.png',
            media_mime_type: 'image/png',
            media_size_bytes: 7,
            media_width: 64,
            media_height: 64,
            media_duration_ms: null,
            recipe: '{"operation":"upload"}',
            created_at: 3,
          },
          {
            id: 'variant-output',
            asset_id: 'asset-output',
            media_kind: 'image',
            status: 'completed',
            image_key: 'images/source/output.png',
            thumb_key: null,
            media_key: 'images/source/output.png',
            media_mime_type: 'image/png',
            media_size_bytes: 7,
            media_width: 256,
            media_height: 256,
            media_duration_ms: null,
            generation_provenance: JSON.stringify({
              ...styleRecipe,
              model: 'gemini-3-pro-image-preview',
            }),
            provider_metadata: null,
            recipe: JSON.stringify(styleRecipe),
            created_at: 5,
          },
        ],
        lineage: [],
        collections: [{ id: 'collection-style', name: 'House Style', description: 'Reusable style refs', sort_index: 0 }],
        collectionItems: [
          {
            id: 'item-style-a',
            collection_id: 'collection-style',
            subject_type: 'variant',
            asset_id: null,
            variant_id: 'variant-style-a',
            role: 'style_ref',
            pinned_variant_id: null,
            sort_index: 0,
          },
          {
            id: 'item-style-b',
            collection_id: 'collection-style',
            subject_type: 'variant',
            asset_id: null,
            variant_id: 'variant-style-b',
            role: 'style_ref',
            pinned_variant_id: null,
            sort_index: 1,
          },
        ],
        relations: [
          {
            id: 'relation-style-a',
            subject_type: 'variant',
            subject_asset_id: null,
            subject_variant_id: 'variant-style-a',
            object_type: 'variant',
            object_asset_id: null,
            object_variant_id: 'variant-output',
            relation_type: 'style_reference_for',
            label: null,
            context: JSON.stringify({
              role: 'style_reference',
              stylePresetId: 'preset-style',
              styleCollectionId: 'collection-style',
              styleImageKey: 'images/source/style-a.png',
            }),
            metadata: JSON.stringify({ styleReferenceVariantIds: ['variant-style-a', 'variant-style-b'] }),
            sort_index: 0,
          },
          {
            id: 'relation-style-b',
            subject_type: 'variant',
            subject_asset_id: null,
            subject_variant_id: 'variant-style-b',
            object_type: 'variant',
            object_asset_id: null,
            object_variant_id: 'variant-output',
            relation_type: 'style_reference_for',
            label: null,
            context: JSON.stringify({
              role: 'style_reference',
              stylePresetId: 'preset-style',
              styleCollectionId: 'collection-style',
              styleImageKey: 'images/source/style-b.png',
            }),
            metadata: '{}',
            sort_index: 1,
          },
        ],
        stylePresets: [{
          id: 'preset-style',
          name: 'Painterly House Style',
          description: 'Production paint style',
          style_prompt: 'Painterly adventure game',
          collection_id: 'collection-style',
          enabled: 1,
          is_default: 1,
        }],
      },
      objects: {
        'images/source/style-a.png': makeObject('images/source/style-a.png', 'style-a', 'image/png'),
        'images/source/style-b.png': makeObject('images/source/style-b.png', 'style-b', 'image/png'),
        'images/source/output.png': makeObject('images/source/output.png', 'output', 'image/png'),
      },
    });

    const exportRes = await exportApp.fetch(new Request('https://app.example/api/spaces/source-space/export', {
      headers: { Authorization: 'Bearer test-token' },
    }));

    assert.equal(exportRes.status, 200);
    const zipBytes = new Uint8Array(await exportRes.arrayBuffer());
    const unzipped = unzipSync(zipBytes);
    const manifest = JSON.parse(strFromU8(unzipped['manifest.json'])) as any;
    assert.deepEqual(manifest.stylePresets, [{
      id: 'preset-style',
      name: 'Painterly House Style',
      description: 'Production paint style',
      stylePrompt: 'Painterly adventure game',
      collectionId: 'collection-style',
      enabled: true,
      isDefault: true,
    }]);
    assert.deepEqual(
      manifest.collectionItems.map((item: { variantId: string; role: string }) => [item.variantId, item.role]),
      [['variant-style-a', 'style_ref'], ['variant-style-b', 'style_ref']]
    );
    const exportedOutput = manifest.assets
      .find((asset: { id: string }) => asset.id === 'asset-output')
      .variants[0];
    assert.deepEqual(exportedOutput.recipe.styleReferenceVariantIds, ['variant-style-a', 'variant-style-b']);
    assert.deepEqual(exportedOutput.generation_provenance.styleReferenceImageKeys, [
      'images/source/style-a.png',
      'images/source/style-b.png',
    ]);

    const formData = new FormData();
    formData.set('file', new File([zipBytes], 'export.zip', { type: 'application/zip' }));
    const { app: importApp, doCalls } = buildApp();

    const importRes = await importApp.fetch(new Request('https://app.example/api/spaces/target-space/import', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
      body: formData,
    }));

    assert.equal(importRes.status, 200);
    const body = await importRes.json() as { imported: Record<string, number> };
    assert.deepEqual(body.imported, {
      assets: 2,
      variants: 3,
      lineage: 0,
      collections: 1,
      collectionItems: 2,
      stylePresets: 1,
    });

    const applyCalls = doCalls.filter((call) => call.path === '/internal/apply-variant');
    const importedStyleAId = String(applyCalls[0].body!.variantId);
    const importedStyleBId = String(applyCalls[1].body!.variantId);
    const importedStyleAKey = String(applyCalls[0].body!.mediaKey);
    const importedStyleBKey = String(applyCalls[1].body!.mediaKey);
    const importedOutput = applyCalls[2].body!;
    const importedRecipe = JSON.parse(String(importedOutput.recipe)) as Record<string, unknown>;
    const importedProvenance = importedOutput.generationProvenance as Record<string, unknown>;
    const collectionCall = doCalls.find((call) => call.path === '/internal/collections')!;
    const presetCall = doCalls.find((call) => call.path === '/internal/style-presets')!;

    assert.notEqual(presetCall.body!.id, 'preset-style');
    assert.notEqual(collectionCall.body!.id, 'collection-style');
    assert.equal(presetCall.body!.collectionId, collectionCall.body!.id);
    assert.equal(importedRecipe.stylePresetId, presetCall.body!.id);
    assert.equal(importedRecipe.styleCollectionId, collectionCall.body!.id);
    assert.deepEqual(importedRecipe.styleReferenceVariantIds, [importedStyleAId, importedStyleBId]);
    assert.deepEqual(importedRecipe.styleReferenceImageKeys, [importedStyleAKey, importedStyleBKey]);
    assert.deepEqual(importedRecipe.styleImageKeys, [importedStyleAKey, importedStyleBKey]);
    assert.deepEqual(importedRecipe.sourceImageKeys, [importedStyleAKey, importedStyleBKey]);
    assert.equal(importedProvenance.stylePresetId, presetCall.body!.id);
    assert.deepEqual(importedProvenance.styleReferenceVariantIds, [importedStyleAId, importedStyleBId]);
    assert.deepEqual(importedProvenance.styleReferenceImageKeys, [importedStyleAKey, importedStyleBKey]);

    assert.equal(doCalls.some((call) => call.path === '/internal/relations'), false);
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

  it('rejects invalid import manifest fields before mutating the target space', async () => {
    const cases: Array<{
      name: string;
      mutate: (manifest: Record<string, any>) => void;
      expected: RegExp;
    }> = [
      {
        name: 'asset media kind',
        mutate: (manifest) => { manifest.assets[0].mediaKind = 'movie'; },
        expected: /Asset asset-source mediaKind must be image, audio, or video/,
      },
      {
        name: 'variant media kind',
        mutate: (manifest) => { manifest.assets[0].variants[0].mediaKind = 'movie'; },
        expected: /Variant variant-source mediaKind must be image, audio, or video/,
      },
      {
        name: 'variant media kind mismatch',
        mutate: (manifest) => { manifest.assets[0].variants[0].mediaKind = 'video'; },
        expected: /Variant variant-source mediaKind must match asset asset-source mediaKind: image/,
      },
      {
        name: 'variant asset membership',
        mutate: (manifest) => { manifest.assets[0].variants[0].assetId = 'asset-other'; },
        expected: /Variant variant-source assetId must match asset asset-source/,
      },
      {
        name: 'pinned variant asset membership',
        mutate: (manifest) => {
          addSecondAsset(manifest);
          manifest.collectionItems[0].subjectType = 'asset';
          manifest.collectionItems[0].assetId = 'asset-source';
          manifest.collectionItems[0].variantId = null;
          manifest.collectionItems[0].pinnedVariantId = 'variant-other';
        },
        expected: /Collection item collection-item-source pinnedVariantId must reference a variant on the asset subject/,
      },
      {
        name: 'collection name',
        mutate: (manifest) => { manifest.collections[0].name = 5; },
        expected: /Collection collection-source name is required/,
      },
      {
        name: 'collection item role',
        mutate: (manifest) => { manifest.collectionItems[0].role = 5; },
        expected: /Collection item collection-item-source role is required/,
      },
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

  it('imports organization records with remapped relation and severed lineage IDs', async () => {
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
      stylePresets: 0,
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

    assert.equal(doCalls.some((call) => call.path === '/internal/relations'), false);
    assert.equal(doCalls.some((call) => call.path.includes('/internal/compositions')), false);
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
