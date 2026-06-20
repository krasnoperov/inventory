import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Env } from '../../core/types';
import type {
  KeyBrokerService,
  ResolveProviderKeyRequest,
  RotateTenantDekRequest,
  RewrapAllDeksRequest,
} from '../key-broker/contract';
import {
  type GenerationProviderKeyContext,
  resolveGenerationProviderApiKey,
} from './generationProviderKeys';

const generationContext: GenerationProviderKeyContext = {
  userId: '7',
  jobId: 'variant-1',
  requestId: 'request-1',
  spaceId: 'space-1',
};

function brokerStub(options: {
  apiKey?: string | null;
  reject?: Error;
  calls?: ResolveProviderKeyRequest[];
}): KeyBrokerService {
  return {
    async storeProviderKey() {
      throw new Error('not implemented');
    },
    async deleteProviderKey() {
      throw new Error('not implemented');
    },
    async resolveProviderKey(request) {
      options.calls?.push(request);
      if (options.reject) throw options.reject;
      return {
        tenant: request.tenant,
        provider: request.provider,
        apiKey: options.apiKey ?? null,
        keySource: options.apiKey ? 'byok' : 'missing',
      };
    },
    async rotateTenantDek(request: RotateTenantDekRequest) {
      return { tenant: request.tenant, status: 'not_implemented' };
    },
    async rewrapAllDeks(_request: RewrapAllDeksRequest) {
      return { status: 'not_implemented' };
    },
  };
}

describe('resolveGenerationProviderApiKey', () => {
  test('prefers an authorized customer BYOK key over the managed platform key', async () => {
    const calls: ResolveProviderKeyRequest[] = [];
    const env = {
      KEY_BROKER: brokerStub({ apiKey: 'user-google-key', calls }),
    } as unknown as Env;

    assert.deepEqual(
      await resolveGenerationProviderApiKey(env, generationContext, 'google_ai', 'platform-google-key'),
      { apiKey: 'user-google-key', keySource: 'byok' }
    );

    assert.deepEqual(calls, [{
      tenant: { type: 'user', userId: 7 },
      provider: 'google_ai',
      purpose: 'generation',
      generation: {
        jobId: 'variant-1',
        requestId: 'request-1',
        spaceId: 'space-1',
      },
    }]);
  });

  test('falls back to the managed platform key when the broker reports no customer key', async () => {
    const calls: ResolveProviderKeyRequest[] = [];
    const env = {
      KEY_BROKER: brokerStub({ apiKey: null, calls }),
    } as unknown as Env;

    assert.deepEqual(
      await resolveGenerationProviderApiKey(env, generationContext, 'elevenlabs', 'platform-elevenlabs-key'),
      { apiKey: 'platform-elevenlabs-key', keySource: 'platform' }
    );
    assert.equal(calls.length, 1);
  });

  test('returns no key when neither BYOK nor managed credentials are available', async () => {
    const env = {
      KEY_BROKER: brokerStub({ apiKey: null }),
    } as unknown as Env;

    assert.deepEqual(
      await resolveGenerationProviderApiKey(env, generationContext, 'lyria'),
      {}
    );
  });

  test('does not query BYOK storage for non-user runtime identities', async () => {
    const calls: ResolveProviderKeyRequest[] = [];
    const env = {
      KEY_BROKER: brokerStub({ apiKey: 'user-google-key', calls }),
    } as unknown as Env;

    assert.deepEqual(
      await resolveGenerationProviderApiKey(
        env,
        { ...generationContext, userId: 'user-7' },
        'google_ai',
        'platform-google-key'
      ),
      { apiKey: 'platform-google-key', keySource: 'platform' }
    );
    assert.deepEqual(
      await resolveGenerationProviderApiKey(
        env,
        { ...generationContext, userId: '7abc' },
        'google_ai',
        'platform-google-key'
      ),
      { apiKey: 'platform-google-key', keySource: 'platform' }
    );
    assert.deepEqual(
      await resolveGenerationProviderApiKey(
        env,
        { ...generationContext, userId: '0' },
        'google_ai',
        'platform-google-key'
      ),
      { apiKey: 'platform-google-key', keySource: 'platform' }
    );
    assert.equal(calls.length, 0);
  });

  test('does not fall back to platform credentials when the broker denies the generation', async () => {
    const env = {
      KEY_BROKER: brokerStub({ reject: new Error('Key broker generation authorization denied') }),
    } as unknown as Env;

    await assert.rejects(
      resolveGenerationProviderApiKey(env, generationContext, 'google_ai', 'platform-google-key'),
      /authorization denied/i
    );
  });
});
