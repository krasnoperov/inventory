import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

function parseArgs(argv) {
  const options = { quiet: false, repoRoot: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--quiet') {
      options.quiet = true;
      continue;
    }
    if (arg === '--repo-root') {
      options.repoRoot = argv[i + 1] ?? options.repoRoot;
      i += 1;
    }
  }
  options.repoRoot = path.resolve(options.repoRoot);
  return options;
}

// Install (or reuse) node_modules so the worktree is runnable for
// typecheck/lint/test/build. Marker file lives inside node_modules so it
// dies with the tree; its content is sha256(package.json+package-lock.json)
// at install time. Any drift forces a clean reinstall.
//
// NODE_ENV=production leaks devDependencies out of the install surface, so
// we strip it from the child env before running npm ci. Defense in depth
// for any caller context.
function ensureNodeModulesCurrent(resolvedRoot, actions) {
  const packageJsonPath = path.join(resolvedRoot, 'package.json');
  const lockfilePath = path.join(resolvedRoot, 'package-lock.json');
  if (!fs.existsSync(packageJsonPath) || !fs.existsSync(lockfilePath)) {
    return;
  }

  const marker = path.join(resolvedRoot, 'node_modules', '.bootstrap-worktree-stamp');
  const currentHash = createHash('sha256')
    .update(fs.readFileSync(packageJsonPath))
    .update(fs.readFileSync(lockfilePath))
    .digest('hex');

  if (fs.existsSync(marker)) {
    const storedHash = fs.readFileSync(marker, 'utf8').trim();
    if (storedHash === currentHash) {
      actions.push('node_modules matches package.json + package-lock.json — skipped install');
      return;
    }
  }

  const childEnv = { ...process.env };
  delete childEnv.NODE_ENV;
  childEnv.NPM_CONFIG_PRODUCTION = 'false';

  const result = spawnSync(
    'npm',
    ['ci', '--prefer-offline', '--no-audit', '--no-fund'],
    { cwd: resolvedRoot, env: childEnv, stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error(`npm ci failed with exit code ${result.status ?? 'unknown'}`);
  }

  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, currentHash);
  actions.push('ran npm ci and wrote bootstrap-worktree stamp');
}

export function bootstrapWorktree({ repoRoot = process.cwd(), quiet = false, ensureDeps = true } = {}) {
  const resolvedRoot = path.resolve(repoRoot);
  const actions = [];

  if (ensureDeps) {
    ensureNodeModulesCurrent(resolvedRoot, actions);
  }

  if (!quiet) {
    for (const action of actions) {
      console.log(`[worktree-bootstrap] ${action}`);
    }
  }

  return { repoRoot: resolvedRoot, actions };
}

const isDirectExecution = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;

if (isDirectExecution) {
  try {
    bootstrapWorktree(parseArgs(process.argv.slice(2)));
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
