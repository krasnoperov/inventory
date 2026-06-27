import { describe, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  ElevenLabsApiError,
  ElevenLabsAudioProvider,
  ElevenLabsMusicProvider,
  ElevenLabsSoundEffectProvider,
  getMimeTypeForElevenLabsOutputFormat,
  listElevenLabsVoices,
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
    assert.strictEqual(result.model, 'client-selected-model');
    assert.strictEqual(result.durationMs, 350);
    assert.strictEqual(decodeSidecar(result.transcript), 'Hello world');

    assert.strictEqual(calls.length, 1);
    assert.match(calls[0].url, /\/v1\/text-to-speech\/voice-1\/with-timestamps\?output_format=mp3_44100_128$/);
    assert.strictEqual((calls[0].init.headers as Record<string, string>)['xi-api-key'], 'key-1');
    assert.deepStrictEqual(JSON.parse(String(calls[0].init.body)), {
      text: 'Hello world',
      model_id: 'client-selected-model',
    });
  });

  test('defaults speech to eleven_v3 when no model is configured or requested', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = mock.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse(audioPayload());
    }) as unknown as typeof fetch;
    const provider = new ElevenLabsAudioProvider({
      apiKey: 'key-1',
      voiceId: 'voice-1',
      fetcher,
    });

    const result = await provider.generate({ prompt: 'Hello world' });

    assert.strictEqual(result.model, 'eleven_v3');
    assert.deepStrictEqual(JSON.parse(String(calls[0].init.body)), {
      text: 'Hello world',
      model_id: 'eleven_v3',
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
      model_id: 'client-selected-model',
    });

    const metadata = JSON.parse(decodeSidecar(result.renderMetadata));
    assert.deepStrictEqual(metadata.voices, [
      { speaker: 'Ada', voiceId: 'voice-a' },
      { speaker: 'Ben', voiceId: 'voice-b' },
    ]);
  });

  test('rejects dialogue when no voices are selected', async () => {
    const provider = new ElevenLabsAudioProvider({
      apiKey: 'key-1',
    });

    await assert.rejects(
      () => provider.generate({ prompt: 'Ada: Ready?\nBen: Always.' }),
      /Select a voice for each dialogue speaker \(2 of 2 still unset\)/
    );
  });

  test('rejects dialogue when a speaker slot is left blank (no default fallback)', async () => {
    const provider = new ElevenLabsAudioProvider({
      apiKey: 'key-1',
      // Speaker 1 blank, speaker 2 selected — no default voice fills the gap.
      dialogueVoiceIds: ['', 'voice-ben'],
    });

    await assert.rejects(
      () => provider.generate({ prompt: 'Ada: Ready?\nBen: Always.' }),
      /Select a voice for each dialogue speaker \(1 of 2 still unset\)/
    );
  });

  test('rejects speech generation when no voice is selected', async () => {
    const provider = new ElevenLabsAudioProvider({
      apiKey: 'key-1',
    });

    await assert.rejects(
      () => provider.generate({ prompt: 'Hello there' }),
      /Select a voice before generating speech/
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

  test('generates music through the stream endpoint with server-configured model', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = mock.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          'Content-Type': 'audio/mpeg',
          'character-cost': '41',
        },
      });
    }) as unknown as typeof fetch;
    const provider = new ElevenLabsMusicProvider({
      apiKey: 'key-1',
      modelId: 'music_v2',
      fetcher,
    });

    const result = await provider.generate({
      prompt: 'short heroic orchestral loop',
      model: 'client-selected-model',
    });

    assert.deepStrictEqual([...result.audioData], [1, 2, 3]);
    assert.strictEqual(result.audioMimeType, 'audio/mpeg');
    assert.strictEqual(result.model, 'music_v2');
    assert.strictEqual(result.durationMs, null);
    assert.deepStrictEqual(result.usage, {
      inputTokens: 41,
      outputTokens: 0,
      totalTokens: 41,
    });
    assert.strictEqual(calls[0].url, 'https://api.elevenlabs.io/v1/music/stream?output_format=mp3_44100_128');
    assert.deepStrictEqual(JSON.parse(String(calls[0].init.body)), {
      prompt: 'short heroic orchestral loop',
      model_id: 'music_v2',
    });
  });

  test('generates sound effects through the sound-generation endpoint', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = mock.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(new Uint8Array([4, 5, 6]), {
        status: 200,
        headers: {
          'Content-Type': 'audio/mpeg; charset=binary',
          'character-cost': '29',
        },
      });
    }) as unknown as typeof fetch;
    const provider = new ElevenLabsSoundEffectProvider({
      apiKey: 'key-1',
      fetcher,
    });

    const result = await provider.generate({
      prompt: 'heavy boot step on wet stone',
      model: 'client-selected-model',
    });

    assert.deepStrictEqual([...result.audioData], [4, 5, 6]);
    assert.strictEqual(result.audioMimeType, 'audio/mpeg');
    assert.strictEqual(result.model, 'eleven_text_to_sound_v2');
    assert.deepStrictEqual(result.usage, {
      inputTokens: 29,
      outputTokens: 0,
      totalTokens: 29,
    });
    assert.strictEqual(calls[0].url, 'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128');
    assert.deepStrictEqual(JSON.parse(String(calls[0].init.body)), {
      text: 'heavy boot step on wet stone',
      model_id: 'eleven_text_to_sound_v2',
    });
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

describe('listElevenLabsVoices', () => {
  test('maps the account voice library and sends the api key', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = mock.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({
        voices: [
          {
            voice_id: 'v1',
            name: 'Rachel',
            category: 'premade',
            description: 'calm narrator',
            preview_url: 'https://example.com/rachel.mp3',
            labels: { accent: 'american' },
          },
          { voice_id: 'v2' },
          { name: 'missing id' },
        ],
      });
    }) as unknown as typeof fetch;

    const voices = await listElevenLabsVoices('key-9', fetcher);

    assert.strictEqual(calls.length, 1);
    assert.match(calls[0].url, /\/v2\/voices/);
    assert.strictEqual((calls[0].init.headers as Record<string, string>)['xi-api-key'], 'key-9');
    assert.deepStrictEqual(voices, [
      {
        voiceId: 'v1',
        name: 'Rachel',
        category: 'premade',
        description: 'calm narrator',
        previewUrl: 'https://example.com/rachel.mp3',
        labels: { accent: 'american' },
      },
      {
        voiceId: 'v2',
        name: 'v2',
        category: null,
        description: null,
        previewUrl: null,
        labels: {},
      },
    ]);
  });

  test('throws ElevenLabsApiError on a failed response', async () => {
    const fetcher = mock.fn(async () => jsonResponse({ detail: 'unauthorized' }, 401)) as unknown as typeof fetch;
    await assert.rejects(
      () => listElevenLabsVoices('bad-key', fetcher),
      (err: unknown) => err instanceof ElevenLabsApiError && err.status === 401
    );
  });
});
