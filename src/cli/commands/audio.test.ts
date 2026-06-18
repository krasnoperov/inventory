import test from 'node:test';
import assert from 'node:assert/strict';
import type { StoredConfig } from '../lib/types';
import { executeAudio, parseAudioInvocation } from './audio';

const config: StoredConfig = {
  environment: 'stage',
  baseUrl: 'https://makefx-stage.example.test',
  clientId: 'test',
  token: {
    accessToken: 'token',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  },
  user: {},
  updatedAt: new Date().toISOString(),
};

test('parseAudioInvocation accepts voices command', () => {
  assert.deepEqual(parseAudioInvocation(['voices']), {
    command: 'voices',
    positionals: [],
  });
});

test('audio voices fetches authenticated voice library and prints table', async () => {
  const output: string[] = [];
  let requestedUrl = '';
  let authorization = '';

  const result = await executeAudio({
    positionals: ['voices'],
    options: {},
  }, {
    loadConfig: async () => config,
    loadProjectConfig: async () => null,
    resolveBaseUrl: () => 'https://makefx-stage.example.test',
    fetch: async (url, init) => {
      requestedUrl = String(url);
      authorization = new Headers(init?.headers).get('authorization') || '';
      return Response.json({
        available: true,
        voices: [{
          voiceId: 'voice-ada',
          name: 'Ada',
          category: 'cloned',
          description: 'Calm engineer',
          previewUrl: null,
          labels: { accent: 'neutral' },
        }],
      });
    },
    print: (message) => output.push(message),
    executeAudioCommand: async () => {
      throw new Error('unexpected generation command');
    },
  });

  assert.equal(requestedUrl, 'https://makefx-stage.example.test/api/voices');
  assert.equal(authorization, 'Bearer token');
  assert.ok('available' in result);
  assert.equal(result.available, true);
  assert.equal(result.voices[0].voiceId, 'voice-ada');
  assert.ok(output.join('\n').includes('voice-ada'));
});

test('audio voices supports json output', async () => {
  const output: string[] = [];

  await executeAudio({
    positionals: ['voices'],
    options: { json: 'true' },
  }, {
    loadConfig: async () => config,
    loadProjectConfig: async () => null,
    resolveBaseUrl: () => 'https://makefx-stage.example.test',
    fetch: async () => Response.json({ available: false, voices: [] }),
    print: (message) => output.push(message),
    executeAudioCommand: async () => {
      throw new Error('unexpected generation command');
    },
  });

  assert.deepEqual(JSON.parse(output[0]), { available: false, voices: [] });
});
