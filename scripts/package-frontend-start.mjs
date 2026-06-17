import { cp, rm, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const clientRoot = resolve(root, 'dist/frontend-start/client');
// wrangler.toml's [assets] directory, used by local/legacy tooling. The actual
// plugin deploy reads the client output via the generated server/wrangler.json
// (assets.directory = ../client), so this mirror is belt-and-suspenders.
const legacyAssetsRoot = resolve(root, 'dist/frontend');
const serverConfigPath = resolve(root, 'dist/frontend-start/server/wrangler.json');

// Fail the build (not the deploy) if the SSR worker was not bundled to a single
// self-contained file. @cloudflare/vite-plugin sets `no_bundle: true` only when
// the worker is fully inlined; if it isn't (most often a stale node_modules/.vite
// cache), `wrangler deploy` re-bundles the worker and fails to resolve TanStack
// Start's vite-only virtual modules (@tanstack/react-start/server-entry, the
// start manifest, etc.). Surfacing it here beats the cryptic deploy-time error.
async function verifyWorkerBundle() {
  let config;
  try {
    config = JSON.parse(await readFile(serverConfigPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Worker deploy config not found at ${serverConfigPath}. The @cloudflare/vite-plugin `
      + `build did not emit a deployable worker. Original error: ${error.message}`,
    );
  }

  if (config.no_bundle !== true) {
    throw new Error(
      'Worker deploy config has no_bundle !== true — the SSR worker was not bundled into a single '
      + 'self-contained file, so `wrangler deploy` will re-bundle it and fail to resolve TanStack '
      + 'Start virtual modules. This is usually a stale build cache; remove node_modules/.vite and rebuild.',
    );
  }
}

async function main() {
  await rm(legacyAssetsRoot, { recursive: true, force: true });
  await cp(clientRoot, legacyAssetsRoot, { recursive: true });
  await verifyWorkerBundle();
}

await main();
