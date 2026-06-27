import test from 'node:test';
import assert from 'node:assert/strict';
import { makeVariant } from '../component-stories/fixtures';
import { getAudioCardMetadata } from './assetCardMetadata';

test('getAudioCardMetadata extracts audio prompt, completed model, and selected voice', () => {
  const metadata = getAudioCardMetadata(makeVariant({
    media_kind: 'audio',
    recipe: JSON.stringify({
      prompt: 'A crisp UI confirmation chime with a short glassy tail.',
      model: 'requested-model',
      voiceId: 'voice-ada',
    }),
    provider_metadata: JSON.stringify({
      model: 'eleven_v3',
    }),
  }));

  assert.deepEqual(metadata, {
    name: null,
    prompt: 'A crisp UI confirmation chime with a short glassy tail.',
    model: 'eleven_v3',
    voice: 'voice-ada',
  });
});

test('getAudioCardMetadata formats named dialogue voices and falls back to provenance model', () => {
  const metadata = getAudioCardMetadata(makeVariant({
    media_kind: 'audio',
    recipe: JSON.stringify({
      prompt: 'Ada: Ready?\nBen: Always.',
      dialogueVoiceIds: ['voice-ada', 'voice-ben'],
    }),
    generation_provenance: JSON.stringify({
      model: 'legacy-audio-model',
    }),
    provider_metadata: JSON.stringify({
      voices: [
        { speaker: 'Ada', voiceId: 'voice-ada', name: 'Rachel' },
        { speaker: 'Ben', voiceId: 'voice-ben', name: 'Adam' },
      ],
    }),
  }));

  assert.equal(metadata.model, 'legacy-audio-model');
  assert.equal(metadata.voice, 'Ada: Rachel, Ben: Adam');
  assert.equal(metadata.prompt, 'Ada: Ready?\nBen: Always.');
});

test('getAudioCardMetadata surfaces top-level audio name', () => {
  const metadata = getAudioCardMetadata(makeVariant({
    media_kind: 'audio',
    recipe: JSON.stringify({
      name: 'Rachel',
      prompt: 'Hello there.',
    }),
  }));

  assert.equal(metadata.name, 'Rachel');
});

test('getAudioCardMetadata ignores non-audio variants and invalid metadata', () => {
  const metadata = getAudioCardMetadata(makeVariant({
    media_kind: 'image',
    recipe: '{bad',
    provider_metadata: '{bad',
  }));

  assert.deepEqual(metadata, {
    name: null,
    prompt: null,
    model: null,
    voice: null,
  });
});
