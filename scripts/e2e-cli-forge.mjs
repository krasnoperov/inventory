#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';

const root = process.cwd();
const tmpRoot = path.join(root, 'tmp', 'cli-forge-e2e');
const persistDir = path.join(tmpRoot, 'wrangler-state');
const configHome = path.join(tmpRoot, 'config');
const outputDir = path.join(tmpRoot, 'out');
const projectDir = path.join(tmpRoot, 'project');
const swcRegister = path.join(root, 'node_modules', '@swc-node', 'register', 'esm', 'esm-register.mjs');
const cliEntrypoint = path.join(root, 'src', 'cli', 'index.ts');
const port = process.env.INVENTORY_E2E_PORT || String(await findFreePort());
const baseUrl = `http://127.0.0.1:${port}`;
const token = process.env.INVENTORY_E2E_TOKEN || 'inventory-dev-token';
const localPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

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
  const timeout = wait(5_000).then(() => 'timeout');
  const result = await Promise.race([closed, timeout]);
  if (result === 'timeout' && child.exitCode === null && child.signalCode === null) {
    signal('SIGKILL');
    await closed;
  }
}

async function waitForWorker() {
  const started = Date.now();
  while (Date.now() - started < 45_000) {
    try {
      const response = await fetch(`${baseUrl}/api/spaces`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status !== 503 && response.status !== 404) return;
    } catch {
      // Worker is still booting.
    }
    await wait(500);
  }
  throw new Error(`Timed out waiting for worker at ${baseUrl}`);
}

async function createCliConfig() {
  const configDir = path.join(configHome, 'forgetray-cli');
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, 'config.json'), JSON.stringify({
    configs: {
      local: {
        environment: 'local',
        baseUrl,
        clientId: 'inventory-cli',
        token: {
          accessToken: token,
          issuedAt: Date.now(),
          expiresAt: Date.now() + 60 * 60 * 1000,
        },
        user: { id: 1, email: 'dev-1@inventory.local', name: 'Dev User 1' },
        updatedAt: new Date().toISOString(),
      },
    },
  }, null, 2));
}

async function createSpace() {
  const response = await fetch(`${baseUrl}/api/spaces`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: `CLI Forge E2E ${Date.now()}` }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create space: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data.space.id;
}

async function runCli(args) {
  return await run('node', [
    '--import',
    swcRegister,
    cliEntrypoint,
    ...args,
  ], {
    cwd: projectDir,
    env: {
      XDG_CONFIG_HOME: configHome,
      INVENTORY_CLI_BASE_URL: baseUrl,
      SWC_NODE_PROJECT: path.join(root, 'tsconfig.json'),
    },
  });
}

function variantFrom(stdout) {
  const match = stdout.match(/Variant:\s+([^\s]+)/);
  if (!match) {
    throw new Error(`Could not find variant ID in CLI output:\n${stdout}`);
  }
  return match[1];
}

async function assertPng(filePath) {
  const info = await stat(filePath);
  if (!info.isFile() || info.size === 0) {
    throw new Error(`Expected output image at ${filePath}`);
  }

  const bytes = await readFile(filePath);
  const pngSignature = [0x89, 0x50, 0x4e, 0x47];
  for (let i = 0; i < pngSignature.length; i += 1) {
    if (bytes[i] !== pngSignature[i]) {
      throw new Error(`Expected PNG output at ${filePath}`);
    }
  }
}

await rm(tmpRoot, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await mkdir(projectDir, { recursive: true });
await createCliConfig();

console.log('Applying local D1 migrations...');
await run('npx', [
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

console.log(`Starting worker at ${baseUrl} with fake image generation...`);
const worker = spawn('npx', [
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
  await waitForWorker();
  const spaceId = await createSpace();
  console.log(`Space: ${spaceId}`);

  await runCli([
    'init',
    '--local',
    '--space',
    spaceId,
  ]);

  const generatedPath = path.join(outputDir, 'generated.png');
  const generated = await runCli([
    'generate',
    'A simple local test background',
    '--local',
    '--name',
    'Generated Background',
    '--type',
    'scene',
    '-o',
    generatedPath,
  ]);
  const generatedVariantId = variantFrom(generated.stdout);
  await assertPng(generatedPath);
  console.log(`Generate OK: ${generatedVariantId}`);

  const refinedPath = path.join(outputDir, 'refined.png');
  const refined = await runCli([
    'refine',
    '--local',
    '--variant',
    generatedVariantId,
    'Make the local test background warmer',
    '-o',
    refinedPath,
  ]);
  const refinedVariantId = variantFrom(refined.stdout);
  await assertPng(refinedPath);
  console.log(`Refine OK: ${refinedVariantId}`);

  const referencePath = path.join(outputDir, 'reference.png');
  await writeFile(referencePath, Buffer.from(localPngBase64, 'base64'));

  const derivedPath = path.join(outputDir, 'derived.png');
  const derived = await runCli([
    'derive',
    '--local',
    '--refs',
    `${generatedVariantId},${referencePath}`,
    '--name',
    'Derived Scene',
    '--type',
    'scene',
    'Combine the generated background and the local reference',
    '-o',
    derivedPath,
  ]);
  const derivedVariantId = variantFrom(derived.stdout);
  await assertPng(derivedPath);
  console.log(`Derive OK: ${derivedVariantId}`);

  console.log('\nCLI Forge E2E passed without Gemini requests.');
} finally {
  await terminateChild(worker);
}
