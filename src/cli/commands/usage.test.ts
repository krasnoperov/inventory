import test from 'node:test';
import assert from 'node:assert/strict';
import { executeUsage } from './usage';
import type { ProjectConfig } from '../lib/project-config';
import type { StoredConfig } from '../lib/types';

const summary = {
  success: true as const,
  spaceId: 'space-1',
  period: {
    from: '2026-06-01T00:00:00.000Z',
    to: '2026-06-30T23:59:59.999Z',
  },
  totals: {
    storageBytes: 1536,
    workflowRuns: 2,
    deliveryBytes: 256,
  },
  byType: [
    { usageType: 'storage' as const, unit: 'byte' as const, quantity: 1536, events: 2 },
    { usageType: 'workflow' as const, unit: 'run' as const, quantity: 2, events: 2 },
    { usageType: 'delivery' as const, unit: 'byte' as const, quantity: 256, events: 1 },
  ],
  byMediaKind: [
    { mediaKind: 'video' as const, storageBytes: 1536, workflowRuns: 2, deliveryBytes: 256, events: 5 },
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
      const requestUrl = String(url);
      const headers = init?.headers instanceof Headers
        ? init.headers
        : new Headers(init?.headers);
      requests.push({
        url: requestUrl,
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

test('usage summary reads the initialized project space with date bounds', async () => {
  const output: string[] = [];
  const { deps, requests } = depsFor(output);

  const result = await executeUsage({
    positionals: [],
    options: {
      from: '2026-06-01',
      to: '2026-06-30',
    },
  }, deps);

  assert.equal(result.type, 'summary');
  assert.equal(result.summary.totals.workflowRuns, 2);
  assert.deepEqual(requests, [{
    url: 'https://inventory.example.test/api/spaces/space-1/usage/summary?from=2026-06-01&to=2026-06-30',
    authorization: 'Bearer token-1',
    accept: 'application/json',
  }]);
  const text = output.join('\n');
  assert.match(text, /Storage:\s+1\.50 KiB/);
  assert.match(text, /Workflow runs:\s+2/);
  assert.match(text, /Delivery:\s+256 B/);
  assert.match(text, /video\s+1\.50 KiB\s+2\s+256 B\s+5/);
});

test('usage summary supports JSON output', async () => {
  const output: string[] = [];
  const { deps } = depsFor(output);

  await executeUsage({
    positionals: ['summary'],
    options: {
      json: 'true',
      space: 'space-override',
    },
  }, deps);

  const parsed = JSON.parse(output.join('\n'));
  assert.equal(parsed.spaceId, 'space-1');
  assert.equal(parsed.totals.storageBytes, 1536);
});
