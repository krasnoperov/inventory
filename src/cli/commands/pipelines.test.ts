import test from 'node:test';
import assert from 'node:assert/strict';
import type { StoredConfig } from '../lib/types';
import type {
  PipelineClient,
  RotationPipelineResult,
} from '../lib/websocket-client';
import { executePipelineCommand } from './pipelines';

const config: StoredConfig = {
  environment: 'stage',
  baseUrl: 'https://makefx-stage.example.test',
  clientId: 'test',
  token: {
    accessToken: 'token',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  },
  user: {},
  updatedAt: new Date().toISOString(),
};

class FakePipelineClient implements PipelineClient {
  connected = false;
  disconnected = false;
  rotationParams: Parameters<PipelineClient['sendRotationRequest']>[0] | undefined;
  cancelledRotationSetId: string | undefined;
  connectionLoggingEnabled = true;

  setConnectionLogging(enabled: boolean): void {
    this.connectionLoggingEnabled = enabled;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  disconnect(): void {
    this.disconnected = true;
  }

  async sendRotationRequest(
    params: Parameters<PipelineClient['sendRotationRequest']>[0]
  ): Promise<RotationPipelineResult> {
    this.rotationParams = params;
    params.onStarted?.({
      type: 'rotation:started',
      requestId: 'request-rotation',
      rotationSetId: 'rotation-set-1',
      assetId: 'asset-rotation',
      totalSteps: 8,
      directions: ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'],
    });
    params.onStepCompleted?.({
      type: 'rotation:step_completed',
      rotationSetId: 'rotation-set-1',
      direction: 'SE',
      variantId: 'variant-se',
      step: 1,
      total: 8,
    });
    return {
      requestId: 'request-rotation',
      rotationSetId: 'rotation-set-1',
      assetId: 'asset-rotation',
      totalSteps: 8,
      directions: ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'],
      status: params.waitForCompletion === false ? 'started' : 'completed',
      views: params.waitForCompletion === false ? undefined : [],
    };
  }

  async cancelRotation(rotationSetId: string): Promise<{ type: 'rotation:cancelled'; rotationSetId: string }> {
    this.cancelledRotationSetId = rotationSetId;
    return { type: 'rotation:cancelled', rotationSetId };
  }
}

function depsFor(client: FakePipelineClient) {
  const printed: string[] = [];
  return {
    printed,
    deps: {
      loadConfig: async () => config,
      loadProjectConfig: async () => null,
      resolveBaseUrl: () => 'https://makefx-stage.example.test',
      createClient: async () => client,
      isRotationEnabled: () => true,
      print: (message: string) => printed.push(message),
    },
  };
}

test('rotation command is blocked before auth or WebSocket when feature flag is off', async () => {
  const client = new FakePipelineClient();
  let loadConfigCalled = false;
  let createClientCalled = false;

  await assert.rejects(
    executePipelineCommand('rotation', {
      positionals: [],
      options: {
        space: 'space-1',
        variant: 'variant-source',
      },
    }, {
      loadConfig: async () => {
        loadConfigCalled = true;
        return config;
      },
      loadProjectConfig: async () => null,
      resolveBaseUrl: () => 'https://makefx-stage.example.test',
      createClient: async () => {
        createClientCalled = true;
        return client;
      },
      isRotationEnabled: () => false,
      print: () => {},
    }),
    /Rotation features are disabled/
  );

  assert.equal(loadConfigCalled, false);
  assert.equal(createClientCalled, false);
  assert.equal(client.connected, false);
});

test('rotation command starts a configured pipeline and can detach', async () => {
  const client = new FakePipelineClient();
  const { deps } = depsFor(client);

  const result = await executePipelineCommand('rotation', {
    positionals: [],
    options: {
      space: 'space-1',
      variant: 'variant-source',
      config: '8-directional',
      subject: 'armored hero',
      aspect: '1:1',
      mode: 'single-shot',
      'no-style': 'true',
      detach: 'true',
      timeout: '42',
    },
  }, deps);

  assert.equal(client.connected, true);
  assert.equal(client.disconnected, true);
  assert.equal('status' in result, true);
  if (!('status' in result)) throw new Error('expected pipeline result');
  assert.equal(result.status, 'started');
  assert.deepEqual(client.rotationParams, {
    sourceVariantId: 'variant-source',
    config: '8-directional',
    subjectDescription: 'armored hero',
    aspectRatio: '1:1',
    disableStyle: true,
    generationMode: 'single-shot',
    waitForCompletion: false,
    timeoutMs: 42_000,
    onStarted: client.rotationParams?.onStarted,
    onStepCompleted: client.rotationParams?.onStepCompleted,
  });
});

test('pipeline json output disables WebSocket lifecycle logs before connect', async () => {
  const client = new FakePipelineClient();
  const { deps, printed } = depsFor(client);

  await executePipelineCommand('rotation', {
    positionals: [],
    options: {
      space: 'space-1',
      variant: 'variant-source',
      json: 'true',
    },
  }, deps);

  assert.equal(client.connected, true);
  assert.equal(client.connectionLoggingEnabled, false);
  assert.doesNotThrow(() => JSON.parse(printed.join('\n')));
});

test('pipeline pretty output leaves WebSocket lifecycle logs enabled', async () => {
  const client = new FakePipelineClient();
  const { deps } = depsFor(client);

  await executePipelineCommand('rotation', {
    positionals: [],
    options: {
      space: 'space-1',
      variant: 'variant-source',
    },
  }, deps);

  assert.equal(client.connected, true);
  assert.equal(client.connectionLoggingEnabled, true);
});

test('pipeline cancel command sends the matching cancel message', async () => {
  const client = new FakePipelineClient();
  const { deps } = depsFor(client);

  const rotation = await executePipelineCommand('rotation', {
    positionals: ['cancel', 'rotation-set-1'],
    options: { space: 'space-1' },
  }, deps);

  assert.deepEqual(rotation, { type: 'rotation:cancelled', rotationSetId: 'rotation-set-1' });
  assert.equal(client.cancelledRotationSetId, 'rotation-set-1');
});
