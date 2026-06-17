import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const runCli = (args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<{ stdout: string; stderr: string; code: number | null }> => {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'node',
      ['--import', '@swc-node/register/esm-register', 'src/cli/index.ts', ...args],
      {
        cwd,
        env: {
          ...process.env,
          ...env,
        },
      },
    );

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });
  });
};

async function createCliCwd(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'inventory-cli-help-'));
  await symlink(path.join(repoRoot, 'node_modules'), path.join(cwd, 'node_modules'));
  await symlink(path.join(repoRoot, 'src'), path.join(cwd, 'src'));
  await symlink(path.join(repoRoot, 'tsconfig.json'), path.join(cwd, 'tsconfig.json'));
  return cwd;
}

test('help command displays available commands', async () => {
  const cwd = process.cwd();
  const result = await runCli(['help'], cwd);

  assert.equal(result.code, 0, `CLI exited with code ${result.code}; stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('login'), 'Help output should include login command');
  assert.ok(result.stdout.includes('logout'), 'Help output should include logout command');
});

test('version command prints the development fallback when unbundled', async () => {
  const cwd = process.cwd();
  const result = await runCli(['--version'], cwd);

  assert.equal(result.code, 0, `CLI exited with code ${result.code}; stderr: ${result.stderr}`);
  assert.equal(result.stdout.trim(), '0.0.0-dev');
});

test('subcommand help exits before loading invalid project config', async () => {
  const cwd = await createCliCwd();
  try {
    await mkdir(path.join(cwd, '.inventory'));
    const invalidProjectConfig = path.join(cwd, '.inventory', 'config.json');
    await mkdir(path.dirname(invalidProjectConfig), { recursive: true });
    await writeFile(invalidProjectConfig, '{', 'utf8');

    const result = await runCli(['runs', '--help'], cwd);

    assert.equal(result.code, 0, `CLI exited with code ${result.code}; stderr: ${result.stderr}`);
    assert.equal(result.stderr, '');
    assert.ok(result.stdout.includes('pnpm run cli runs show --latest'));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('nested subcommand help exits without init side effects', async () => {
  const cwd = await createCliCwd();
  try {
    const result = await runCli(['init', '--help', '--space', 'space-side-effect'], cwd);

    assert.equal(result.code, 0, `CLI exited with code ${result.code}; stderr: ${result.stderr}`);
    assert.equal(result.stderr, '');
    assert.ok(result.stdout.includes('pnpm run cli init --space <id>'));
    await assert.rejects(
      readFile(path.join(cwd, '.inventory', 'config.json'), 'utf8'),
      (error: NodeJS.ErrnoException) => error.code === 'ENOENT'
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('nested audio subcommand help does not require auth', async () => {
  const cwd = await createCliCwd();
  try {
    const configHome = path.join(cwd, 'xdg-config');
    const result = await runCli(['audio', 'generate', '--help'], cwd, {
      XDG_CONFIG_HOME: configHome,
      HOME: cwd,
    });

    assert.equal(result.code, 0, `CLI exited with code ${result.code}; stderr: ${result.stderr}`);
    assert.equal(result.stderr, '');
    assert.ok(result.stdout.includes('pnpm run cli audio generate "prompt"'));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('local help exits without toggling TLS warnings', async () => {
  const cwd = await createCliCwd();
  try {
    const result = await runCli(['upload', '--help', '--local'], cwd);

    assert.equal(result.code, 0, `CLI exited with code ${result.code}; stderr: ${result.stderr}`);
    assert.equal(result.stderr, '');
    assert.ok(result.stdout.includes('pnpm run cli upload <file>'));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
