import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioProvider } from './fakeAudioProvider';

describe('FakeAudioProvider', () => {
  test('generates a deterministic WAV artifact', async () => {
    const provider = new FakeAudioProvider();

    const result = await provider.generate({ prompt: 'A short theme' });

    assert.strictEqual(result.audioMimeType, 'audio/wav');
    assert.strictEqual(result.model, 'fake-audio-v1');
    assert.strictEqual(result.durationMs, 250);
    assert.ok(result.audioData.byteLength > 44);
    assert.strictEqual(new TextDecoder().decode(result.audioData.slice(0, 4)), 'RIFF');
    assert.strictEqual(new TextDecoder().decode(result.audioData.slice(8, 12)), 'WAVE');
  });
});

