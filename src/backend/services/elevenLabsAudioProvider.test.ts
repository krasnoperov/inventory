import { describe, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  ElevenLabsApiError,
  ElevenLabsAudioProvider,
  getMimeTypeForElevenLabsOutputFormat,
  parseElevenLabsDialoguePrompt,
} from './elevenLabsAudioProvider';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function audioPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    audio_base64: btoa('audio-data'),
    alignment: {
      characters: ['H', 'i'],
      character_start_times_seconds: [0, 0.1],
      character_end_times_seconds: [0.1, 0.35],
    },
    normalized_alignment: null,
    ...overrides,
  };
}

function decodeSidecar(sidecar: { data: Uint8Array } | undefined): string {
  assert.ok(sidecar);
  return new TextDecoder().decode(sidecar.data);
}

describe('ElevenLabsAudioProvider', () => {
  test('generates speech through the timestamped speech endpoint', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = mock.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse(audioPayload());
    }) as unknown as typeof fetch;
    const provider = new ElevenLabsAudioProvider({
      apiKey: 'key-1',
      voiceId: 'voice-1',
      modelId: 'eleven_multilingual_v2',
      fetcher,
    });

    const result = await provider.generate({ prompt: 'Hello world', model: 'client-selected-model' });

    assert.strictEqual(result.audioMimeType, 'audio/mpeg');
    assert.strictEqual(new TextDecoder().decode(result.audioData), 'audio-data');
    assert.strictEqual(result.model, 'eleven_multilingual_v2');
    assert.strictEqual(result.durationMs, 350);
    assert.strictEqual(decodeSidecar(result.transcript), 'Hello world');

    assert.strictEqual(calls.length, 1);
    assert.match(calls[0].url, /\/v1\/text-to-speech\/voice-1\/with-timestamps\?output_format=mp3_44100_128$/);
    assert.strictEqual((calls[0].init.headers as Record<string, string>)['xi-api-key'], 'key-1');
    assert.deepStrictEqual(JSON.parse(String(calls[0].init.body)), {
      text: 'Hello world',
      model_id: 'eleven_multilingual_v2',
    });
  });

  test('generates labelled dialogue through the dialogue endpoint', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = mock.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse(audioPayload({
        voice_segments: [
          {
            voice_id: 'voice-a',
            start_time_seconds: 0,
            end_time_seconds: 1.2,
            character_start_index: 0,
            character_end_index: 5,
            dialogue_input_index: 0,
          },
        ],
      }));
    }) as unknown as typeof fetch;
    const provider = new ElevenLabsAudioProvider({
      apiKey: 'key-1',
      voiceId: 'fallback',
      dialogueVoiceIds: ['voice-a', 'voice-b'],
      modelId: 'eleven_v3',
      outputFormat: 'wav_44100',
      fetcher,
    });

    const result = await provider.generate({
      prompt: 'Ada: Ready?\nBen: Always.',
      model: 'client-selected-model',
    });

    assert.strictEqual(result.audioMimeType, 'audio/wav');
    assert.strictEqual(result.durationMs, 1200);
    assert.strictEqual(decodeSidecar(result.transcript), 'Ada: Ready?\nBen: Always.');

    assert.strictEqual(calls.length, 1);
    assert.match(calls[0].url, /\/v1\/text-to-dialogue\/with-timestamps\?output_format=wav_44100$/);
    assert.deepStrictEqual(JSON.parse(String(calls[0].init.body)), {
      inputs: [
        { text: 'Ready?', voice_id: 'voice-a' },
        { text: 'Always.', voice_id: 'voice-b' },
      ],
      model_id: 'eleven_v3',
    });

    const metadata = JSON.parse(decodeSidecar(result.renderMetadata));
    assert.deepStrictEqual(metadata.voices, [
      { speaker: 'Ada', voiceId: 'voice-a' },
      { speaker: 'Ben', voiceId: 'voice-b' },
    ]);
  });

  test('rejects dialogue when not enough voice IDs are configured', async () => {
    const provider = new ElevenLabsAudioProvider({
      apiKey: 'key-1',
      voiceId: 'only-voice',
    });

    await assert.rejects(
      () => provider.generate({ prompt: 'Ada: Ready?\nBen: Always.' }),
      /ELEVENLABS_DIALOGUE_VOICE_IDS must include at least 2 voice IDs/
    );
  });

  test('marks validation failures as non-retryable API errors', async () => {
    const fetcher = mock.fn(async () => jsonResponse({ detail: 'bad request' }, 422)) as unknown as typeof fetch;
    const provider = new ElevenLabsAudioProvider({
      apiKey: 'key-1',
      voiceId: 'voice-1',
      fetcher,
    });

    await assert.rejects(
      () => provider.generate({ prompt: 'Hello' }),
      (error) => error instanceof ElevenLabsApiError && error.status === 422 && !error.retryable
    );
  });

  test('parses dialogue prompts conservatively', () => {
    assert.deepStrictEqual(parseElevenLabsDialoguePrompt('Ada: Ready?\nBen: Always.'), [
      { speaker: 'Ada', text: 'Ready?' },
      { speaker: 'Ben', text: 'Always.' },
    ]);
    assert.strictEqual(parseElevenLabsDialoguePrompt('A scene: with one colon'), null);
    assert.strictEqual(getMimeTypeForElevenLabsOutputFormat('mp3_22050_32'), 'audio/mpeg');
  });
});
