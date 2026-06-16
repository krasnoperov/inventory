#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { chmod, readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const outputFile = resolve(root, 'dist/cli/inventory.mjs');

function getGitSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function getCliVersion() {
  if (process.env.INVENTORY_CLI_VERSION) {
    return process.env.INVENTORY_CLI_VERSION;
  }

  const sha = getGitSha();
  if (sha) {
    return `${packageJson.version}+${sha}`;
  }

  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `${packageJson.version}+local.${timestamp}`;
}

const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

await build({
  configFile: false,
  root,
  publicDir: false,
  define: {
    __INVENTORY_CLI_VERSION__: JSON.stringify(getCliVersion()),
  },
  build: {
    emptyOutDir: false,
    minify: false,
    outDir: resolve(root, 'dist/cli'),
    rollupOptions: {
      external: (id) => nodeBuiltins.has(id),
      input: resolve(root, 'src/cli/index.ts'),
      output: {
        entryFileNames: 'inventory.mjs',
        format: 'es',
      },
    },
    ssr: true,
    target: 'node20',
  },
  resolve: {
    alias: {
      '@shared': resolve(root, 'src/shared'),
    },
  },
  ssr: {
    noExternal: true,
  },
});

await chmod(outputFile, 0o755);
