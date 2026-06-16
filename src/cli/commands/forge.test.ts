import test from 'node:test';
import assert from 'node:assert/strict';
import type { StoredConfig } from '../lib/types';
import type { BatchResult, GenerateResult, Variant } from '../lib/websocket-client';
import {
  executeForgeCommand,
  parseRefs,
  resolveReferenceVariantIds,
} from './forge';

const config: StoredConfig = {
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

function completedResult(overrides: Partial<Variant> = {}): GenerateResult {
  const variant = completedVariant({
    id: 'variant-out',
    asset_id: 'asset-out',
    image_key: 'images/space/variant-out.png',
    thumb_key: 'images/space/variant-out_thumb.webp',
    ...overrides,
  });

  return {
    type: 'generate:result',
    requestId: 'request-1',
    jobId: variant.id,
    success: true,
    variant,
  };
}

function completedVariant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: 'variant-out',
    asset_id: 'asset-out',
    media_kind: 'image',
    workflow_id: null,
    status: 'completed',
    error_message: null,
    image_key: 'images/space/variant-out.png',
    thumb_key: 'images/space/variant-out_thumb.webp',
    recipe: '{}',
    starred: false,
    created_by: 'user-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  };
}

class FakeClient {
  generateParams: unknown;
  refineParams: unknown;
  batchParams: unknown;
  syncHandler?: (state: { assets: unknown[]; variants: unknown[]; lineage: unknown[] }) => void;
  connected = false;
  disconnected = false;

  constructor(
    private state: { assets: unknown[]; variants: unknown[]; lineage: unknown[] } = {
      assets: [],
      variants: [],
      lineage: [],
    },
    private batchResult?: BatchResult
  ) {}

  async connect(): Promise<void> {
    this.connected = true;
  }

  disconnect(): void {
    this.disconnected = true;
  }

  requestSync(): void {
    this.syncHandler?.(this.state);
  }

  setOnSyncState(handler: (state: { assets: unknown[]; variants: unknown[]; lineage: unknown[] }) => void): void {
    this.syncHandler = handler;
  }

  async sendGenerateRequest(params: unknown): Promise<GenerateResult> {
    this.generateParams = params;
    return completedResult();
  }

  async sendRefineRequest(params: unknown): Promise<GenerateResult> {
    this.refineParams = params;
    return completedResult({ asset_id: 'asset-source' });
  }

  async sendBatchRequest(params: unknown): Promise<BatchResult> {
    this.batchParams = params;
    return this.batchResult || {
      type: 'batch:result',
      requestId: 'request-batch',
      batchId: 'batch-1',
      success: true,
      variants: [
        completedVariant({
          id: 'variant-batch-1',
          asset_id: 'asset-batch',
          image_key: 'images/space/variant-batch-1.png',
          created_at: 1,
        }),
        completedVariant({
          id: 'variant-batch-2',
          asset_id: 'asset-batch',
          image_key: 'images/space/variant-batch-2.png',
          created_at: 2,
        }),
      ],
      failed: [],
    };
  }
}

function depsFor(client: FakeClient) {
  const downloads: unknown[] = [];
  const manifests: unknown[] = [];
  const manifestRoots: Array<string | undefined> = [];

  return {
    deps: {
      loadConfig: async () => config,
      loadProjectConfig: async () => null,
      resolveBaseUrl: () => 'https://inventory-stage.example.test',
      createClient: async () => client,
      uploadLocalReference: async () => {
        throw new Error('unexpected upload');
      },
      downloadImage: async (input: unknown) => {
        downloads.push(input);
      },
      fileExists: async () => false,
      getWorkingDir: () => '/tmp/project/episode/scene',
      saveRunManifest: async (manifest: unknown, cwd?: string) => {
        manifests.push(manifest);
        manifestRoots.push(cwd);
        return '.inventory/runs/run-test.json';
      },
      createRunId: () => 'run-test',
    },
    downloads,
    manifests,
    manifestRoots,
  };
}

test('parseRefs trims comma-separated refs', () => {
  assert.deepEqual(parseRefs(' a , ./b.png,variant-c '), ['a', './b.png', 'variant-c']);
});

test('resolveReferenceVariantIds uploads local files and keeps variant IDs', async () => {
  const uploaded: string[] = [];
  const refs = await resolveReferenceVariantIds(
    ['./local.png', 'variant-existing'],
    {
      baseUrl: 'https://inventory-stage.example.test',
      accessToken: 'token',
      spaceId: 'space-1',
    },
    {
      fileExists: async (ref) => ref === './local.png',
      uploadLocalReference: async (input) => {
        uploaded.push(input.filePath);
        return {
          asset: { id: 'asset-ref', name: 'Reference', type: 'reference' },
          variant: {
            id: 'variant-uploaded',
            asset_id: 'asset-ref',
            image_key: 'images/ref.png',
            thumb_key: 'images/ref_thumb.webp',
            status: 'completed',
            recipe: '{}',
          },
        };
      },
    },
    [completedVariant({
      id: 'variant-existing',
      image_key: 'images/existing.png',
      thumb_key: 'images/existing_thumb.webp',
    })]
  );

  assert.deepEqual(refs, ['variant-uploaded', 'variant-existing']);
  assert.deepEqual(uploaded, ['./local.png']);
});

test('resolveReferenceVariantIds errors for missing path-like refs', async () => {
  await assert.rejects(
    () => resolveReferenceVariantIds(
      ['./missing.png'],
      {
        baseUrl: 'https://inventory-stage.example.test',
        accessToken: 'token',
        spaceId: 'space-1',
      },
      {
        fileExists: async () => false,
        uploadLocalReference: async () => {
          throw new Error('unexpected upload');
        },
      }
    ),
    /Reference file not found/
  );
});

test('resolveReferenceVariantIds errors for unknown typed variant refs', async () => {
  await assert.rejects(
    () => resolveReferenceVariantIds(
      ['variant-missing'],
      {
        baseUrl: 'https://inventory-stage.example.test',
        accessToken: 'token',
        spaceId: 'space-1',
      },
      {
        fileExists: async () => false,
        uploadLocalReference: async () => {
          throw new Error('unexpected upload');
        },
      },
      [completedVariant({ id: 'variant-existing' })]
    ),
    /Reference variant not found/
  );
});

test('resolveReferenceVariantIds errors for incomplete typed variant refs', async () => {
  await assert.rejects(
    () => resolveReferenceVariantIds(
      ['variant-pending'],
      {
        baseUrl: 'https://inventory-stage.example.test',
        accessToken: 'token',
        spaceId: 'space-1',
      },
      {
        fileExists: async () => false,
        uploadLocalReference: async () => {
          throw new Error('unexpected upload');
        },
      },
      [completedVariant({
        id: 'variant-pending',
        status: 'processing',
        image_key: null,
      })]
    ),
    /Reference variant is not completed/
  );
});

test('generate sends generate request and downloads completed image', async () => {
  const client = new FakeClient();
  const { deps, downloads } = depsFor(client);

  await executeForgeCommand('generate', {
    positionals: ['A', 'market', 'background'],
    options: {
      space: 'space-1',
      name: 'Market',
      type: 'scene',
      o: 'market.png',
    },
  }, deps);

  assert.equal(client.connected, true);
  assert.equal(client.disconnected, true);
  assert.deepEqual(client.generateParams, {
    name: 'Market',
    assetType: 'scene',
    prompt: 'A market background',
    aspectRatio: undefined,
    parentAssetId: undefined,
    disableStyle: false,
  });
  assert.deepEqual(downloads, [{
    baseUrl: 'https://inventory-stage.example.test',
    accessToken: 'token',
    imageKey: 'images/space/variant-out.png',
    outputPath: 'market.png',
    force: false,
  }]);
});

test('generate resolves missing space and env from project config', async () => {
  const client = new FakeClient();
  let loadedEnv = '';
  let clientEnv = '';
  let clientSpace = '';
  const downloads: unknown[] = [];

  await executeForgeCommand('generate', {
    positionals: ['A', 'market', 'background'],
    options: {
      name: 'Market',
      type: 'scene',
      o: 'market.png',
    },
  }, {
    loadConfig: async (env) => {
      loadedEnv = env;
      return config;
    },
    loadProjectConfig: async () => ({
      version: 1,
      environment: 'production',
      spaceId: 'space-project',
      updatedAt: new Date().toISOString(),
    }),
    resolveBaseUrl: () => 'https://inventory.example.test',
    createClient: async (env, spaceId) => {
      clientEnv = env;
      clientSpace = spaceId;
      return client;
    },
    uploadLocalReference: async () => {
      throw new Error('unexpected upload');
    },
    downloadImage: async (input: unknown) => {
      downloads.push(input);
    },
    fileExists: async () => false,
    saveRunManifest: async () => '.inventory/runs/run-test.json',
    createRunId: () => 'run-test',
  });

  assert.equal(loadedEnv, 'production');
  assert.equal(clientEnv, 'production');
  assert.equal(clientSpace, 'space-project');
  assert.equal(downloads.length, 1);
});

test('generate command flags override project config', async () => {
  const client = new FakeClient();
  let loadedEnv = '';
  let clientSpace = '';
  const downloads: unknown[] = [];

  await executeForgeCommand('generate', {
    positionals: ['A', 'market', 'background'],
    options: {
      env: 'stage',
      space: 'space-flag',
      name: 'Market',
      type: 'scene',
      o: 'market.png',
    },
  }, {
    loadConfig: async (env) => {
      loadedEnv = env;
      return config;
    },
    loadProjectConfig: async () => ({
      version: 1,
      environment: 'production',
      spaceId: 'space-project',
      updatedAt: new Date().toISOString(),
    }),
    resolveBaseUrl: () => 'https://inventory-stage.example.test',
    createClient: async (_env, spaceId) => {
      clientSpace = spaceId;
      return client;
    },
    uploadLocalReference: async () => {
      throw new Error('unexpected upload');
    },
    downloadImage: async (input: unknown) => {
      downloads.push(input);
    },
    fileExists: async () => false,
    saveRunManifest: async () => '.inventory/runs/run-test.json',
    createRunId: () => 'run-test',
  });

  assert.equal(loadedEnv, 'stage');
  assert.equal(clientSpace, 'space-flag');
  assert.equal(downloads.length, 1);
});

test('refine resolves variant asset from sync state and sends refine request', async () => {
  const sourceVariant = completedVariant({
    id: 'variant-source',
    asset_id: 'asset-source',
    image_key: 'images/source.png',
    thumb_key: 'images/source_thumb.webp',
  });
  const client = new FakeClient({ assets: [], variants: [sourceVariant], lineage: [] });
  const { deps } = depsFor(client);

  await executeForgeCommand('refine', {
    positionals: ['make', 'it', 'evening'],
    options: {
      space: 'space-1',
      variant: 'variant-source',
      o: 'evening.png',
    },
  }, deps);

  assert.deepEqual(client.refineParams, {
    assetId: 'asset-source',
    prompt: 'make it evening',
    sourceVariantIds: ['variant-source'],
    aspectRatio: undefined,
    disableStyle: false,
  });
});

test('derive sends uploaded and existing refs as referenceVariantIds', async () => {
  const existingVariant = completedVariant({
    id: 'variant-existing',
    image_key: 'images/existing.png',
    thumb_key: 'images/existing_thumb.webp',
  });
  const client = new FakeClient({ assets: [], variants: [existingVariant], lineage: [] });
  const downloads: unknown[] = [];
  const deps = {
    loadConfig: async () => config,
    loadProjectConfig: async () => null,
    resolveBaseUrl: () => 'https://inventory-stage.example.test',
    createClient: async () => client,
    uploadLocalReference: async () => ({
      asset: { id: 'asset-ref', name: 'Reference', type: 'reference' },
      variant: {
        id: 'variant-uploaded',
        asset_id: 'asset-ref',
        image_key: 'images/ref.png',
        thumb_key: 'images/ref_thumb.webp',
        status: 'completed',
        recipe: '{}',
      },
    }),
    downloadImage: async (input: unknown) => {
      downloads.push(input);
    },
    fileExists: async (ref: string) => ref === './local.png',
    saveRunManifest: async () => '.inventory/runs/run-test.json',
    createRunId: () => 'run-test',
  };

  await executeForgeCommand('derive', {
    positionals: ['combine', 'these'],
    options: {
      space: 'space-1',
      refs: './local.png,variant-existing',
      name: 'Composite',
      type: 'scene',
      o: 'composite.png',
    },
  }, deps);

  assert.deepEqual(client.generateParams, {
    name: 'Composite',
    assetType: 'scene',
    prompt: 'combine these',
    referenceVariantIds: ['variant-uploaded', 'variant-existing'],
    aspectRatio: undefined,
    parentAssetId: undefined,
    disableStyle: false,
  });
  assert.equal(downloads.length, 1);
});

test('batch sends batch request, downloads outputs, and writes manifest', async () => {
  const existingVariant = completedVariant({
    id: 'variant-existing',
    image_key: 'images/existing.png',
    thumb_key: 'images/existing_thumb.webp',
  });
  const client = new FakeClient({ assets: [], variants: [existingVariant], lineage: [] });
  const { deps, downloads, manifests } = depsFor(client);

  await executeForgeCommand('batch', {
    positionals: ['make', 'three', 'keyframes'],
    options: {
      space: 'space-1',
      refs: 'variant-existing',
      name: 'Market Keyframe',
      type: 'scene',
      count: '2',
      mode: 'set',
      'output-dir': 'keyframes',
    },
  }, deps);

  assert.deepEqual(client.batchParams, {
    name: 'Market Keyframe',
    assetType: 'scene',
    prompt: 'make three keyframes',
    count: 2,
    mode: 'set',
    referenceVariantIds: ['variant-existing'],
    aspectRatio: undefined,
    parentAssetId: undefined,
    disableStyle: false,
  });
  assert.deepEqual(downloads, [
    {
      baseUrl: 'https://inventory-stage.example.test',
      accessToken: 'token',
      imageKey: 'images/space/variant-batch-1.png',
      outputPath: 'keyframes/market-keyframe-01.png',
      force: false,
    },
    {
      baseUrl: 'https://inventory-stage.example.test',
      accessToken: 'token',
      imageKey: 'images/space/variant-batch-2.png',
      outputPath: 'keyframes/market-keyframe-02.png',
      force: false,
    },
  ]);
  assert.equal(manifests.length, 1);
  assert.equal((manifests[0] as { success: boolean }).success, true);
  assert.equal((manifests[0] as { workingDir: string }).workingDir, '/tmp/project/episode/scene');
  assert.deepEqual((manifests[0] as { failed: unknown[] }).failed, []);
  assert.deepEqual((manifests[0] as { referenceVariantIds: string[] }).referenceVariantIds, ['variant-existing']);
  assert.deepEqual((manifests[0] as { images: Array<{ variantId: string; localPath: string }> }).images.map((image) => ({
    variantId: image.variantId,
    localPath: image.localPath,
  })), [
    { variantId: 'variant-batch-1', localPath: 'keyframes/market-keyframe-01.png' },
    { variantId: 'variant-batch-2', localPath: 'keyframes/market-keyframe-02.png' },
  ]);
});

test('batch keeps completed outputs and manifest when a sibling variant fails', async () => {
  const existingVariant = completedVariant({
    id: 'variant-existing',
    image_key: 'images/existing.png',
    thumb_key: 'images/existing_thumb.webp',
  });
  const client = new FakeClient(
    { assets: [], variants: [existingVariant], lineage: [] },
    {
      type: 'batch:result',
      requestId: 'request-batch',
      batchId: 'batch-1',
      success: false,
      variants: [
        completedVariant({
          id: 'variant-batch-1',
          asset_id: 'asset-batch',
          image_key: 'images/space/variant-batch-1.png',
          created_at: 1,
        }),
      ],
      failed: [{ variantId: 'variant-batch-2', error: 'model refused frame' }],
    }
  );
  const { deps, downloads, manifests } = depsFor(client);

  await assert.rejects(
    () => executeForgeCommand('batch', {
      positionals: ['make', 'two', 'keyframes'],
      options: {
        space: 'space-1',
        refs: 'variant-existing',
        name: 'Market Keyframe',
        type: 'scene',
        count: '2',
        mode: 'set',
        'output-dir': 'keyframes',
      },
    }, deps),
    /Batch generation completed with 1 failure/
  );

  assert.deepEqual(downloads, [{
    baseUrl: 'https://inventory-stage.example.test',
    accessToken: 'token',
    imageKey: 'images/space/variant-batch-1.png',
    outputPath: 'keyframes/market-keyframe-01.png',
    force: false,
  }]);
  assert.equal(manifests.length, 1);
  assert.equal((manifests[0] as { success: boolean }).success, false);
  assert.deepEqual((manifests[0] as { failed: unknown[] }).failed, [
    { variantId: 'variant-batch-2', error: 'model refused frame' },
  ]);
  assert.deepEqual((manifests[0] as { images: Array<{ variantId: string; localPath: string }> }).images.map((image) => ({
    variantId: image.variantId,
    localPath: image.localPath,
  })), [
    { variantId: 'variant-batch-1', localPath: 'keyframes/market-keyframe-01.png' },
  ]);
});

test('batch saves manifest at inherited project root', async () => {
  const client = new FakeClient();
  const downloads: unknown[] = [];
  const manifestRoots: Array<string | undefined> = [];

  await executeForgeCommand('batch', {
    positionals: ['make', 'project', 'keyframes'],
    options: {
      name: 'Project Keyframe',
      type: 'scene',
      count: '2',
      'output-dir': 'keyframes',
    },
  }, {
    loadConfig: async () => config,
    loadProjectConfig: async () => ({
      version: 1,
      environment: 'stage',
      spaceId: 'space-project',
      updatedAt: new Date().toISOString(),
      configPath: '/tmp/project/.inventory/config.json',
      projectRoot: '/tmp/project',
    }),
    resolveBaseUrl: () => 'https://inventory-stage.example.test',
    createClient: async () => client,
    uploadLocalReference: async () => {
      throw new Error('unexpected upload');
    },
    downloadImage: async (input: unknown) => {
      downloads.push(input);
    },
    fileExists: async () => false,
    saveRunManifest: async (_manifest: unknown, cwd?: string) => {
      manifestRoots.push(cwd);
      return '/tmp/project/.inventory/runs/run-test.json';
    },
    createRunId: () => 'run-test',
  });

  assert.equal(downloads.length, 2);
  assert.deepEqual(manifestRoots, ['/tmp/project']);
});
