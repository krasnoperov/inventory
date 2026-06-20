import type { Env } from '../../core/types';
import { keyBrokerClient } from '../key-broker/client';
import { createKeyBrokerService } from '../key-broker/service';
import type { KeyBrokerService } from '../key-broker/contract';
import type { ProviderKeyProvider } from './providerKeyVault';

export type ProviderKeySource = 'platform' | 'byok';

export interface ResolvedGenerationProviderKey {
  apiKey?: string;
  keySource?: ProviderKeySource;
}

export interface GenerationProviderKeyContext {
  userId: string;
  jobId: string;
  requestId: string;
  spaceId: string;
}

type GenerationProviderKeyEnv = Pick<
  Env,
  'DB' | 'ENCRYPTION_KEY' | 'ENVIRONMENT' | 'KEY_BROKER'
>;

function parseRuntimeUserId(userId: string): number | null {
  if (!/^\d+$/.test(userId)) return null;
  const numericUserId = Number.parseInt(userId, 10);
  return Number.isSafeInteger(numericUserId) && numericUserId > 0 ? numericUserId : null;
}

function providerKeyBrokerForEnv(env: GenerationProviderKeyEnv): KeyBrokerService | null {
  if (env.KEY_BROKER) {
    return keyBrokerClient(env.KEY_BROKER);
  }

  if (env.ENVIRONMENT === 'local') {
    return createKeyBrokerService({
      DB: env.DB,
      BYOK_ACTIVE_KEK_VERSION: '1',
      BYOK_KEK_V1: env.ENCRYPTION_KEY,
    });
  }

  return null;
}

/**
 * Generation provider credentials prefer a customer's stored BYOK key and fall
 * back to the managed platform key only when the customer has no usable account
 * key for that provider.
 */
export async function resolveGenerationProviderApiKey(
  env: GenerationProviderKeyEnv,
  context: GenerationProviderKeyContext,
  provider: ProviderKeyProvider,
  platformKey?: string
): Promise<ResolvedGenerationProviderKey> {
  const numericUserId = parseRuntimeUserId(context.userId);
  const broker = numericUserId ? providerKeyBrokerForEnv(env) : null;

  if (numericUserId && broker) {
    const resolved = await broker.resolveProviderKey({
      tenant: { type: 'user', userId: numericUserId },
      provider,
      purpose: 'generation',
      generation: {
        jobId: context.jobId,
        requestId: context.requestId,
        spaceId: context.spaceId,
      },
    });
    if (resolved.apiKey) {
      return { apiKey: resolved.apiKey, keySource: 'byok' };
    }
  }

  return platformKey ? { apiKey: platformKey, keySource: 'platform' } : {};
}
