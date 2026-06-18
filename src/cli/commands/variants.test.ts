import test from 'node:test';
import assert from 'node:assert/strict';
import { executeVariants } from './variants';
import type { ProjectConfig } from '../lib/project-config';
import type { StoredConfig } from '../lib/types';

const variant = {
  id: 'variant-1',
  asset_id: 'asset-1',
  media_kind: 'video' as const,
  workflow_id: null,
  status: 'pending' as const,
  error_message: null,
  image_key: null,
  thumb_key: null,
  media_key: null,
  recipe: '{}',
  starred: false,
  created_by: 'user-1',
  created_at: Date.UTC(2026, 5, 16, 10, 0, 0),
  updated_at: Date.UTC(2026, 5, 16, 11, 0, 0),
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
    token: { accessToken: 'token-1', issuedAt: Date.now(), expiresAt: Date.now() + 60_000 },
    user: null,
    updatedAt: '2026-06-16T00:00:00.000Z',
  };
}

function depsFor(output: string[]) {
  const calls: string[] = [];
  const deps = {
    loadConfig: async () => storedConfig(),
    loadProjectConfig: async () => projectConfig(),
    resolveBaseUrl: () => 'https://inventory.example.test',
    createMutationClient: async () => ({
      connect: async () => { calls.push('connect'); },
      disconnect: () => { calls.push('disconnect'); },
      deleteVariant: async (id: string) => { calls.push(`deleteVariant:${id}`); },
      retryVariant: async (id: string) => { calls.push(`retryVariant:${id}`); return { ...variant, id, status: 'pending' as const }; },
      starVariant: async (id: string, starred: boolean) => { calls.push(`starVariant:${id}:${starred}`); return { ...variant, id, starred }; },
      rateVariant: async (id: string, rating: 'approved' | 'rejected') => { calls.push(`rateVariant:${id}:${rating}`); return { ...variant, id }; },
    }),
    print: (message: string) => output.push(message),
  };
  return { deps, calls };
}

test('variants delete sends a delete mutation and confirms', async () => {
  const output: string[] = [];
  const { deps, calls } = depsFor(output);

  const result = await executeVariants({ positionals: ['delete', 'variant-1'], options: {} }, deps);

  assert.equal(result.type, 'delete');
  assert.deepEqual(calls, ['connect', 'deleteVariant:variant-1', 'disconnect']);
  assert.match(output.join('\n'), /Deleted variant variant-1/);
});

test('variants retry re-queues the variant', async () => {
  const output: string[] = [];
  const { deps, calls } = depsFor(output);

  const result = await executeVariants({ positionals: ['retry', 'variant-1'], options: {} }, deps);

  assert.equal(result.type, 'retry');
  assert.deepEqual(calls, ['connect', 'retryVariant:variant-1', 'disconnect']);
  assert.match(output.join('\n'), /Re-queued variant variant-1/);
});

test('variants star and unstar pass the correct flag', async () => {
  const starOut: string[] = [];
  const star = depsFor(starOut);
  await executeVariants({ positionals: ['star', 'variant-1'], options: {} }, star.deps);
  assert.deepEqual(star.calls, ['connect', 'starVariant:variant-1:true', 'disconnect']);
  assert.match(starOut.join('\n'), /Starred variant variant-1/);

  const unstarOut: string[] = [];
  const unstar = depsFor(unstarOut);
  await executeVariants({ positionals: ['unstar', 'variant-1'], options: {} }, unstar.deps);
  assert.deepEqual(unstar.calls, ['connect', 'starVariant:variant-1:false', 'disconnect']);
  assert.match(unstarOut.join('\n'), /Unstarred variant variant-1/);
});

test('variants rate validates the rating value', async () => {
  const output: string[] = [];
  const { deps, calls } = depsFor(output);

  const result = await executeVariants({ positionals: ['rate', 'variant-1', 'approved'], options: {} }, deps);
  assert.equal(result.type, 'rate');
  assert.deepEqual(calls, ['connect', 'rateVariant:variant-1:approved', 'disconnect']);

  await assert.rejects(
    () => executeVariants({ positionals: ['rate', 'variant-1', 'meh'], options: {} }, depsFor([]).deps),
    /approved\|rejected/
  );
});

test('variants requires a variant id', async () => {
  await assert.rejects(
    () => executeVariants({ positionals: ['delete'], options: {} }, depsFor([]).deps),
    /Variant ID is required/
  );
});

test('variants rejects unknown subcommands', async () => {
  await assert.rejects(
    () => executeVariants({ positionals: ['frobnicate', 'variant-1'], options: {} }, depsFor([]).deps),
    /Unknown variants command/
  );
});
