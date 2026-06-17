import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import type { ProjectConfig } from '../lib/project-config';
import type { StoredConfig } from '../lib/types';
import type { ProductionRecord } from '../../shared/api/schemas';
import { executeProductions } from './productions';

const storedConfig: StoredConfig = {
  environment: 'stage',
  baseUrl: 'https://inventory-stage.example.test',
  clientId: 'test',
  token: {
    accessToken: 'token',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  },
  user: {},
  updatedAt: new Date().toISOString(),
};

const projectConfig: ProjectConfig = {
  version: 1,
  environment: 'stage',
  spaceId: 'space-1',
  updatedAt: new Date().toISOString(),
  configPath: '/tmp/project/.inventory/config.json',
  projectRoot: '/tmp/project',
};

function productionRecord(overrides: Partial<ProductionRecord> = {}): ProductionRecord {
  return {
    id: 'record-1',
    production_id: 'episode-01',
    variant_id: 'variant-video',
    asset_id: 'asset-video',
    media_kind: 'video',
    shot_id: 'shot-001',
    scene_label: 'Market',
    timeline_start_ms: 1000,
    duration_ms: 8000,
    motion_prompt: 'slow push-in',
    source_refs: JSON.stringify(['variant-keyframe']),
    source_variant_ids: JSON.stringify(['variant-keyframe']),
    metadata: JSON.stringify({ command: 'derive' }),
    created_by: 'user-1',
    created_at: 1,
    updated_at: 2,
    ...overrides,
  };
}

function depsFor(fetchImpl: typeof fetch, output: string[]) {
  return {
    loadConfig: async () => storedConfig,
    loadProjectConfig: async () => projectConfig,
    resolveBaseUrl: () => 'https://inventory-stage.example.test',
    fetch: fetchImpl,
    writeFile,
    print: (message: string) => output.push(message),
  };
}

test('productions list reads Space-backed records and prints media URLs', async () => {
  const output: string[] = [];
  const requests: string[] = [];
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    requests.push(String(input));
    return Response.json({ success: true, records: [productionRecord()] });
  };

  const result = await executeProductions({
    positionals: ['list'],
    options: { 'production-id': 'episode-01' },
  }, depsFor(fetchImpl as typeof fetch, output));

  assert.equal(result.type, 'list');
  assert.equal(result.records.length, 1);
  assert.equal(requests[0], 'https://inventory-stage.example.test/api/spaces/space-1/productions/episode-01/records');
  assert.match(output.join('\n'), /Found 1 production record/);
  assert.match(output.join('\n'), /variant-video/);
});

test('productions export emits scene args from Space records', async () => {
  const output: string[] = [];
  const fetchImpl = async (): Promise<Response> => Response.json({
    success: true,
    records: [
      productionRecord({ id: 'record-2', variant_id: 'variant-2', scene_label: 'Escalera', timeline_start_ms: 72760 }),
      productionRecord({ id: 'record-1', variant_id: 'variant-1', scene_label: 'Cocina', timeline_start_ms: 0 }),
    ],
  });

  const result = await executeProductions({
    positionals: ['export'],
    options: { 'production-id': 'episode-01' },
  }, depsFor(fetchImpl as typeof fetch, output));

  assert.equal(result.type, 'export');
  const lines = output.join('\n').split('\n');
  assert.equal(lines[0], "--scene '0|Cocina|https://inventory-stage.example.test/api/spaces/space-1/variants/variant-1/media'");
  assert.equal(lines[1], "--scene '72760|Escalera|https://inventory-stage.example.test/api/spaces/space-1/variants/variant-2/media'");
});

test('productions export fails clearly when no Space records exist', async () => {
  const output: string[] = [];
  const fetchImpl = async (): Promise<Response> => Response.json({ success: true, records: [] });

  await assert.rejects(
    () => executeProductions({
      positionals: ['export'],
      options: { 'production-id': 'missing-production' },
    }, depsFor(fetchImpl as typeof fetch, output)),
    /No production records found for production ID: missing-production/
  );
});

test('productions export scene args skip non-visual records', async () => {
  const output: string[] = [];
  const fetchImpl = async (): Promise<Response> => Response.json({
    success: true,
    records: [
      productionRecord({ id: 'audio-record', media_kind: 'audio', variant_id: 'variant-audio' }),
      productionRecord({ id: 'video-record', media_kind: 'video', variant_id: 'variant-video' }),
    ],
  });

  await executeProductions({
    positionals: ['export'],
    options: { 'production-id': 'episode-01' },
  }, depsFor(fetchImpl as typeof fetch, output));

  const sceneArgs = output.join('\n');
  assert.match(sceneArgs, /variant-video/);
  assert.doesNotMatch(sceneArgs, /variant-audio/);
});

test('productions place posts timeline placement metadata', async () => {
  const output: string[] = [];
  let postedBody: unknown;
  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    postedBody = JSON.parse(String(init?.body));
    return Response.json({ success: true, record: productionRecord({ id: 'record-placed', variant_id: 'variant-placed' }) });
  };

  const result = await executeProductions({
    positionals: ['place'],
    options: {
      'production-id': 'episode-01',
      variant: 'variant-placed',
      'scene-label': 'Market',
      'timeline-start-ms': '1200',
      'duration-ms': '8000',
      'shot-id': 'shot-001',
      'motion-prompt': 'slow push-in',
      'source-variant-ids': 'variant-keyframe',
      'metadata-json': '{"source":"shotlist"}',
    },
  }, depsFor(fetchImpl as typeof fetch, output));

  assert.equal(result.type, 'place');
  assert.deepEqual(postedBody, {
    productionId: 'episode-01',
    variantId: 'variant-placed',
    shotId: 'shot-001',
    sceneLabel: 'Market',
    timelineStartMs: 1200,
    durationMs: 8000,
    motionPrompt: 'slow push-in',
    sourceVariantIds: ['variant-keyframe'],
    metadata: { source: 'shotlist' },
  });
  assert.match(output.join('\n'), /Placed variant-placed/);
});

test('productions delete removes a Space-backed record', async () => {
  const output: string[] = [];
  const requests: Array<{ url: string; method?: string }> = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push({ url: String(input), method: init?.method });
    return Response.json({ success: true });
  };

  const result = await executeProductions({
    positionals: ['delete', 'record-1'],
    options: {},
  }, depsFor(fetchImpl as typeof fetch, output));

  assert.equal(result.type, 'delete');
  assert.deepEqual(requests, [{
    url: 'https://inventory-stage.example.test/api/spaces/space-1/production/records/record-1',
    method: 'DELETE',
  }]);
  assert.match(output.join('\n'), /Deleted production record: record-1/);
});
