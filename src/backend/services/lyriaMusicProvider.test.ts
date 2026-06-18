import { describe, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { LyriaApiError, LyriaMusicProvider } from './lyriaMusicProvider';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function decodeSidecar(sidecar: { data: Uint8Array } | undefined): string {
  assert.ok(sidecar);
  return new TextDecoder().decode(sidecar.data);
}

describe('LyriaMusicProvider', () => {
  test('generates music through the Lyria 3 interactions endpoint', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = mock.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({
        status: 'completed',
        model: 'lyria-3-pro-preview',
        steps: [
          {
            type: 'model_output',
            content: [
              { type: 'text', text: 'Instrumental heroic cue' },
            ],
          },
          {
            type: 'model_output',
            content: [
              { type: 'audio', mime_type: 'audio/mpeg', data: btoa('lyria-audio') },
            ],
          },
        ],
        usage: {
          total_input_tokens: 12,
          total_output_tokens: 34,
          total_tokens: 46,
        },
      });
    }) as unknown as typeof fetch;
    const provider = new LyriaMusicProvider({
      projectId: 'project-1',
      accessToken: 'token-1',
      modelId: 'lyria-3-pro-preview',
      fetcher,
      baseUrl: 'https://aiplatform.example.test',
    });

    const result = await provider.generate({ prompt: 'A heroic orchestral loop' });

    assert.strictEqual(new TextDecoder().decode(result.audioData), 'lyria-audio');
    assert.strictEqual(result.audioMimeType, 'audio/mpeg');
    assert.strictEqual(result.model, 'lyria-3-pro-preview');
    assert.strictEqual(result.durationMs, null);
    assert.deepStrictEqual(result.usage, {
      inputTokens: 12,
      outputTokens: 34,
      totalTokens: 46,
    });
    assert.strictEqual(
      calls[0].url,
      'https://aiplatform.example.test/v1beta1/projects/project-1/locations/global/interactions'
    );
    assert.strictEqual((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer token-1');
    assert.deepStrictEqual(JSON.parse(String(calls[0].init.body)), {
      model: 'lyria-3-pro-preview',
      input: [{ type: 'text', text: 'A heroic orchestral loop' }],
    });
    const metadata = JSON.parse(decodeSidecar(result.renderMetadata));
    assert.strictEqual(metadata.provider, 'lyria');
    assert.strictEqual(metadata.description, 'Instrumental heroic cue');
  });

  test('generates music through the Lyria 2 predict endpoint', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = mock.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({
        predictions: [
          { audioContent: btoa('wav-data'), mimeType: 'audio/wav' },
        ],
        model: 'projects/project-1/locations/us-central1/publishers/google/models/lyria-002',
        modelDisplayName: 'Lyria 2',
      });
    }) as unknown as typeof fetch;
    const provider = new LyriaMusicProvider({
      projectId: 'project-1',
      apiKey: 'key-1',
      location: 'us-central1',
      modelId: 'lyria-002',
      fetcher,
      baseUrl: 'https://aiplatform.example.test',
    });

    const result = await provider.generate({ prompt: 'A warm acoustic bed' });

    assert.strictEqual(new TextDecoder().decode(result.audioData), 'wav-data');
    assert.strictEqual(result.audioMimeType, 'audio/wav');
    assert.strictEqual(result.durationMs, 32_800);
    assert.strictEqual(
      calls[0].url,
      'https://aiplatform.example.test/v1/projects/project-1/locations/us-central1/publishers/google/models/lyria-002:predict?key=key-1'
    );
    assert.deepStrictEqual(JSON.parse(String(calls[0].init.body)), {
      instances: [{ prompt: 'A warm acoustic bed' }],
      parameters: { sample_count: 1 },
    });
  });

  test('classifies client errors as non-retryable', async () => {
    const fetcher = mock.fn(async () => jsonResponse({ error: { message: 'bad prompt' } }, 400)) as unknown as typeof fetch;
    const provider = new LyriaMusicProvider({
      projectId: 'project-1',
      accessToken: 'token-1',
      fetcher,
    });

    await assert.rejects(
      () => provider.generate({ prompt: 'bad prompt' }),
      (error) => error instanceof LyriaApiError && error.status === 400 && !error.retryable
    );
  });
});
