import type { Env } from '../../core/types';

export type AudioProviderName = 'fake' | 'elevenlabs';

/**
 * Resolve the active audio provider.
 *
 * Production always uses ElevenLabs (real audio); every other environment
 * defaults to the fake provider so local/CI never hit a paid API.
 * `INVENTORY_AUDIO_PROVIDER` stays as an explicit override for any environment
 * (e.g. exercising ElevenLabs locally) but never needs to be set in prod.
 *
 * There is intentionally no per-account default voice — the voice is chosen per
 * generation in the UI / CLI, never baked into deployment config.
 */
export function resolveAudioProvider(
  env: Pick<Env, 'INVENTORY_AUDIO_PROVIDER' | 'ENVIRONMENT'>
): AudioProviderName {
  if (env.INVENTORY_AUDIO_PROVIDER) {
    return env.INVENTORY_AUDIO_PROVIDER;
  }
  return env.ENVIRONMENT === 'production' ? 'elevenlabs' : 'fake';
}
