import type { Env } from '../../core/types';
import {
  resolveStoredProviderApiKey,
  type ProviderKeyProvider,
} from './providerKeyVault';

export type ProviderKeySource = 'platform' | 'byok';

export interface ResolvedGenerationProviderKey {
  apiKey?: string;
  keySource?: ProviderKeySource;
}

/**
 * Generation provider credentials prefer a customer's stored BYOK key and fall
 * back to the managed platform key only when the customer has no usable account
 * key for that provider.
 */
export async function resolveGenerationProviderApiKey(
  env: Pick<Env, 'DB' | 'ENCRYPTION_KEY'>,
  userId: string,
  provider: ProviderKeyProvider,
  platformKey?: string
): Promise<ResolvedGenerationProviderKey> {
  if (/^\d+$/.test(userId)) {
    const numericUserId = Number.parseInt(userId, 10);
    const stored = await resolveStoredProviderApiKey(env.DB, numericUserId, provider, env);
    if (stored) {
      return { apiKey: stored, keySource: 'byok' };
    }
  }
  return platformKey ? { apiKey: platformKey, keySource: 'platform' } : {};
}
