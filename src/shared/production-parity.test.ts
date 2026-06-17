import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { AuthService } from '../backend/features/auth/auth-service';
import { MemberDAO } from '../dao/member-dao';
import { spaceRoutes } from '../backend/routes/space';
import { createOpenApiRouter } from '../backend/routes/openapi';
import type { AppContext } from '../backend/routes/types';
import { executeProductions } from '../cli/commands/productions';
import type { ProjectConfig } from '../cli/lib/project-config';
import type { StoredConfig } from '../cli/lib/types';
import type { Asset, Variant } from '../frontend/hooks/useSpaceWebSocket';
import { apiFetch } from './api/client';
import type { PlaceProductionRecordRequest } from './api/schemas';
import {
  createProductionHandoff,
  formatRemotionSceneArgs,
  type ProductionRecord,
} from '../frontend/productionHandoff';

const baseUrl = 'https://inventory.example.test';
const spaceId = 'space-1';
const productionId = 'episode-01';
const accessToken = 'test-token';
const userId = '7';

const storedConfig: StoredConfig = {
  environment: 'stage',
  baseUrl,
  clientId: 'test-client',
  token: {
    accessToken,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  },
  user: {},
  updatedAt: new Date('2026-01-02T03:04:05.000Z').toISOString(),
};

const projectConfig: ProjectConfig = {
  version: 1,
  environment: 'stage',
  spaceId,
  updatedAt: new Date('2026-01-02T03:04:05.000Z').toISOString(),
  configPath: '/tmp/project/.inventory/config.json',
  projectRoot: '/tmp/project',
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface MutableProductionState {
  assets: Asset[];
  variants: Variant[];
  records: ProductionRecord[];
  calls: string[];
  nextRecordNumber: number;
  nextTimestamp: number;
}

function createProductionState(): MutableProductionState {
  return {
    assets: [
      asset({ id: 'asset-1', name: 'Cocina' }),
      asset({ id: 'asset-2', name: 'Escalera', media_kind: 'video', active_variant_id: 'variant-2' }),
      asset({ id: 'asset-audio', name: 'Narration', media_kind: 'audio', active_variant_id: 'variant-audio' }),
    ],
    variants: [
      variant({ id: 'variant-1', asset_id: 'asset-1', media_kind: 'image' }),
      variant({
        id: 'variant-2',
        asset_id: 'asset-2',
        media_kind: 'video',
        image_key: null,
        thumb_key: null,
        media_key: 'videos/space-1/variant-2.mp4',
        media_mime_type: 'video/mp4',
        media_duration_ms: 8000,
      }),
      variant({
        id: 'variant-audio',
        asset_id: 'asset-audio',
        media_kind: 'audio',
        image_key: null,
        thumb_key: null,
        media_key: 'audio/space-1/variant-audio.wav',
        media_mime_type: 'audio/wav',
      }),
    ],
    records: [],
    calls: [],
    nextRecordNumber: 1,
    nextTimestamp: 1,
  };
}

function createSpaceBackedProductionApp(state: MutableProductionState): FetchLike {
  const app = createOpenApiRouter();
  const fakeSpacesDO = {
    idFromName: (id: string) => id,
    get: () => ({
      fetch: async (request: Request) => handleFakeSpaceDoRequest(state, request),
    }),
  };
  const deps = new Map<unknown, unknown>([
    [AuthService, { verifyJWT: async () => ({ userId: Number(userId) }) }],
    [MemberDAO, { getMember: async () => ({ space_id: spaceId, user_id: userId, role: 'editor', joined_at: Date.now() }) }],
  ]);

  app.use('*', async (c, next) => {
    c.env = {
      GOOGLE_CLIENT_ID: 'google-client',
      ENVIRONMENT: 'test',
      SPACES_DO: fakeSpacesDO,
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
  app.route('/', spaceRoutes);

  return async (input, init) => app.fetch(new Request(input, init));
}

async function handleFakeSpaceDoRequest(
  state: MutableProductionState,
  request: Request,
): Promise<Response> {
  const pathName = new URL(request.url).pathname;
  state.calls.push(`${request.method} ${pathName}`);

  if (request.method === 'GET' && pathName === '/internal/state') {
    return Response.json({ assets: state.assets, variants: state.variants });
  }

  const listMatch = pathName.match(/^\/internal\/production\/([^/]+)\/records$/);
  if (request.method === 'GET' && listMatch) {
    const requestedProductionId = decodeURIComponent(listMatch[1]);
    return Response.json({
      success: true,
      records: state.records.filter((record) => record.production_id === requestedProductionId),
    });
  }

  if (request.method === 'POST' && pathName === '/internal/production/placements') {
    const body = await request.json<PlaceProductionRecordRequest & { createdBy?: string }>();
    const variantRecord = state.variants.find((item) => item.id === body.variantId);
    if (!variantRecord) {
      return Response.json({ error: 'Variant not found' }, { status: 404 });
    }
    const assetRecord = state.assets.find((item) => item.id === variantRecord.asset_id);
    if (!assetRecord) {
      return Response.json({ error: 'Asset not found' }, { status: 404 });
    }

    const existingIndex = body.id
      ? state.records.findIndex((record) => record.id === body.id)
      : -1;
    const existing = existingIndex >= 0 ? state.records[existingIndex] : null;
    const record: ProductionRecord = {
      id: body.id || `record-${state.nextRecordNumber++}`,
      production_id: body.productionId,
      variant_id: body.variantId,
      asset_id: assetRecord.id,
      media_kind: variantRecord.media_kind,
      shot_id: body.shotId || null,
      scene_label: body.sceneLabel,
      timeline_start_ms: body.timelineStartMs,
      duration_ms: body.durationMs ?? null,
      motion_prompt: body.motionPrompt || null,
      source_refs: JSON.stringify(body.sourceRefs ?? []),
      source_variant_ids: JSON.stringify(body.sourceVariantIds ?? []),
      metadata: JSON.stringify(body.metadata ?? {}),
      created_by: body.createdBy || userId,
      created_at: existing?.created_at ?? state.nextTimestamp++,
      updated_at: state.nextTimestamp++,
    };

    if (existingIndex >= 0) {
      state.records[existingIndex] = record;
    } else {
      state.records.push(record);
    }
    return Response.json({ success: true, record });
  }

  const deleteMatch = pathName.match(/^\/internal\/production\/records\/([^/]+)$/);
  if (request.method === 'DELETE' && deleteMatch) {
    const recordId = decodeURIComponent(deleteMatch[1]);
    const previousLength = state.records.length;
    state.records = state.records.filter((record) => record.id !== recordId);
    return previousLength === state.records.length
      ? Response.json({ error: 'Production record not found' }, { status: 404 })
      : Response.json({ success: true });
  }

  return Response.json({ error: 'Unexpected SpaceDO route' }, { status: 404 });
}

function cliDepsFor(fetchImpl: FetchLike, output: string[] = [], downloads: unknown[] = []) {
  return {
    loadConfig: async () => storedConfig,
    loadProjectConfig: async () => projectConfig,
    resolveBaseUrl: () => baseUrl,
    fetch: fetchImpl as typeof fetch,
    downloadFile: async (input: unknown) => {
      downloads.push(input);
    },
    writeFile: async () => undefined,
    print: (message: string) => output.push(message),
  };
}

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    name: 'Cocina',
    type: 'scene',
    media_kind: 'image',
    tags: '',
    parent_asset_id: null,
    active_variant_id: 'variant-1',
    created_by: 'user-1',
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function variant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: 'variant-1',
    asset_id: 'asset-1',
    media_kind: 'image',
    workflow_id: null,
    status: 'completed',
    error_message: null,
    image_key: 'images/space-1/variant-1.png',
    thumb_key: 'images/space-1/variant-1_thumb.webp',
    media_key: 'images/space-1/variant-1.png',
    media_mime_type: 'image/png',
    media_size_bytes: 123,
    media_width: 1920,
    media_height: 1080,
    media_duration_ms: null,
    recipe: '{}',
    starred: false,
    created_by: 'user-1',
    created_at: 1,
    updated_at: 1,
    description: null,
    ...overrides,
  };
}

function productionRecord(overrides: Partial<ProductionRecord> = {}): ProductionRecord {
  return {
    id: 'record-1',
    production_id: productionId,
    variant_id: 'variant-1',
    asset_id: 'asset-1',
    media_kind: 'image',
    shot_id: 'shot-001',
    scene_label: 'Cocina',
    timeline_start_ms: 0,
    duration_ms: 8000,
    motion_prompt: 'slow push-in',
    source_refs: JSON.stringify(['script.md']),
    source_variant_ids: JSON.stringify(['source-variant']),
    metadata: JSON.stringify({ department: 'layout' }),
    created_by: 'user-1',
    created_at: 1,
    updated_at: 2,
    ...overrides,
  };
}

test('website/API and CLI share one Space-backed production workflow loop', async () => {
  const state = createProductionState();
  const appFetch = createSpaceBackedProductionApp(state);
  const authHeaders = { Authorization: `Bearer ${accessToken}` };

  const websiteCreated = await apiFetch('POST /api/spaces/:id/production/placements', {
    fetch: appFetch,
    baseUrl,
    headers: authHeaders,
    params: { id: spaceId },
    json: {
      id: 'record-web',
      productionId,
      variantId: 'variant-1',
      shotId: 'shot-001',
      sceneLabel: 'Cocina',
      timelineStartMs: 0,
      durationMs: 8000,
      motionPrompt: 'opening keyframe',
      sourceRefs: ['script.md'],
      metadata: { surface: 'website' },
    },
  });
  assert.equal(websiteCreated.record.production_id, productionId);
  assert.equal(websiteCreated.record.created_by, userId);

  const cliPlaceOutput: string[] = [];
  const cliPlaced = await executeProductions({
    positionals: ['place'],
    options: {
      id: 'record-cli',
      'production-id': productionId,
      variant: 'variant-2',
      'shot-id': 'shot-002',
      'scene-label': 'Escalera',
      'timeline-start-ms': '72760',
      'duration-ms': '8000',
      'motion-prompt': 'slow push-in',
      'source-variant-ids': 'variant-1',
      'metadata-json': '{"surface":"cli"}',
    },
  }, cliDepsFor(appFetch, cliPlaceOutput));
  assert.equal(cliPlaced.type, 'place');
  assert.equal(cliPlaced.record.id, 'record-cli');
  assert.match(cliPlaceOutput.join('\n'), /Placed variant-2 in production episode-01/);

  assert.deepEqual(state.records.map((record) => record.id), ['record-web', 'record-cli']);

  const websiteListed = await apiFetch('GET /api/spaces/:id/productions/:productionId/records', {
    fetch: appFetch,
    baseUrl,
    headers: authHeaders,
    params: { id: spaceId, productionId },
  });
  assert.deepEqual(websiteListed.records.map((record) => record.id), ['record-web', 'record-cli']);

  const cliListOutput: string[] = [];
  const cliListed = await executeProductions({
    positionals: ['list'],
    options: { 'production-id': productionId, json: 'true' },
  }, cliDepsFor(appFetch, cliListOutput));
  assert.equal(cliListed.type, 'list');
  assert.deepEqual(cliListed.records, websiteListed.records);
  const cliListJson = JSON.parse(cliListOutput.join('\n')) as Array<{
    id: string;
    mediaUrl: string;
    metadata: Record<string, unknown>;
  }>;
  assert.deepEqual(cliListJson.map((record) => record.id), ['record-web', 'record-cli']);
  assert.equal(cliListJson[0].mediaUrl, `${baseUrl}/api/spaces/${spaceId}/variants/variant-1/media`);
  assert.deepEqual(cliListJson.map((record) => record.metadata.surface), ['website', 'cli']);

  const websiteHandoff = createProductionHandoff({
    spaceId,
    productionId,
    records: websiteListed.records,
    assets: state.assets,
    variants: state.variants,
    baseUrl,
    generatedAt: new Date('2026-01-02T03:04:05.000Z'),
  });
  assert.deepEqual(websiteHandoff.records.map((record) => record.recordId), ['record-web', 'record-cli']);
  assert.equal(websiteHandoff.records[0].mediaUrl, `${baseUrl}/api/spaces/${spaceId}/variants/variant-1/media`);
  assert.equal(
    formatRemotionSceneArgs(websiteHandoff),
    [
      `--scene '0|Cocina|${baseUrl}/api/spaces/${spaceId}/variants/variant-1/media'`,
      `--scene '72760|Escalera|${baseUrl}/api/spaces/${spaceId}/variants/variant-2/media'`,
    ].join('\n'),
  );

  const cliExportOutput: string[] = [];
  const cliDownloads: unknown[] = [];
  const cliExported = await executeProductions({
    positionals: ['export'],
    options: { 'production-id': productionId, 'media-dir': 'handoff/media' },
  }, cliDepsFor(appFetch, cliExportOutput, cliDownloads));
  assert.equal(cliExported.type, 'export');
  assert.deepEqual(
    cliExported.records.map((record) => record.id),
    websiteHandoff.records.map((record) => record.recordId),
  );
  assert.deepEqual(
    cliDownloads.map((download) => (download as { requestPath: string }).requestPath),
    [
      `/api/spaces/${spaceId}/variants/variant-1/media`,
      `/api/spaces/${spaceId}/variants/variant-2/media`,
    ],
  );
  assert.equal(
    cliExported.content,
    [
      `--scene '0|Cocina|${path.resolve('handoff/media/0001-cocina-variant-1.png')}'`,
      `--scene '72760|Escalera|${path.resolve('handoff/media/0002-escalera-variant-2.mp4')}'`,
    ].join('\n'),
  );
  assert.deepEqual(cliExportOutput, [cliExported.content]);
  assert.deepEqual(state.calls, [
    'POST /internal/production/placements',
    'POST /internal/production/placements',
    `GET /internal/production/${productionId}/records`,
    `GET /internal/production/${productionId}/records`,
    `GET /internal/production/${productionId}/records`,
  ]);
});

test('website and CLI exports preserve Space-backed production record parity', async () => {
  const records = [
    productionRecord({
      id: 'record-audio',
      variant_id: 'variant-audio',
      asset_id: 'asset-audio',
      media_kind: 'audio',
      scene_label: 'Narration',
      timeline_start_ms: 500,
      created_at: 1,
    }),
    productionRecord({
      id: 'record-2',
      variant_id: 'variant-2',
      asset_id: 'asset-2',
      media_kind: 'video',
      shot_id: 'shot-002',
      scene_label: 'Escalera',
      timeline_start_ms: 72760,
      created_at: 2,
    }),
    productionRecord({
      id: 'record-1',
      variant_id: 'variant-1',
      asset_id: 'asset-1',
      media_kind: 'image',
      shot_id: 'shot-001',
      scene_label: 'Cocina',
      timeline_start_ms: 0,
      created_at: 3,
    }),
  ];
  const visualVariantOrder = ['variant-1', 'variant-2'];

  const websiteHandoff = createProductionHandoff({
    spaceId,
    productionId,
    records,
    assets: [
      asset({ id: 'asset-1', name: 'Cocina' }),
      asset({ id: 'asset-2', name: 'Escalera', media_kind: 'video', active_variant_id: 'variant-2' }),
      asset({ id: 'asset-audio', name: 'Narration', media_kind: 'audio', active_variant_id: 'variant-audio' }),
    ],
    variants: [
      variant({ id: 'variant-1', asset_id: 'asset-1', media_kind: 'image' }),
      variant({
        id: 'variant-2',
        asset_id: 'asset-2',
        media_kind: 'video',
        image_key: null,
        thumb_key: null,
        media_key: 'videos/space-1/variant-2.mp4',
        media_mime_type: 'video/mp4',
        media_duration_ms: 8000,
      }),
      variant({
        id: 'variant-audio',
        asset_id: 'asset-audio',
        media_kind: 'audio',
        image_key: null,
        thumb_key: null,
        media_key: 'audio/space-1/variant-audio.wav',
        media_mime_type: 'audio/wav',
      }),
    ],
    baseUrl,
    generatedAt: new Date('2026-01-02T03:04:05.000Z'),
  });

  assert.deepEqual(websiteHandoff.records.map((record) => record.recordId), [
    'record-1',
    'record-audio',
    'record-2',
  ]);
  assert.deepEqual(
    formatRemotionSceneArgs(websiteHandoff)
      .split('\n')
      .map((line) => line.match(/variants\/([^/]+)\/media/)?.[1]),
    visualVariantOrder,
  );

  const output: string[] = [];
  const requests: string[] = [];
  const downloads: unknown[] = [];
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    requests.push(String(input));
    return Response.json({ success: true, records });
  };

  const result = await executeProductions({
    positionals: ['export'],
    options: { 'production-id': productionId, 'media-dir': 'handoff/media' },
  }, {
    loadConfig: async () => storedConfig,
    loadProjectConfig: async () => projectConfig,
    resolveBaseUrl: () => baseUrl,
    fetch: fetchImpl as typeof fetch,
    downloadFile: async (input: unknown) => {
      downloads.push(input);
    },
    writeFile: async () => undefined,
    print: (message: string) => output.push(message),
  });

  assert.equal(result.type, 'export');
  assert.deepEqual(
    result.records.map((record) => record.id),
    websiteHandoff.records.map((record) => record.recordId),
  );
  assert.equal(requests[0], `${baseUrl}/api/spaces/${spaceId}/productions/${productionId}/records`);
  assert.deepEqual(
    downloads.map((download) => (download as { requestPath: string }).requestPath),
    visualVariantOrder.map((variantId) => `/api/spaces/${spaceId}/variants/${variantId}/media`),
  );
  assert.equal(
    result.content,
    [
      `--scene '0|Cocina|${path.resolve('handoff/media/0001-cocina-variant-1.png')}'`,
      `--scene '72760|Escalera|${path.resolve('handoff/media/0002-escalera-variant-2.mp4')}'`,
    ].join('\n'),
  );
  assert.deepEqual(output, [result.content]);
});
