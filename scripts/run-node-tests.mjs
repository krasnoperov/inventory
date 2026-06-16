#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const registerHookUrl = pathToFileURL(resolve(process.cwd(), 'scripts/register-test-hooks.mjs')).href;

const result = spawnSync(
  process.execPath,
  [
    '--env-file-if-exists=.env',
    '--import',
    registerHookUrl,
    '--test',
    ...process.argv.slice(2),
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_COMPILE_CACHE: process.env.NODE_COMPILE_CACHE ?? 'node_modules/.cache/node-compile',
    },
  },
);

process.exit(result.status ?? 1);
