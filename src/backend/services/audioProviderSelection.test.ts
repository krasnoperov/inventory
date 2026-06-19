import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAudioProvider } from './audioProviderSelection';

describe('resolveAudioProvider', () => {
  test('defaults to ElevenLabs in production', () => {
    assert.equal(resolveAudioProvider({ ENVIRONMENT: 'production' }), 'elevenlabs');
  });

  test('defaults to the fake provider outside production', () => {
    assert.equal(resolveAudioProvider({ ENVIRONMENT: 'local' }), 'fake');
    assert.equal(resolveAudioProvider({ ENVIRONMENT: 'stage' }), 'fake');
    assert.equal(resolveAudioProvider({}), 'fake');
  });

  test('honours an explicit override in any environment', () => {
    assert.equal(
      resolveAudioProvider({ ENVIRONMENT: 'production', INVENTORY_AUDIO_PROVIDER: 'fake' }),
      'fake'
    );
    assert.equal(
      resolveAudioProvider({ ENVIRONMENT: 'local', INVENTORY_AUDIO_PROVIDER: 'elevenlabs' }),
      'elevenlabs'
    );
  });
});
