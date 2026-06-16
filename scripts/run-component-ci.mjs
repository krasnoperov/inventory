#!/usr/bin/env node

import { spawn } from 'node:child_process';

const shardCount = Number.parseInt(process.env.COMPONENT_SHARDS ?? '1', 10);
const basePort = Number.parseInt(process.env.COMPONENT_BASE_PORT ?? '4175', 10);
const children = new Set();

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      ...options,
    });
    children.add(child);
    child.on('exit', (code, signal) => {
      children.delete(child);
      resolve({ code: code ?? (signal ? 1 : 0), signal });
    });
  });
}

function startServer(port) {
  return spawn('node', ['./scripts/component-harness-server.mjs'], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      HARNESS_PORT: String(port),
    },
  });
}

function shardArgument(shard) {
  return `${shard}/${shardCount}`;
}

async function waitForServer(port) {
  const url = `http://127.0.0.1:${port}/component-harness.html`;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        console.log(`harness :${port} ready`);
        return;
      }
    } catch {
      // Keep polling until the server is ready or the deadline expires.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`harness :${port} never came up`);
}

async function main() {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error(`Invalid COMPONENT_SHARDS: ${process.env.COMPONENT_SHARDS}`);
  }

  const build = await run('pnpm', ['exec', 'vite', 'build', '--config', 'vite.component-harness.config.ts']);
  if (build.code !== 0) {
    process.exit(build.code);
  }

  const servers = Array.from({ length: shardCount }, (_, index) => startServer(basePort + index));
  const cleanup = () => {
    for (const child of children) {
      if (!child.killed) {
        child.kill();
      }
    }
    for (const server of servers) {
      if (!server.killed) {
        server.kill();
      }
    }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });

  let exitCode = 1;
  try {
    await Promise.all(servers.map((_, index) => waitForServer(basePort + index)));

    const results = await Promise.all(
      Array.from({ length: shardCount }, async (_, index) => {
        const shard = index + 1;
        const port = basePort + index;
        const result = await run('node', ['./scripts/run-component-shard.mjs', shardArgument(shard)], {
          env: {
            ...process.env,
            HARNESS_PORT: String(port),
            SKIP_WEBSERVER: '1',
          },
        });
        console.log(`Shard ${shard} result: ${result.code}`);
        return result.code;
      }),
    );

    exitCode = results.some((code) => code !== 0) ? 1 : 0;
  } finally {
    cleanup();
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
