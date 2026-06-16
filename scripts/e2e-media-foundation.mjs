#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import WebSocket from 'ws';

const root = process.cwd();
const tmpRoot = path.join(root, 'tmp', 'media-foundation-e2e');
const persistDir = path.join(tmpRoot, 'wrangler-state');
const port = process.env.INVENTORY_E2E_PORT || String(await findFreePort());
const baseUrl = `http://127.0.0.1:${port}`;
const wsBaseUrl = `ws://127.0.0.1:${port}`;
const token = process.env.INVENTORY_E2E_TOKEN || 'inventory-dev-token';
const authHeaders = { Authorization: `Bearer ${token}` };
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);
const audioBytes = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]);
const videoBytes = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate a free port')));
        return;
      }
      const allocatedPort = address.port;
      server.close(() => resolve(allocatedPort));
    });
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || root,
      env: { ...process.env, ...options.env },
      stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
      options.onStdout?.(chunk.toString());
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
      options.onStderr?.(chunk.toString());
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited ${code}\n${stdout}\n${stderr}`));
      }
    });
  });
}

async function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  const closed = new Promise((resolve) => {
    child.once('close', resolve);
  });

  const signal = (value) => {
    try {
      process.kill(-child.pid, value);
    } catch {
      child.kill(value);
    }
  };

  signal('SIGINT');
  const result = await Promise.race([closed, wait(5_000).then(() => 'timeout')]);
  if (result === 'timeout' && child.exitCode === null && child.signalCode === null) {
    signal('SIGKILL');
    await closed;
  }
}

async function waitForWorker(worker) {
  const started = Date.now();
  while (Date.now() - started < 45_000) {
    if (worker.exitCode !== null || worker.signalCode !== null) {
      throw new Error(`Worker exited before it became ready (exit=${worker.exitCode}, signal=${worker.signalCode})`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/spaces`, { headers: authHeaders });
      if (response.status !== 503 && response.status !== 404) return;
    } catch {
      // Worker is still booting.
    }
    await wait(500);
  }
  throw new Error(`Timed out waiting for worker at ${baseUrl}`);
}

async function api(pathname, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers });
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${pathname} failed: ${response.status} ${await response.text()}`);
  }
  return response;
}

async function createSpace() {
  const response = await api('/api/spaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Media Foundation E2E ${Date.now()}` }),
  });
  const data = await response.json();
  return data.space.id;
}

async function uploadMedia(spaceId, input) {
  const formData = new FormData();
  formData.append('file', new File([input.bytes], input.filename, { type: input.mimeType }));
  formData.append('assetName', input.assetName);
  formData.append('assetType', input.assetType);

  const response = await api(`/api/spaces/${spaceId}/upload`, {
    method: 'POST',
    body: formData,
  });
  const body = await response.json();
  if (!body.success || !body.variant?.id) {
    throw new Error(`Unexpected upload response: ${JSON.stringify(body, null, 2)}`);
  }
  if (body.variant.status !== 'completed') {
    throw new Error(`Expected completed upload variant, got ${body.variant.status}`);
  }
  if (body.variant.media_kind !== input.mediaKind) {
    throw new Error(`Expected ${input.mediaKind} media kind, got ${body.variant.media_kind}`);
  }
  if (body.variant.media_mime_type !== input.mimeType) {
    throw new Error(`Expected ${input.mimeType} media MIME, got ${body.variant.media_mime_type}`);
  }

  return body.variant;
}

async function assertDownloadedMedia(spaceId, variant, expected) {
  const response = await api(`/api/spaces/${spaceId}/variants/${variant.id}/media`);
  const contentType = response.headers.get('content-type');
  if (contentType !== expected.mimeType) {
    throw new Error(`Expected ${expected.mimeType} download, got ${contentType}`);
  }
  const cacheControl = response.headers.get('cache-control');
  if (cacheControl !== 'private, max-age=31536000, immutable') {
    throw new Error(`Unexpected media cache-control: ${cacheControl}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== expected.bytes.length) {
    throw new Error(`Expected ${expected.bytes.length} bytes for ${variant.id}, got ${bytes.length}`);
  }
  for (let index = 0; index < expected.bytes.length; index += 1) {
    if (bytes[index] !== expected.bytes[index]) {
      throw new Error(`Downloaded media byte mismatch for ${variant.id} at offset ${index}`);
    }
  }
}

async function assertRangeDownload(spaceId, variant) {
  const response = await api(`/api/spaces/${spaceId}/variants/${variant.id}/media`, {
    headers: { Range: 'bytes=4-7' },
  });
  if (response.status !== 206) {
    throw new Error(`Expected ranged media response, got ${response.status}`);
  }
  if (response.headers.get('accept-ranges') !== 'bytes') {
    throw new Error('Expected range-capable media response');
  }
  const body = new Uint8Array(await response.arrayBuffer());
  const expected = videoBytes.slice(4, 8);
  if (body.length !== expected.length || body.some((byte, index) => byte !== expected[index])) {
    throw new Error(`Unexpected ranged body: ${Array.from(body).join(',')}`);
  }
}

function openSpaceSocket(spaceId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBaseUrl}/api/spaces/${spaceId}/ws`, {
      headers: authHeaders,
    });
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Timed out opening WebSocket'));
    }, 15_000);
    ws.once('open', () => {
      clearTimeout(timeout);
      resolve(ws);
    });
    ws.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function generateFakeVariant(spaceId) {
  const ws = await openSpaceSocket(spaceId);
  const requestId = crypto.randomUUID();
  let jobId;

  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Timed out waiting for fake generation to complete'));
      }, 60_000);

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'generate:error' || message.type === 'error') {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(`Generation failed: ${JSON.stringify(message)}`));
          return;
        }
        if (message.type === 'generate:started' && message.requestId === requestId) {
          jobId = message.jobId;
          return;
        }
        if (message.type === 'variant:updated' && jobId && message.variant?.id === jobId) {
          if (message.variant.status === 'failed') {
            clearTimeout(timeout);
            ws.close();
            reject(new Error(`Fake generation variant failed: ${message.variant.error_message}`));
            return;
          }
          if (message.variant.status === 'completed') {
            clearTimeout(timeout);
            ws.close();
            resolve(message.variant);
          }
        }
      });

      ws.send(JSON.stringify({
        type: 'generate:request',
        requestId,
        name: 'Fake Generated Foundation Image',
        assetType: 'scene',
        mediaKind: 'image',
        prompt: 'Create a provider-free media foundation test image',
        aspectRatio: '1:1',
      }));
    });
  } finally {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }
}

async function assertGeneratedPng(spaceId, variant) {
  if (variant.media_kind !== 'image' || variant.media_mime_type !== 'image/png') {
    throw new Error(`Unexpected generated media metadata: ${JSON.stringify(variant, null, 2)}`);
  }
  const response = await api(`/api/spaces/${spaceId}/variants/${variant.id}/media`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const pngSignature = [0x89, 0x50, 0x4e, 0x47];
  for (let index = 0; index < pngSignature.length; index += 1) {
    if (bytes[index] !== pngSignature[index]) {
      throw new Error(`Expected generated PNG media for ${variant.id}`);
    }
  }
}

async function assertSyncedState(spaceId, expectedVariantIds) {
  const ws = await openSpaceSocket(spaceId);
  try {
    const state = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Timed out waiting for sync state'));
      }, 15_000);

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'error') {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(`Sync failed: ${JSON.stringify(message)}`));
          return;
        }
        if (message.type === 'sync:state') {
          clearTimeout(timeout);
          resolve(message);
        }
      });

      ws.send(JSON.stringify({ type: 'sync:request' }));
    });

    const seenVariantIds = new Set(state.variants.map((variant) => variant.id));
    for (const variantId of expectedVariantIds) {
      if (!seenVariantIds.has(variantId)) {
        throw new Error(`Variant ${variantId} missing from synced space state`);
      }
    }
  } finally {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }
}

await rm(tmpRoot, { recursive: true, force: true });
await mkdir(tmpRoot, { recursive: true });

console.log('Applying local D1 migrations...');
await run('pnpm', [
  'exec',
  'wrangler',
  'd1',
  'migrations',
  'apply',
  'inventory-local',
  '--local',
  '--persist-to',
  persistDir,
  '--config',
  'wrangler.dev.toml',
]);

console.log(`Starting worker at ${baseUrl} with provider-free media generation...`);
const worker = spawn('pnpm', [
  'exec',
  'wrangler',
  'dev',
  '--config',
  'wrangler.dev.toml',
  '--port',
  port,
  '--persist-to',
  persistDir,
  '--var',
  'INVENTORY_IMAGE_PROVIDER:fake',
  '--var',
  `INVENTORY_DEV_AUTH_TOKEN:${token}`,
], {
  cwd: root,
  env: process.env,
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});

worker.stdout?.on('data', (chunk) => process.stdout.write(chunk));
worker.stderr?.on('data', (chunk) => process.stderr.write(chunk));

try {
  await waitForWorker(worker);
  const spaceId = await createSpace();
  console.log(`Space: ${spaceId}`);

  const imageVariant = await uploadMedia(spaceId, {
    bytes: pngBytes,
    filename: 'foundation.png',
    mimeType: 'image/png',
    mediaKind: 'image',
    assetName: 'Uploaded Foundation Image',
    assetType: 'reference',
  });
  await assertDownloadedMedia(spaceId, imageVariant, { bytes: pngBytes, mimeType: 'image/png' });
  console.log(`Image upload/download OK: ${imageVariant.id}`);

  const audioVariant = await uploadMedia(spaceId, {
    bytes: audioBytes,
    filename: 'foundation.mp3',
    mimeType: 'audio/mpeg',
    mediaKind: 'audio',
    assetName: 'Uploaded Foundation Audio',
    assetType: 'sound',
  });
  await assertDownloadedMedia(spaceId, audioVariant, { bytes: audioBytes, mimeType: 'audio/mpeg' });
  console.log(`Audio upload/download OK: ${audioVariant.id}`);

  const videoVariant = await uploadMedia(spaceId, {
    bytes: videoBytes,
    filename: 'foundation.mp4',
    mimeType: 'video/mp4',
    mediaKind: 'video',
    assetName: 'Uploaded Foundation Video',
    assetType: 'clip',
  });
  await assertDownloadedMedia(spaceId, videoVariant, { bytes: videoBytes, mimeType: 'video/mp4' });
  await assertRangeDownload(spaceId, videoVariant);
  console.log(`Video upload/download/range OK: ${videoVariant.id}`);

  const generatedVariant = await generateFakeVariant(spaceId);
  await assertGeneratedPng(spaceId, generatedVariant);
  console.log(`Fake generation media OK: ${generatedVariant.id}`);

  await assertSyncedState(spaceId, [
    imageVariant.id,
    audioVariant.id,
    videoVariant.id,
    generatedVariant.id,
  ]);
  console.log('Space state OK');

  console.log('\nMedia foundation E2E passed without external generation providers.');
} finally {
  await terminateChild(worker);
}
