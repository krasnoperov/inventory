#!/usr/bin/env node

import { spawn } from 'node:child_process';

const steps = [
  {
    name: 'Check production workflow secrets',
    command: 'node',
    args: ['scripts/check-production-workflow-secrets.mjs'],
  },
  {
    name: 'Build production bundle',
    command: 'pnpm',
    args: ['run', 'build'],
    env: { CLOUDFLARE_ENV: 'production' },
  },
  {
    name: 'Deploy production application worker',
    command: 'pnpm',
    args: ['exec', 'wrangler', 'deploy', '--env', 'production'],
  },
  {
    name: 'Deploy production generation worker',
    command: 'pnpm',
    args: ['exec', 'wrangler', 'deploy', '--config', 'wrangler.generation.toml', '--env', 'production'],
  },
  {
    name: 'Deploy production polar worker',
    command: 'pnpm',
    args: ['exec', 'wrangler', 'deploy', '--config', 'wrangler.polar.toml', '--env', 'production'],
  },
];

for (const step of steps) {
  console.log(`\n==> ${step.name}`);
  await run(step.command, step.args, step.env);
}

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        ...extraEnv,
      },
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with exit ${code}`));
    });
  });
}
