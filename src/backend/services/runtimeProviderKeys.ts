import type { Env } from '../../core/types';
import { keyBrokerClient } from '../key-broker/client';
import type { ProviderKeyProvider } from './providerKeyVault';
import { resolveStoredProviderApiKey } from './providerKeyVault';

export async function resolveRuntimeProviderApiKey(
  env: Env,
  userId: number,
  provider: ProviderKeyProvider,
): Promise<string | undefined> {
  if (env.KEY_BROKER) {
    const resolved = await keyBrokerClient(env.KEY_BROKER).resolveProviderKey({
      tenant: { type: 'user', userId },
      provider,
      purpose: 'runtime',
    });
    return resolved.apiKey ?? undefined;
  }

  return resolveStoredProviderApiKey(env.DB, userId, provider, env);
}
