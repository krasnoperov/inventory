import test from 'node:test';
import assert from 'node:assert/strict';
import type { StoredConfig } from '../lib/types';
import type { GenerateResult, Variant } from '../lib/websocket-client';
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
  const variant: Variant = {
    id: 'variant-out',
    asset_id: 'asset-out',
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

  return {
    type: 'generate:result',
    requestId: 'request-1',
    jobId: variant.id,
    success: true,
    variant,
  };
}

class FakeClient {
  generateParams: unknown;
  refineParams: unknown;
  syncHandler?: (state: { assets: unknown[]; variants: unknown[]; lineage: unknown[] }) => void;
  connected = false;
  disconnected = false;

  constructor(
    private state: { assets: unknown[]; variants: unknown[]; lineage: unknown[] } = {
      assets: [],
      variants: [],
      lineage: [],
    }
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
}

function depsFor(client: FakeClient) {
  const downloads: unknown[] = [];

  return {
    deps: {
      loadConfig: async () => config,
      resolveBaseUrl: () => 'https://inventory-stage.example.test',
      createClient: async () => client,
      uploadLocalReference: async () => {
        throw new Error('unexpected upload');
      },
      downloadImage: async (input: unknown) => {
        downloads.push(input);
      },
      fileExists: async () => false,
    },
    downloads,
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
    }
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

test('refine resolves variant asset from sync state and sends refine request', async () => {
  const sourceVariant: Variant = {
    id: 'variant-source',
    asset_id: 'asset-source',
    workflow_id: null,
    status: 'completed',
    error_message: null,
    image_key: 'images/source.png',
    thumb_key: 'images/source_thumb.webp',
    recipe: '{}',
    starred: false,
    created_by: 'user-1',
    created_at: Date.now(),
    updated_at: Date.now(),
  };
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
  const client = new FakeClient();
  const downloads: unknown[] = [];
  const deps = {
    loadConfig: async () => config,
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
