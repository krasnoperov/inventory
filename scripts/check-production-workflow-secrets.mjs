#!/usr/bin/env node

import { spawn } from 'node:child_process';

const REQUIRED_SECRETS = [
  'GOOGLE_AI_API_KEY',
  'ELEVENLABS_API_KEY',
];

const OPTIONAL_SECRET_GROUPS = [
  {
    label: 'Lyria',
    names: ['LYRIA_API_KEY', 'LYRIA_ACCESS_TOKEN'],
  },
];

const TARGETS = [
  {
    label: 'application worker',
    args: ['secret', 'list', '--env', 'production'],
  },
  {
    label: 'generation worker',
    args: ['secret', 'list', '--config', 'wrangler.generation.toml', '--env', 'production'],
  },
];

async function runWranglerJson(args) {
  const output = await run('pnpm', ['exec', 'wrangler', ...args]);
  const start = output.indexOf('[');
  if (start === -1) {
    throw new Error(`wrangler did not return a JSON secret list for: wrangler ${args.join(' ')}`);
  }
  return JSON.parse(output.slice(start));
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with exit ${code}\n${stderr || stdout}`));
    });
  });
}

for (const target of TARGETS) {
  const secrets = await runWranglerJson(target.args);
  const names = new Set(secrets.map((secret) => secret.name));
  const missing = REQUIRED_SECRETS.filter((name) => !names.has(name));
  if (missing.length > 0) {
    console.error(`Production ${target.label} is missing workflow provider secrets: ${missing.join(', ')}`);
    console.error('Refusing to deploy because this can make GenerationWorkflow fail after an app-worker publish.');
    process.exit(1);
  }

  for (const group of OPTIONAL_SECRET_GROUPS) {
    const configured = group.names.some((name) => names.has(name));
    if (!configured) {
      console.warn(`Production ${target.label} has no ${group.label} platform secret; ${group.label} requests must be rejected before workflow start unless BYOK is configured.`);
    }
  }
}

console.log('Production workflow provider secrets are present on application and generation workers.');
