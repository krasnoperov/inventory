import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import WebSocket from 'ws';
import {
  GENERATION_REQUEST_TIMEOUT_MS,
  VIDEO_GENERATION_REQUEST_TIMEOUT_MS,
  getGenerationRequestTimeoutMs,
  WebSocketClient,
} from './websocket-client';

test('generation request timeout matches backend media workflow limits', () => {
  assert.equal(getGenerationRequestTimeoutMs(), GENERATION_REQUEST_TIMEOUT_MS);
  assert.equal(getGenerationRequestTimeoutMs('image'), GENERATION_REQUEST_TIMEOUT_MS);
  assert.equal(getGenerationRequestTimeoutMs('audio'), GENERATION_REQUEST_TIMEOUT_MS);
  assert.equal(getGenerationRequestTimeoutMs('video'), VIDEO_GENERATION_REQUEST_TIMEOUT_MS);

  assert.ok(VIDEO_GENERATION_REQUEST_TIMEOUT_MS > 10 * 60 * 1000);
});

// Reach into the private message pump + socket to drive broadcasts without a
// real connection. These guard the mutation-waiter correlation: a mutation must
// resolve only on the broadcast that reflects *its* change, not on any unrelated
// real-time update for the same entity.
interface Internals {
  ws: unknown;
  handleMessage(message: unknown): void;
}

function newClient(): { client: WebSocketClient; internals: Internals } {
  const client = new WebSocketClient('https://inventory.example.test', 'token-1', 'stage', 'space-1');
  const internals = client as unknown as Internals;
  internals.ws = { readyState: WebSocket.OPEN, send: () => {} };
  return { client, internals };
}

async function isPending(promise: Promise<unknown>): Promise<boolean> {
  const sentinel = Symbol('pending');
  promise.catch(() => {});
  const winner = await Promise.race([promise.then(() => 'settled', () => 'settled'), tick(sentinel)]);
  return winner === sentinel;
}

test('renameAsset ignores an unrelated asset:updated for the same asset', async () => {
  const { client, internals } = newClient();
  const promise = client.renameAsset('asset-1', 'New Name');

  // Concurrent edit keeps the old name — must NOT resolve the rename.
  internals.handleMessage({ type: 'asset:updated', asset: { id: 'asset-1', name: 'Old Name', type: null, active_variant_id: null } });
  assert.equal(await isPending(promise), true, 'rename resolved on an unrelated broadcast');

  internals.handleMessage({ type: 'asset:updated', asset: { id: 'asset-1', name: 'New Name', type: null, active_variant_id: 'v1' } });
  assert.equal((await promise).name, 'New Name');
});

test('rateVariant ignores variant:updated that does not carry the new rating', async () => {
  const { client, internals } = newClient();
  const promise = client.rateVariant('variant-1', 'rejected');

  // A star toggle on the same variant broadcasts variant:updated without our rating.
  internals.handleMessage({ type: 'variant:updated', variant: { id: 'variant-1', starred: true, quality_rating: null, status: 'completed' } });
  assert.equal(await isPending(promise), true, 'rate resolved on an unrelated broadcast');

  internals.handleMessage({ type: 'variant:updated', variant: { id: 'variant-1', starred: true, quality_rating: 'rejected', status: 'completed' } });
  assert.equal((await promise).quality_rating, 'rejected');
});

test('starVariant resolves only when the starred flag matches the request', async () => {
  const { client, internals } = newClient();
  const promise = client.starVariant('variant-1', true);

  internals.handleMessage({ type: 'variant:updated', variant: { id: 'variant-1', starred: false, status: 'completed' } });
  assert.equal(await isPending(promise), true, 'star resolved on the wrong starred value');

  internals.handleMessage({ type: 'variant:updated', variant: { id: 'variant-1', starred: true, status: 'completed' } });
  assert.equal((await promise).starred, true);
});

test('a server error rejects the in-flight mutation with the server reason', async () => {
  const { client, internals } = newClient();
  const promise = client.deleteAsset('asset-1');

  internals.handleMessage({ type: 'error', code: 'PERMISSION_DENIED', message: 'owner role required' });
  await assert.rejects(promise, /PERMISSION_DENIED: owner role required/);
});
