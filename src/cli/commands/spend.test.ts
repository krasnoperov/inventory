import test from 'node:test';
import assert from 'node:assert/strict';
import { executeSpend } from './spend';
import type { ProjectConfig } from '../lib/project-config';
import type { StoredConfig } from '../lib/types';

const summary = {
  success: true as const,
  period: {
    from: '2026-06-01',
    to: '2026-06-30',
  },
  filters: {
    userId: 42,
    spaceId: 'space-1',
    provider: 'gemini',
    mediaKind: 'image' as const,
  },
  totals: {
    amountMicroUsd: 306000,
    amountUsd: 0.306,
    quantity: 3,
    entries: 3,
    unpricedEntries: 1,
  },
  byProvider: [
    { provider: 'gemini', amountMicroUsd: 306000, amountUsd: 0.306, quantity: 3, entries: 3, unpricedEntries: 1 },
  ],
  byModel: [
    {
      provider: 'gemini',
      providerModel: 'gemini-3-pro-image-preview',
      amountMicroUsd: 306000,
      amountUsd: 0.306,
      quantity: 3,
      entries: 3,
      unpricedEntries: 1,
    },
  ],
  byMediaKind: [
    { mediaKind: 'image' as const, amountMicroUsd: 306000, amountUsd: 0.306, quantity: 3, entries: 3, unpricedEntries: 1 },
  ],
  byMeterEventName: [
    { meterEventName: 'gemini_images', amountMicroUsd: 240000, amountUsd: 0.24, quantity: 1, entries: 1, unpricedEntries: 0 },
    { meterEventName: 'gemini_output_tokens', amountMicroUsd: 66000, amountUsd: 0.066, quantity: 2, entries: 2, unpricedEntries: 1 },
  ],
};

function projectConfig(): ProjectConfig {
  return {
    version: 1,
    environment: 'stage',
    spaceId: 'space-1',
    updatedAt: '2026-06-16T00:00:00.000Z',
    configPath: '/tmp/project/.inventory/config.json',
    projectRoot: '/tmp/project',
  };
}

function storedConfig(): StoredConfig {
  return {
    environment: 'stage',
    baseUrl: 'https://inventory.example.test',
    clientId: 'makefx-cli',
    token: {
      accessToken: 'token-1',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
    user: null,
    updatedAt: '2026-06-16T00:00:00.000Z',
  };
}

function depsFor(output: string[]) {
  const requests: Array<{ url: string; authorization: string | null; accept: string | null }> = [];
  const deps = {
    loadConfig: async () => storedConfig(),
    loadProjectConfig: async () => projectConfig(),
    resolveBaseUrl: () => 'https://inventory.example.test',
    fetch: async (url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers instanceof Headers
        ? init.headers
        : new Headers(init?.headers);
      requests.push({
        url: String(url),
        authorization: headers.get('authorization'),
        accept: headers.get('accept'),
      });
      return new Response(JSON.stringify(summary), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
    print: (message: string) => output.push(message),
  };
  return { deps, requests };
}

test('spend summary sends admin filters and prints totals', async () => {
  const output: string[] = [];
  const { deps, requests } = depsFor(output);

  const result = await executeSpend({
    positionals: [],
    options: {
      from: '2026-06-01',
      to: '2026-06-30',
      'user-id': '42',
      space: 'space-1',
      provider: 'gemini',
      'media-kind': 'image',
    },
  }, deps);

  assert.equal(result.type, 'summary');
  assert.deepEqual(requests, [{
    url: 'https://inventory.example.test/api/billing/spend/summary?from=2026-06-01&to=2026-06-30&user_id=42&space_id=space-1&provider=gemini&media_kind=image',
    authorization: 'Bearer token-1',
    accept: 'application/json',
  }]);
  const text = output.join('\n');
  assert.match(text, /Total spend:\s+\$0\.306/);
  assert.match(text, /Unpriced:\s+1/);
  assert.match(text, /gemini\s+\$0\.306\s+3\s+1\s+3/);
  assert.match(text, /gemini_images\s+\$0\.24\s+1\s+0\s+1/);
});

test('spend summary supports JSON output', async () => {
  const output: string[] = [];
  const { deps } = depsFor(output);

  await executeSpend({
    positionals: ['summary'],
    options: {
      json: 'true',
    },
  }, deps);

  const parsed = JSON.parse(output.join('\n'));
  assert.equal(parsed.totals.amountMicroUsd, 306000);
  assert.equal(parsed.byProvider[0].provider, 'gemini');
});
