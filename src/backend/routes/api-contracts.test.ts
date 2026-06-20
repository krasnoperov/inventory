import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { AuthHandler } from '../features/auth/auth-handler';
import { AuthService } from '../features/auth/auth-service';
import { UserDAO } from '../../dao/user-dao';
import { SpaceDAO } from '../../dao/space-dao';
import { MemberDAO } from '../../dao/member-dao';
import { PlatformUsageEventDAO } from '../../dao/platform-usage-event-dao';
import { authRoutes } from './auth';
import { userRoutes } from './user';
import { spaceRoutes } from './space';
import { uploadRoutes } from './upload';
import { imageRoutes } from './image';
import { createOpenApiRouter } from './openapi';
import type { AppContext } from './types';
import { apiFetch, type ApiFetchOptions, type ApiEndpointKey } from '../../api/client';

const baseUrl = 'https://inventory.test';

const user = {
  id: 7,
  email: 'artist@example.test',
  name: 'Asset Artist',
  google_id: 'google-7',
  polar_customer_id: null,
  paid_generation_entitlement: 'none' as const,
  quota_limits: null,
  quota_limits_updated_at: null,
  rate_limit_count: 0,
  rate_limit_window_start: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const space = {
  id: 'space-1',
  name: 'Test Space',
  owner_id: String(user.id),
  created_at: 1_780_000_000_000,
};

const asset = {
  id: 'asset-1',
  name: 'Hero Sword',
  type: 'item',
  media_kind: 'image' as const,
  tags: '[]',
  parent_asset_id: null,
  active_variant_id: null,
  created_by: String(user.id),
  created_at: 1_780_000_000_100,
  updated_at: 1_780_000_000_100,
};

const variant = {
  id: 'variant-1',
  asset_id: asset.id,
  media_kind: 'video' as const,
  workflow_id: null,
  status: 'completed' as const,
  error_message: null,
  image_key: null,
  thumb_key: null,
  media_key: 'media/space-1/variant-1.mp4',
  media_mime_type: 'video/mp4',
  media_size_bytes: 3,
  media_width: null,
  media_height: null,
  media_duration_ms: null,
  recipe: '{}',
  starred: false,
  created_by: String(user.id),
  created_at: 1_780_000_000_200,
  updated_at: 1_780_000_000_200,
};

const productionRecord = {
  id: 'record-1',
  production_id: 's01e01-a2',
  variant_id: variant.id,
  asset_id: asset.id,
  media_kind: 'video' as const,
  shot_id: 's01e01-a2-01',
  scene_label: 'Cocina',
  timeline_start_ms: 0,
  duration_ms: 73_000,
  motion_prompt: 'slow push in',
  source_refs: '[]',
  source_variant_ids: '[]',
  metadata: '{}',
  created_by: String(user.id),
  created_at: 1_780_000_000_300,
  updated_at: 1_780_000_000_300,
};

const production = {
  id: 's01e01-a2',
  name: 'S01E01 A2',
  description: null,
  metadata: '{}',
  created_by: String(user.id),
  created_at: 1_780_000_000_300,
  updated_at: 1_780_000_000_300,
};

const productionShot = {
  id: 'shot-row-1',
  production_id: production.id,
  shot_id: 's01e01-a2-01',
  label: 'Cocina',
  timeline_start_ms: 0,
  duration_ms: 73_000,
  metadata: '{}',
  created_by: String(user.id),
  created_at: 1_780_000_000_301,
  updated_at: 1_780_000_000_301,
};

const productionCue = {
  id: 'cue-row-1',
  production_id: production.id,
  cue_type: 'music' as const,
  label: 'Intro bed',
  timeline_start_ms: 0,
  duration_ms: 73_000,
  metadata: '{}',
  created_by: String(user.id),
  created_at: 1_780_000_000_302,
  updated_at: 1_780_000_000_302,
};

const productionPlacement = {
  id: 'placement-1',
  production_id: production.id,
  target_kind: 'shot' as const,
  target_id: productionShot.id,
  variant_id: variant.id,
  asset_id: asset.id,
  media_kind: 'video' as const,
  role: 'primary',
  source_refs: '[]',
  source_variant_ids: '[]',
  metadata: '{}',
  created_by: String(user.id),
  created_at: 1_780_000_000_303,
  updated_at: 1_780_000_000_303,
};

const collection = {
  id: 'collection-1',
  name: 'Scene Kit',
  description: null,
  sort_index: 0,
  created_by: String(user.id),
  created_at: 1_780_000_000_400,
  updated_at: 1_780_000_000_400,
};

const collectionItem = {
  id: 'collection-item-1',
  collection_id: collection.id,
  subject_type: 'asset' as const,
  asset_id: asset.id,
  variant_id: null,
  role: 'character',
  pinned_variant_id: variant.id,
  sort_index: 0,
  created_by: String(user.id),
  created_at: 1_780_000_000_401,
  updated_at: 1_780_000_000_401,
};

const styleReferenceCollection = {
  ...collection,
  reference_count: 1,
  preset_count: 1,
};

const stylePreset = {
  id: 'preset-1',
  name: 'Painterly',
  description: 'Painted house style',
  style_prompt: 'Loose brushwork',
  collection_id: collection.id,
  enabled: true,
  is_default: true,
  created_by: String(user.id),
  created_at: 1_780_000_000_405,
  updated_at: 1_780_000_000_405,
  collection_name: collection.name,
  reference_count: 1,
  style_reference_variant_ids: [variant.id],
  style_reference_image_keys: ['images/variant-1.png'],
};

const relation = {
  id: 'relation-1',
  subject_type: 'asset' as const,
  subject_asset_id: asset.id,
  subject_variant_id: null,
  object_type: 'variant' as const,
  object_asset_id: null,
  object_variant_id: variant.id,
  relation_type: 'appears_in' as const,
  label: 'Opening shot',
  context: null,
  metadata: '{}',
  sort_index: 0,
  created_by: String(user.id),
  created_at: 1_780_000_000_402,
  updated_at: 1_780_000_000_402,
};

const composition = {
  id: 'composition-1',
  name: 'Opening Shot',
  description: null,
  status: 'draft' as const,
  output_asset_id: asset.id,
  output_variant_id: variant.id,
  metadata: '{}',
  sort_index: 0,
  created_by: String(user.id),
  created_at: 1_780_000_000_403,
  updated_at: 1_780_000_000_403,
};

const compositionItem = {
  id: 'composition-item-1',
  composition_id: composition.id,
  role: 'output' as const,
  label: 'Final frame',
  asset_id: asset.id,
  variant_id: variant.id,
  metadata: '{}',
  sort_index: 0,
  created_by: String(user.id),
  created_at: 1_780_000_000_404,
  updated_at: 1_780_000_000_404,
};

type FetchLike = NonNullable<ApiFetchOptions<ApiEndpointKey>['fetch']>;

function bindFetch(app: OpenAPIHono<AppContext>): FetchLike {
  return async (input, init) => app.fetch(new Request(input, init));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function makeObject(key: string, body: Uint8Array, contentType: string): R2ObjectBody {
  return {
    key,
    version: 'version',
    size: body.byteLength,
    etag: 'etag',
    httpEtag: '"etag"',
    checksums: {} as R2Checksums,
    uploaded: new Date('2026-01-01T00:00:00.000Z'),
    httpMetadata: { contentType },
    customMetadata: undefined,
    range: undefined,
    storageClass: 'Standard',
    ssecKeyMd5: undefined,
    writeHttpMetadata(headers: Headers) {
      headers.set('Content-Type', contentType);
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
  throw new Error('Unsupported R2 body');
}

function routeApp(
  routes: OpenAPIHono<AppContext>,
  deps: Map<unknown, unknown>,
  envOverrides: Partial<AppContext['Bindings']> = {},
) {
  const app = createOpenApiRouter();
  app.use('*', async (c, next) => {
    c.env = {
      GOOGLE_CLIENT_ID: 'google-client',
      ENVIRONMENT: 'test',
      SPACES_DO: {
        idFromName: (id: string) => id,
        get: () => ({
          fetch: async () => Response.json({ assets: [asset] }),
        }),
      },
      ...envOverrides,
    } as unknown as AppContext['Bindings'];
    c.set('container', {
      get: (token: unknown) => {
        const dependency = deps.get(token);
        if (!dependency) {
          throw new Error('Missing fake dependency');
        }
        return dependency;
      },
    } as never);
    await next();
  });
  app.route('/', routes);
  return app;
}

describe('API contracts', () => {
  it('round-trips auth routes through the shared client contract', async () => {
    const fakeAuthHandler = {
      getSession: (c: Context) => c.json({
        user,
        config: {
          googleClientId: 'google-client',
          environment: 'test',
          features: {
            rotation: true,
          },
        },
      }, 200),
      googleAuth: async (c: Context) => {
        const body = await c.req.json<{ access_token: string }>();
        assert.equal(body.access_token, 'google-token');
        return c.json({ success: true, user }, 200);
      },
      logout: (c: Context) => c.json({ success: true }, 200),
    };
    const app = routeApp(authRoutes, new Map([[AuthHandler, fakeAuthHandler]]));
    const fetch = bindFetch(app);

    const session = await apiFetch('GET /api/auth/session', { fetch, baseUrl });
    assert.equal(session.config.environment, 'test');
    assert.equal(session.config.features.rotation, true);
    assert.equal(session.user?.id, user.id);

    const login = await apiFetch('POST /api/auth/google', {
      fetch,
      baseUrl,
      json: { access_token: 'google-token' },
    });
    assert.equal(login.user.email, user.email);

    const logout = await apiFetch('POST /api/auth/logout', { fetch, baseUrl });
    assert.equal(logout.success, true);
  });

  it('round-trips user routes through the shared client contract', async () => {
    const fakeUserDAO = {
      findById: async () => user,
      updateSettings: async (_id: number, settings: { name?: string }) => {
        if (settings.name !== undefined) {
          user.name = settings.name;
        }
      },
    };
    const fakeAuthService = {
      verifyJWT: async () => ({ userId: user.id }),
    };
    const app = routeApp(userRoutes, new Map<unknown, unknown>([
      [AuthService, fakeAuthService],
      [UserDAO, fakeUserDAO],
    ]));
    const fetch = bindFetch(app);
    const authHeaders = { Authorization: 'Bearer test-token' };

    const profile = await apiFetch('GET /api/user/profile', {
      fetch,
      baseUrl,
      headers: authHeaders,
    });
    assert.equal(profile.id, user.id);

    const updatedProfile = await apiFetch('PATCH /api/user/profile', {
      fetch,
      baseUrl,
      headers: authHeaders,
      json: { name: 'Updated Artist' },
    });
    assert.equal(updatedProfile.user.name, 'Updated Artist');

    const settings = await apiFetch('PUT /api/user/settings', {
      fetch,
      baseUrl,
      headers: authHeaders,
      json: { name: 'Settings Artist' },
    });
    assert.equal(settings.user.name, 'Settings Artist');
  });

  it('round-trips space routes through the shared client contract', async () => {
    const createdSpaces = [space];
    const fakeSpaceDAO = {
      createSpace: async (data: typeof space) => {
        createdSpaces.unshift(data);
        return data;
      },
      getSpacesForUser: async () => createdSpaces.map((item) => ({
        ...item,
        role: 'owner',
      })),
      getSpaceById: async (id: string) => createdSpaces.find((item) => item.id === id) ?? null,
      deleteSpace: async (id: string) => {
        const index = createdSpaces.findIndex((item) => item.id === id);
        if (index === -1) {
          return false;
        }
        createdSpaces.splice(index, 1);
        return true;
      },
    };
    const fakeMemberDAO = {
      addMember: async () => ({ space_id: 'space-new', user_id: String(user.id), role: 'owner', joined_at: Date.now() }),
      getMember: async () => ({ space_id: space.id, user_id: String(user.id), role: 'owner', joined_at: Date.now() }),
    };
    const usageSummaryCalls: unknown[] = [];
    const fakePlatformUsageEventDAO = {
      getSpaceSummary: async (...args: unknown[]) => {
        usageSummaryCalls.push(args);
        return {
          spaceId: space.id,
          period: {
            from: '2026-06-01T00:00:00.000Z',
            to: '2026-06-30T23:59:59.999Z',
          },
          totals: {
            storageBytes: 1536,
            workflowRuns: 2,
            deliveryBytes: 256,
          },
          byType: [
            { usageType: 'storage', unit: 'byte', quantity: 1536, events: 2 },
            { usageType: 'workflow', unit: 'run', quantity: 2, events: 2 },
            { usageType: 'delivery', unit: 'byte', quantity: 256, events: 1 },
          ],
          byMediaKind: [
            { mediaKind: 'video', storageBytes: 1536, workflowRuns: 2, deliveryBytes: 256, events: 5 },
          ],
        };
      },
    };
    const fakeAuthService = {
      verifyJWT: async () => ({ userId: user.id }),
    };
    const app = routeApp(spaceRoutes, new Map<unknown, unknown>([
      [AuthService, fakeAuthService],
      [SpaceDAO, fakeSpaceDAO],
      [MemberDAO, fakeMemberDAO],
      [PlatformUsageEventDAO, fakePlatformUsageEventDAO],
    ]));
    const fetch = bindFetch(app);
    const authHeaders = { Authorization: 'Bearer test-token' };

    const created = await apiFetch('POST /api/spaces', {
      fetch,
      baseUrl,
      headers: authHeaders,
      json: { name: 'New Space' },
    });
    assert.equal(created.space.role, 'owner');

    const listed = await apiFetch('GET /api/spaces', {
      fetch,
      baseUrl,
      headers: authHeaders,
    });
    assert.equal(listed.spaces[0].name, 'New Space');

    const fetched = await apiFetch('GET /api/spaces/:id', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id },
    });
    assert.equal(fetched.space.id, space.id);

    const assets = await apiFetch('GET /api/spaces/:id/assets', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id },
    });
    assert.equal(assets.assets[0].id, asset.id);

    const usage = await apiFetch('GET /api/spaces/:id/usage/summary', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id },
      query: { from: '2026-06-01', to: '2026-06-30' },
    });
    assert.equal(usage.totals.storageBytes, 1536);
    assert.equal(usage.totals.workflowRuns, 2);
    assert.deepEqual(usageSummaryCalls, [[
      space.id,
      {
        from: '2026-06-01T00:00:00.000Z',
        to: '2026-06-30T23:59:59.999Z',
      },
    ]]);

    const invalidUsageDate = await fetch(`${baseUrl}/api/spaces/${space.id}/usage/summary?to=2026-02-31`, {
      headers: authHeaders,
    });
    assert.equal(invalidUsageDate.status, 400);
    assert.deepEqual(await invalidUsageDate.json(), {
      error: 'to must be a valid date or ISO timestamp',
    });

    const deleted = await apiFetch('DELETE /api/spaces/:id', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id },
    });
    assert.equal(deleted.message, 'Space deleted successfully');
  });

  it('round-trips production placement routes through the shared client contract', async () => {
    const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
    const fakeSpacesDO = {
      idFromName: (id: string) => id,
      get: () => ({
        fetch: async (request: Request) => {
          const path = new URL(request.url).pathname;
          const method = request.method;
          const body = method === 'POST' ? await request.json<Record<string, unknown>>() : undefined;
          calls.push({ path, method, body });

          if (path === '/internal/production/s01e01-a2/records') {
            return Response.json({ success: true, records: [productionRecord] });
          }
          if (path === '/internal/production/placements') {
            assert.equal(body?.createdBy, String(user.id));
            assert.equal(body?.productionId, 's01e01-a2');
            assert.equal(body?.variantId, variant.id);
            return Response.json({ success: true, record: productionRecord });
          }
          if (path === '/internal/production/records/record-1') {
            return Response.json({ success: true });
          }

          return Response.json({ error: 'Unexpected route' }, { status: 404 });
        },
      }),
    };
    const fakeAuthService = {
      verifyJWT: async () => ({ userId: user.id }),
    };
    const fakeMemberDAO = {
      getMember: async () => ({ space_id: space.id, user_id: String(user.id), role: 'editor', joined_at: Date.now() }),
    };
    const app = routeApp(spaceRoutes, new Map<unknown, unknown>([
      [AuthService, fakeAuthService],
      [MemberDAO, fakeMemberDAO],
    ]), {
      SPACES_DO: fakeSpacesDO as unknown as AppContext['Bindings']['SPACES_DO'],
    });
    const fetch = bindFetch(app);
    const authHeaders = { Authorization: 'Bearer test-token' };

    const listed = await apiFetch('GET /api/spaces/:id/productions/:productionId/records', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, productionId: 's01e01-a2' },
    });
    assert.equal(listed.records[0].scene_label, 'Cocina');

    const placed = await apiFetch('POST /api/spaces/:id/production/placements', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id },
      json: {
        id: 'record-1',
        productionId: 's01e01-a2',
        variantId: variant.id,
        shotId: 's01e01-a2-01',
        sceneLabel: 'Cocina',
        timelineStartMs: 0,
        durationMs: 73_000,
        motionPrompt: 'slow push in',
      },
    });
    assert.equal(placed.record.id, 'record-1');

    const deleted = await apiFetch('DELETE /api/spaces/:id/production/records/:recordId', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, recordId: 'record-1' },
    });
    assert.equal(deleted.success, true);

    assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
      'GET /internal/production/s01e01-a2/records',
      'POST /internal/production/placements',
      'DELETE /internal/production/records/record-1',
    ]);
  });

  it('round-trips style preset routes and preserves distinct API errors', async () => {
    const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
    const fakeSpacesDO = {
      idFromName: (id: string) => id,
      get: () => ({
        fetch: async (request: Request) => {
          const path = new URL(request.url).pathname;
          const method = request.method;
          const body = method === 'POST' || method === 'PATCH'
            ? await request.json<Record<string, unknown>>()
            : undefined;
          calls.push({ path, method, body });

          if (path === '/internal/style-reference-collections' && method === 'GET') {
            return Response.json({ success: true, collections: [styleReferenceCollection] });
          }
          if (path === '/internal/style-presets' && method === 'GET') {
            return Response.json({ success: true, presets: [stylePreset] });
          }
          if (path === '/internal/style-presets' && method === 'POST') {
            assert.equal(body?.createdBy, String(user.id));
            assert.equal(body?.collectionId, collection.id);
            return Response.json({ success: true, preset: stylePreset });
          }
          if (path === '/internal/style-presets/preset-1' && method === 'PATCH') {
            return Response.json({
              success: true,
              preset: {
                ...stylePreset,
                description: 'Updated description',
                style_prompt: 'Crisp pixel art',
                updated_at: 1_780_000_000_500,
              },
            });
          }
          if (path === '/internal/style-presets/preset-1' && method === 'DELETE') {
            return Response.json({ success: true });
          }
          if (path === '/internal/style-presets/missing-preset' && method === 'PATCH') {
            return Response.json({ error: 'Style preset not found' }, { status: 404 });
          }
          if (path === '/internal/style-presets/missing-collection' && method === 'PATCH') {
            return Response.json({ error: 'Style reference collection not found' }, { status: 404 });
          }
          if (path === '/internal/style-presets/invalid-collection' && method === 'PATCH') {
            return Response.json({ error: 'Invalid style reference collection' }, { status: 400 });
          }
          if (path === '/internal/style-presets/default-conflict' && method === 'PATCH') {
            return Response.json({
              error: 'Default style preset must be enabled',
              code: 'DEFAULT_STYLE_PRESET_CONFLICT',
            }, { status: 409 });
          }

          return Response.json({ error: 'Unexpected route' }, { status: 404 });
        },
      }),
    };
    const fakeAuthService = {
      verifyJWT: async () => ({ userId: user.id }),
    };
    const fakeMemberDAO = {
      getMember: async () => ({ space_id: space.id, user_id: String(user.id), role: 'editor', joined_at: Date.now() }),
    };
    const app = routeApp(spaceRoutes, new Map<unknown, unknown>([
      [AuthService, fakeAuthService],
      [MemberDAO, fakeMemberDAO],
    ]), {
      SPACES_DO: fakeSpacesDO as unknown as AppContext['Bindings']['SPACES_DO'],
    });
    const fetch = bindFetch(app);
    const authHeaders = { Authorization: 'Bearer test-token' };

    const collections = await apiFetch('GET /api/spaces/:id/style-reference-collections', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id },
    });
    assert.equal(collections.collections[0].reference_count, 1);

    const listed = await apiFetch('GET /api/spaces/:id/style-presets', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id },
    });
    assert.equal(listed.presets[0].collection_name, collection.name);
    assert.equal(listed.presets[0].enabled, true);
    assert.equal(listed.presets[0].is_default, true);

    const created = await apiFetch('POST /api/spaces/:id/style-presets', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id },
      json: {
        id: 'preset-1',
        name: 'Painterly',
        description: 'Painted house style',
        stylePrompt: 'Loose brushwork',
        collectionId: collection.id,
        isDefault: true,
      },
    });
    assert.equal(created.preset.reference_count, 1);

    const updated = await apiFetch('PATCH /api/spaces/:id/style-presets/:presetId', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, presetId: 'preset-1' },
      json: {
        description: 'Updated description',
        stylePrompt: 'Crisp pixel art',
        enabled: true,
      },
    });
    assert.equal(updated.preset.description, 'Updated description');
    assert.equal(updated.preset.style_prompt, 'Crisp pixel art');

    const missingPreset = await fetch(`${baseUrl}/api/spaces/${space.id}/style-presets/missing-preset`, {
      method: 'PATCH',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Missing' }),
    });
    assert.equal(missingPreset.status, 404);
    assert.deepEqual(await missingPreset.json(), { error: 'Style preset not found' });

    const missingCollection = await fetch(`${baseUrl}/api/spaces/${space.id}/style-presets/missing-collection`, {
      method: 'PATCH',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ collectionId: 'missing-collection' }),
    });
    assert.equal(missingCollection.status, 404);
    assert.deepEqual(await missingCollection.json(), { error: 'Style reference collection not found' });

    const invalidCollection = await fetch(`${baseUrl}/api/spaces/${space.id}/style-presets/invalid-collection`, {
      method: 'PATCH',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ collectionId: 'general-collection' }),
    });
    assert.equal(invalidCollection.status, 400);
    assert.deepEqual(await invalidCollection.json(), { error: 'Invalid style reference collection' });

    const conflict = await fetch(`${baseUrl}/api/spaces/${space.id}/style-presets/default-conflict`, {
      method: 'PATCH',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), {
      error: 'Default style preset must be enabled',
      code: 'DEFAULT_STYLE_PRESET_CONFLICT',
    });

    const deleted = await apiFetch('DELETE /api/spaces/:id/style-presets/:presetId', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, presetId: 'preset-1' },
    });
    assert.equal(deleted.success, true);

    assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
      'GET /internal/style-reference-collections',
      'GET /internal/style-presets',
      'POST /internal/style-presets',
      'PATCH /internal/style-presets/preset-1',
      'PATCH /internal/style-presets/missing-preset',
      'PATCH /internal/style-presets/missing-collection',
      'PATCH /internal/style-presets/invalid-collection',
      'PATCH /internal/style-presets/default-conflict',
      'DELETE /internal/style-presets/preset-1',
    ]);
  });

  it('denies viewer style preset mutations before calling SpaceDO', async () => {
    let calledSpaceDo = false;
    const fakeSpacesDO = {
      idFromName: (id: string) => id,
      get: () => ({
        fetch: async () => {
          calledSpaceDo = true;
          return Response.json({ error: 'Unexpected route' }, { status: 500 });
        },
      }),
    };
    const fakeAuthService = {
      verifyJWT: async () => ({ userId: user.id }),
    };
    const fakeMemberDAO = {
      getMember: async () => ({ space_id: space.id, user_id: String(user.id), role: 'viewer', joined_at: Date.now() }),
    };
    const app = routeApp(spaceRoutes, new Map<unknown, unknown>([
      [AuthService, fakeAuthService],
      [MemberDAO, fakeMemberDAO],
    ]), {
      SPACES_DO: fakeSpacesDO as unknown as AppContext['Bindings']['SPACES_DO'],
    });
    const fetch = bindFetch(app);

    const response = await fetch(`${baseUrl}/api/spaces/${space.id}/style-presets`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Viewer preset' }),
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'Viewers cannot modify style presets' });
    assert.equal(calledSpaceDo, false);
  });

  it('round-trips normalized production model routes through the shared client contract', async () => {
    const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
    const fakeSpacesDO = {
      idFromName: (id: string) => id,
      get: () => ({
        fetch: async (request: Request) => {
          const path = new URL(request.url).pathname;
          const method = request.method;
          const body = method === 'POST' ? await request.json<Record<string, unknown>>() : undefined;
          calls.push({ path, method, body });

          if (path === '/internal/productions' && method === 'GET') {
            return Response.json({ success: true, productions: [production] });
          }
          if (path === '/internal/productions' && method === 'POST') {
            assert.equal(body?.createdBy, String(user.id));
            assert.equal(body?.name, production.name);
            return Response.json({ success: true, production });
          }
          if (path === '/internal/productions/s01e01-a2' && method === 'GET') {
            return Response.json({
              success: true,
              production,
              shots: [productionShot],
              cues: [productionCue],
              placements: [productionPlacement],
            });
          }
          if (path === '/internal/productions/s01e01-a2/shots' && method === 'POST') {
            assert.equal(body?.createdBy, String(user.id));
            return Response.json({ success: true, shot: productionShot });
          }
          if (path === '/internal/productions/s01e01-a2/cues' && method === 'POST') {
            assert.equal(body?.cueType, 'music');
            return Response.json({ success: true, cue: productionCue });
          }
          if (path === '/internal/productions/s01e01-a2/placements' && method === 'POST') {
            assert.equal(body?.targetKind, 'shot');
            assert.equal(body?.variantId, variant.id);
            return Response.json({ success: true, placement: productionPlacement });
          }
          if (
            path === '/internal/productions/s01e01-a2/placements/placement-1'
            || path === '/internal/productions/s01e01-a2/cues/cue-row-1'
            || path === '/internal/productions/s01e01-a2/shots/shot-row-1'
            || path === '/internal/productions/s01e01-a2'
          ) {
            return Response.json({ success: true });
          }

          return Response.json({ error: 'Unexpected route' }, { status: 404 });
        },
      }),
    };
    const fakeAuthService = {
      verifyJWT: async () => ({ userId: user.id }),
    };
    const fakeMemberDAO = {
      getMember: async () => ({ space_id: space.id, user_id: String(user.id), role: 'editor', joined_at: Date.now() }),
    };
    const app = routeApp(spaceRoutes, new Map<unknown, unknown>([
      [AuthService, fakeAuthService],
      [MemberDAO, fakeMemberDAO],
    ]), {
      SPACES_DO: fakeSpacesDO as unknown as AppContext['Bindings']['SPACES_DO'],
    });
    const fetch = bindFetch(app);
    const authHeaders = { Authorization: 'Bearer test-token' };

    const listed = await apiFetch('GET /api/spaces/:id/productions', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id },
    });
    assert.equal(listed.productions[0].id, production.id);

    const saved = await apiFetch('POST /api/spaces/:id/productions', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id },
      json: { id: production.id, name: production.name },
    });
    assert.equal(saved.production.name, production.name);

    const detail = await apiFetch('GET /api/spaces/:id/productions/:productionId', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, productionId: production.id },
    });
    assert.equal(detail.shots[0].label, 'Cocina');
    assert.equal(detail.cues[0].cue_type, 'music');
    assert.equal(detail.placements[0].variant_id, variant.id);

    const shot = await apiFetch('POST /api/spaces/:id/productions/:productionId/shots', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, productionId: production.id },
      json: {
        id: productionShot.id,
        shotId: productionShot.shot_id!,
        label: productionShot.label,
        timelineStartMs: productionShot.timeline_start_ms,
        durationMs: productionShot.duration_ms!,
      },
    });
    assert.equal(shot.shot.id, productionShot.id);

    const cue = await apiFetch('POST /api/spaces/:id/productions/:productionId/cues', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, productionId: production.id },
      json: {
        id: productionCue.id,
        cueType: 'music',
        label: productionCue.label,
        timelineStartMs: productionCue.timeline_start_ms,
      },
    });
    assert.equal(cue.cue.cue_type, 'music');

    const placement = await apiFetch('POST /api/spaces/:id/productions/:productionId/placements', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, productionId: production.id },
      json: {
        id: productionPlacement.id,
        targetKind: 'shot',
        targetId: productionShot.id,
        variantId: variant.id,
      },
    });
    assert.equal(placement.placement.target_id, productionShot.id);

    await apiFetch('DELETE /api/spaces/:id/productions/:productionId/placements/:childId', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, productionId: production.id, childId: productionPlacement.id },
    });
    await apiFetch('DELETE /api/spaces/:id/productions/:productionId/cues/:childId', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, productionId: production.id, childId: productionCue.id },
    });
    await apiFetch('DELETE /api/spaces/:id/productions/:productionId/shots/:childId', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, productionId: production.id, childId: productionShot.id },
    });
    await apiFetch('DELETE /api/spaces/:id/productions/:productionId', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, productionId: production.id },
    });

    assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
      'GET /internal/productions',
      'POST /internal/productions',
      'GET /internal/productions/s01e01-a2',
      'POST /internal/productions/s01e01-a2/shots',
      'POST /internal/productions/s01e01-a2/cues',
      'POST /internal/productions/s01e01-a2/placements',
      'DELETE /internal/productions/s01e01-a2/placements/placement-1',
      'DELETE /internal/productions/s01e01-a2/cues/cue-row-1',
      'DELETE /internal/productions/s01e01-a2/shots/shot-row-1',
      'DELETE /internal/productions/s01e01-a2',
    ]);
  });

  it('round-trips organization routes through the shared client contract', async () => {
    const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
    const fakeSpacesDO = {
      idFromName: (id: string) => id,
      get: () => ({
        fetch: async (request: Request) => {
          const path = new URL(request.url).pathname;
          const method = request.method;
          const body = method !== 'GET' && method !== 'DELETE'
            ? await request.json<Record<string, unknown>>()
            : undefined;
          calls.push({ path, method, body });

          if (path === '/internal/collections' && method === 'GET') {
            return Response.json({ success: true, collections: [collection] });
          }
          if (path === '/internal/collections' && method === 'POST') {
            assert.equal(body?.createdBy, String(user.id));
            return Response.json({ success: true, collection });
          }
          if (path === '/internal/collections/collection-1' && method === 'PATCH') {
            assert.equal(body?.name, 'Opening Kit');
            return Response.json({ success: true, collection: { ...collection, name: 'Opening Kit' } });
          }
          if (path === '/internal/collections/collection-1/items' && method === 'GET') {
            return Response.json({ success: true, items: [collectionItem] });
          }
          if (path === '/internal/collections/collection-1/items' && method === 'POST') {
            assert.equal(body?.createdBy, String(user.id));
            assert.equal(body?.subjectType, 'asset');
            return Response.json({ success: true, item: collectionItem });
          }
          if (path === '/internal/collections/collection-1/items/collection-item-1' && method === 'PATCH') {
            assert.equal(body?.role, 'hero');
            return Response.json({ success: true, item: { ...collectionItem, role: 'hero' } });
          }
          if (path === '/internal/collections/collection-1/items/reorder' && method === 'POST') {
            assert.deepEqual(body?.itemIds, ['collection-item-1']);
            return Response.json({ success: true, items: [collectionItem] });
          }
          if (path === '/internal/relations' && method === 'GET') {
            return Response.json({ success: true, relations: [relation] });
          }
          if (path === '/internal/relations' && method === 'POST') {
            assert.equal(body?.createdBy, String(user.id));
            return Response.json({ success: true, relation });
          }
          if (path === '/internal/relations/relation-1' && method === 'PATCH') {
            assert.equal(body?.relationType, 'reference_for');
            return Response.json({ success: true, relation: { ...relation, relation_type: 'reference_for' } });
          }
          if (path === '/internal/compositions' && method === 'GET') {
            return Response.json({ success: true, compositions: [composition] });
          }
          if (path === '/internal/compositions' && method === 'POST') {
            assert.equal(body?.createdBy, String(user.id));
            return Response.json({ success: true, composition });
          }
          if (path === '/internal/compositions/composition-1' && method === 'PATCH') {
            assert.equal(body?.status, 'final');
            return Response.json({ success: true, composition: { ...composition, status: 'final' } });
          }
          if (path === '/internal/compositions/composition-1/items' && method === 'GET') {
            return Response.json({ success: true, items: [compositionItem] });
          }
          if (path === '/internal/compositions/composition-1/items' && method === 'POST') {
            assert.equal(body?.role, 'output');
            return Response.json({ success: true, item: compositionItem });
          }
          if (path === '/internal/compositions/composition-1/items/composition-item-1' && method === 'PATCH') {
            assert.equal(body?.role, 'thumbnail');
            return Response.json({ success: true, item: { ...compositionItem, role: 'thumbnail' } });
          }
          if (path === '/internal/compositions/composition-1/items/reorder' && method === 'POST') {
            assert.deepEqual(body?.itemIds, ['composition-item-1']);
            return Response.json({ success: true, items: [compositionItem] });
          }
          if (
            (path === '/internal/collections/collection-1/items/collection-item-1' && method === 'DELETE')
            || (path === '/internal/collections/collection-1' && method === 'DELETE')
            || (path === '/internal/relations/relation-1' && method === 'DELETE')
            || (path === '/internal/compositions/composition-1/items/composition-item-1' && method === 'DELETE')
            || (path === '/internal/compositions/composition-1' && method === 'DELETE')
          ) {
            return Response.json({ success: true });
          }

          return Response.json({ error: 'Unexpected route' }, { status: 404 });
        },
      }),
    };
    const fakeAuthService = {
      verifyJWT: async () => ({ userId: user.id }),
    };
    let memberRole = 'editor';
    const fakeMemberDAO = {
      getMember: async () => ({
        space_id: space.id,
        user_id: String(user.id),
        role: memberRole,
        joined_at: Date.now(),
      }),
    };
    const app = routeApp(spaceRoutes, new Map<unknown, unknown>([
      [AuthService, fakeAuthService],
      [MemberDAO, fakeMemberDAO],
    ]), {
      SPACES_DO: fakeSpacesDO as unknown as AppContext['Bindings']['SPACES_DO'],
    });
    const fetch = bindFetch(app);
    const authHeaders = { Authorization: 'Bearer test-token' };

    const listedCollections = await apiFetch('GET /api/spaces/:id/collections', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id },
    });
    assert.equal(listedCollections.collections[0].name, collection.name);

    memberRole = 'viewer';
    const viewerRelations = await apiFetch('GET /api/spaces/:id/relations', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id },
    });
    assert.equal(viewerRelations.relations[0].id, relation.id);

    await assert.rejects(
      () => apiFetch('POST /api/spaces/:id/collections', {
        fetch,
        baseUrl,
        headers: authHeaders,
        params: { id: space.id },
        json: { name: collection.name },
      }),
      { status: 403 }
    );

    memberRole = 'editor';
    await apiFetch('POST /api/spaces/:id/collections', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id },
      json: { id: collection.id, name: collection.name },
    });
    await apiFetch('PATCH /api/spaces/:id/collections/:collectionId', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, collectionId: collection.id },
      json: { name: 'Opening Kit' },
    });
    await apiFetch('GET /api/spaces/:id/collections/:collectionId/items', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, collectionId: collection.id },
    });
    await apiFetch('POST /api/spaces/:id/collections/:collectionId/items', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, collectionId: collection.id },
      json: {
        subjectType: 'asset',
        assetId: asset.id,
        role: 'character',
        pinnedVariantId: variant.id,
      },
    });
    await apiFetch('PATCH /api/spaces/:id/collections/:collectionId/items/:itemId', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, collectionId: collection.id, itemId: collectionItem.id },
      json: { role: 'hero' },
    });
    await apiFetch('POST /api/spaces/:id/collections/:collectionId/items/reorder', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, collectionId: collection.id },
      json: { itemIds: [collectionItem.id] },
    });

    await apiFetch('GET /api/spaces/:id/compositions', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id },
    });
    await apiFetch('POST /api/spaces/:id/compositions', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id },
      json: { id: composition.id, name: composition.name, outputVariantId: variant.id },
    });
    await apiFetch('PATCH /api/spaces/:id/compositions/:compositionId', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, compositionId: composition.id },
      json: { status: 'final' },
    });
    await apiFetch('GET /api/spaces/:id/compositions/:compositionId/items', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, compositionId: composition.id },
    });
    await apiFetch('POST /api/spaces/:id/compositions/:compositionId/items', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, compositionId: composition.id },
      json: { role: 'output', variantId: variant.id },
    });
    await apiFetch('PATCH /api/spaces/:id/compositions/:compositionId/items/:itemId', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, compositionId: composition.id, itemId: compositionItem.id },
      json: { role: 'thumbnail' },
    });
    await apiFetch('POST /api/spaces/:id/compositions/:compositionId/items/reorder', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, compositionId: composition.id },
      json: { itemIds: [compositionItem.id] },
    });

    await apiFetch('POST /api/spaces/:id/relations', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id },
      json: {
        subject: { subjectType: 'asset', assetId: asset.id },
        object: { subjectType: 'variant', variantId: variant.id },
        relationType: 'appears_in',
      },
    });
    await apiFetch('PATCH /api/spaces/:id/relations/:relationId', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, relationId: relation.id },
      json: { relationType: 'reference_for' },
    });

    await apiFetch('DELETE /api/spaces/:id/collections/:collectionId/items/:itemId', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, collectionId: collection.id, itemId: collectionItem.id },
    });
    await apiFetch('DELETE /api/spaces/:id/collections/:collectionId', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, collectionId: collection.id },
    });
    await apiFetch('DELETE /api/spaces/:id/relations/:relationId', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, relationId: relation.id },
    });
    await apiFetch('DELETE /api/spaces/:id/compositions/:compositionId/items/:itemId', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, compositionId: composition.id, itemId: compositionItem.id },
    });
    await apiFetch('DELETE /api/spaces/:id/compositions/:compositionId', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id, compositionId: composition.id },
    });

    assert(calls.some((call) => call.path === '/internal/collections' && call.method === 'GET'));
    assert(calls.some((call) => call.path === '/internal/compositions/composition-1/items/reorder'));
    assert(calls.some((call) => call.path === '/internal/relations/relation-1' && call.method === 'DELETE'));
  });

  it('round-trips media upload through the shared multipart contract', async () => {
    const stored = new Map<string, { body: Uint8Array; contentType?: string }>();
    const fakeImages = {
      put: async (key: string, value: unknown, options?: R2PutOptions) => {
        const body = await toBytes(value);
        const contentType = options?.httpMetadata instanceof Headers
          ? options.httpMetadata.get('content-type') ?? undefined
          : options?.httpMetadata?.contentType;
        stored.set(key, { body, contentType });
        return null;
      },
      delete: async (key: string) => {
        stored.delete(key);
      },
    };
    const fakeSpacesDO = {
      idFromName: (id: string) => id,
      get: () => ({
        fetch: async (request: Request) => {
          const path = new URL(request.url).pathname;
          const body = await request.json<Record<string, unknown>>();

          if (path === '/internal/upload-placeholder') {
            assert.equal(body.assetName, 'Opening Cutscene');
            assert.equal(body.mediaKind, 'video');
            return Response.json({
              asset: { ...asset, id: 'asset-video', name: 'Opening Cutscene', media_kind: 'video' },
              assetId: 'asset-video',
              variant: { ...variant, status: 'uploading' },
            });
          }

          if (path === '/internal/complete-upload') {
            return Response.json({
              variant: {
                ...variant,
                asset_id: 'asset-video',
                media_key: body.mediaKey,
                media_mime_type: body.mediaMimeType,
                media_size_bytes: body.mediaSizeBytes,
                starred: 0,
              },
            });
          }

          return Response.json({ error: 'Unexpected route' }, { status: 404 });
        },
      }),
    };
    const fakeAuthService = {
      verifyJWT: async () => ({ userId: user.id }),
    };
    const fakeMemberDAO = {
      getMember: async () => ({ space_id: space.id, user_id: String(user.id), role: 'editor', joined_at: Date.now() }),
    };
    const app = routeApp(uploadRoutes, new Map<unknown, unknown>([
      [AuthService, fakeAuthService],
      [MemberDAO, fakeMemberDAO],
    ]), {
      IMAGES: fakeImages as unknown as AppContext['Bindings']['IMAGES'],
      SPACES_DO: fakeSpacesDO as unknown as AppContext['Bindings']['SPACES_DO'],
    });
    const fetch = bindFetch(app);

    const uploaded = await apiFetch('POST /api/spaces/:id/upload', {
      fetch,
      baseUrl,
      headers: { Authorization: 'Bearer test-token' },
      params: { id: space.id },
      form: {
        file: new File([new Uint8Array([1, 2, 3])], 'cutscene.mp4', { type: 'video/mp4' }),
        assetName: 'Opening Cutscene',
        assetType: 'video',
        mediaKind: 'video',
      },
    });

    assert.equal(uploaded.success, true);
    assert.equal(uploaded.asset?.media_kind, 'video');
    assert.equal(uploaded.variant.starred, false);
    assert.equal(uploaded.variant.media_mime_type, 'video/mp4');
    assert.equal(stored.get(uploaded.variant.media_key!)?.contentType, 'video/mp4');
  });

  it('round-trips variant media endpoints as typed streaming responses', async () => {
    const mediaBytes = new TextEncoder().encode('video-data');
    const fakeImages = {
      get: async (key: string) => {
        assert.equal(key, variant.media_key);
        return makeObject(key, mediaBytes, 'video/mp4');
      },
    };
    const fakeSpacesDO = {
      idFromName: (id: string) => id,
      get: () => ({
        fetch: async () => Response.json(variant),
      }),
    };
    const fakeAuthService = {
      verifyJWT: async () => ({ userId: user.id }),
    };
    const fakeMemberDAO = {
      getMember: async () => ({ space_id: space.id, user_id: String(user.id), role: 'viewer', joined_at: Date.now() }),
    };
    const app = routeApp(imageRoutes, new Map<unknown, unknown>([
      [AuthService, fakeAuthService],
      [MemberDAO, fakeMemberDAO],
    ]), {
      IMAGES: fakeImages as unknown as AppContext['Bindings']['IMAGES'],
      SPACES_DO: fakeSpacesDO as unknown as AppContext['Bindings']['SPACES_DO'],
    });
    const fetch = bindFetch(app);

    const response = await apiFetch('GET /api/spaces/:spaceId/variants/:variantId/media', {
      fetch,
      baseUrl,
      headers: { Authorization: 'Bearer test-token' },
      params: { spaceId: space.id, variantId: variant.id },
    });

    assert(response instanceof Response);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.equal(await response.text(), 'video-data');
  });
});
