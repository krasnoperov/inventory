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

function newClient(): { client: WebSocketClient; internals: Internals; sentMessages: unknown[] } {
  const client = new WebSocketClient('https://inventory.example.test', 'token-1', 'stage', 'space-1');
  const internals = client as unknown as Internals;
  const sentMessages: unknown[] = [];
  internals.ws = {
    readyState: WebSocket.OPEN,
    send: (data: string) => sentMessages.push(JSON.parse(data)),
  };
  return { client, internals, sentMessages };
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

test('rotation pipeline waits for the matching terminal event after progress', async () => {
  const { client, internals, sentMessages } = newClient();
  const steps: unknown[] = [];
  const promise = client.sendRotationRequest({
    sourceVariantId: 'variant-source',
    config: '4-directional',
    onStepCompleted: (step) => steps.push(step),
  });

  const request = sentMessages[0] as { type: string; requestId: string; sourceVariantId: string };
  assert.equal(request.type, 'rotation:request');
  assert.equal(request.sourceVariantId, 'variant-source');

  internals.handleMessage({
    type: 'rotation:started',
    requestId: request.requestId,
    rotationSetId: 'rotation-set-1',
    assetId: 'asset-rotation',
    totalSteps: 4,
    directions: ['S', 'E', 'N', 'W'],
  });
  internals.handleMessage({
    type: 'rotation:step_completed',
    rotationSetId: 'rotation-set-1',
    direction: 'E',
    variantId: 'variant-east',
    step: 1,
    total: 4,
  });

  assert.equal(await isPending(promise), true, 'rotation resolved before terminal event');
  assert.equal(steps.length, 1);

  internals.handleMessage({
    type: 'rotation:completed',
    rotationSetId: 'rotation-set-1',
    views: [{ id: 'view-1', rotation_set_id: 'rotation-set-1', variant_id: 'variant-east', direction: 'E', step_index: 1, created_at: 1 }],
  });

  const result = await promise;
  assert.equal(result.status, 'completed');
  assert.equal(result.rotationSetId, 'rotation-set-1');
  assert.equal(result.views?.length, 1);
});

test('rotation pipeline detach resolves on started and server errors reject pending pipelines', async () => {
  const first = newClient();
  const detached = first.client.sendRotationRequest({
    sourceVariantId: 'variant-source',
    config: '4-directional',
    waitForCompletion: false,
  });
  const startRequest = first.sentMessages[0] as { requestId: string };
  first.internals.handleMessage({
    type: 'rotation:started',
    requestId: startRequest.requestId,
    rotationSetId: 'rotation-set-1',
    assetId: 'asset-rotation',
    totalSteps: 4,
    directions: ['S', 'E', 'N', 'W'],
  });
  assert.equal((await detached).status, 'started');

  const second = newClient();
  const pending = second.client.sendRotationRequest({
    sourceVariantId: 'variant-source',
    config: '4-directional',
  });
  second.internals.handleMessage({
    type: 'error',
    code: 'VALIDATION_ERROR',
    message: 'Source variant must be completed with an image',
  });
  await assert.rejects(pending, /VALIDATION_ERROR: Source variant must be completed with an image/);
});
