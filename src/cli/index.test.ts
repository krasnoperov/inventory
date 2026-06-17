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

async function writeSideEffectTraps(cwd: string): Promise<{ authConfigPath: string; projectConfigPath: string; configHome: string }> {
  const projectConfigPath = path.join(cwd, '.inventory', 'config.json');
  await mkdir(path.dirname(projectConfigPath), { recursive: true });
  await writeFile(projectConfigPath, '{', 'utf8');

  const configHome = path.join(cwd, 'xdg-config');
  const authConfigPath = path.join(configHome, 'forgetray-cli', 'config.json');
  await mkdir(path.dirname(authConfigPath), { recursive: true });
  await writeFile(authConfigPath, '{', 'utf8');

  return { authConfigPath, projectConfigPath, configHome };
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
    await writeSideEffectTraps(cwd);

    const result = await runCli(['runs', '--help'], cwd);

    assert.equal(result.code, 0, `CLI exited with code ${result.code}; stderr: ${result.stderr}`);
    assert.equal(result.stderr, '');
    assert.ok(result.stdout.includes('pnpm run cli runs show --latest --debug'));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('help is side-effect-free across command and subcommand levels', async () => {
  const cwd = await createCliCwd();
  try {
    const { authConfigPath, configHome, projectConfigPath } = await writeSideEffectTraps(cwd);
    const helpForms = [
      ['login', '--help'],
      ['logout', '--help'],
      ['billing', '--help'],
      ['billing', 'status', '--help'],
      ['billing', 'check', '--help'],
      ['billing', 'retry-failed', '--help'],
      ['spaces', '--help'],
      ['spaces', 'create', '--help'],
      ['listen', '--help'],
      ['upload', '--help'],
      ['generate', '--help'],
      ['refine', '--help'],
      ['derive', '--help'],
      ['batch', '--help'],
      ['audio', '--help'],
      ['audio', 'speech', '--help'],
      ['audio', 'dialogue', 'generate', '--help'],
      ['audio', 'music', 'batch', '--help'],
      ['audio', 'generate', '--help'],
      ['audio', 'batch', '--help'],
      ['video', '--help'],
      ['video', 'generate', '--help'],
      ['video', 'refine', '--help'],
      ['video', 'derive', '--help'],
      ['runs', '--help'],
      ['runs', 'show', '--help'],
      ['runs', 'export', '--help'],
      ['assets', '--help'],
      ['assets', 'show', '--help'],
      ['assets', 'download', '--help'],
      ['productions', '--help'],
      ['productions', 'export', '--help'],
      ['help', 'audio', 'batch'],
      ['help', 'video', 'derive'],
      ['help', 'assets', 'show'],
      ['help', 'productions', 'export'],
    ];

    for (const args of helpForms) {
      const result = await runCli(args, cwd, {
        XDG_CONFIG_HOME: configHome,
        HOME: cwd,
      });
      assert.equal(result.code, 0, `${args.join(' ')} exited with code ${result.code}; stderr: ${result.stderr}`);
      assert.equal(result.stderr, '', `${args.join(' ')} wrote stderr`);
      assert.ok(result.stdout.includes('Usage:') || result.stdout.includes('Commands'), `${args.join(' ')} did not print help`);
    }

    assert.equal(await readFile(projectConfigPath, 'utf8'), '{');
    assert.equal(await readFile(authConfigPath, 'utf8'), '{');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('first positional help remains command input', async () => {
  const cwd = await createCliCwd();
  try {
    const result = await runCli([
      'generate',
      'help',
      '--name',
      'Help',
      '--type',
      'scene',
      '-o',
      'help.png',
      '--space',
      'space_123',
    ], cwd, {
      XDG_CONFIG_HOME: path.join(cwd, 'xdg-config'),
      HOME: cwd,
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Not logged in to production environment/);
    assert.ok(result.stdout.includes('pnpm run cli generate "prompt"'));
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

test('nested video subcommand help does not require auth', async () => {
  const cwd = await createCliCwd();
  try {
    const configHome = path.join(cwd, 'xdg-config');
    const result = await runCli(['video', 'generate', '--help'], cwd, {
      XDG_CONFIG_HOME: configHome,
      HOME: cwd,
    });

    assert.equal(result.code, 0, `CLI exited with code ${result.code}; stderr: ${result.stderr}`);
    assert.equal(result.stderr, '');
    assert.ok(result.stdout.includes('pnpm run cli video generate "prompt"'));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('audio help lists explicit Forge Tray audio modes', async () => {
  const cwd = await createCliCwd();
  try {
    const result = await runCli(['audio', '--help'], cwd, {
      XDG_CONFIG_HOME: path.join(cwd, 'xdg-config'),
      HOME: cwd,
    });

    assert.equal(result.code, 0, `CLI exited with code ${result.code}; stderr: ${result.stderr}`);
    assert.equal(result.stderr, '');
    assert.ok(result.stdout.includes('audio <speech|dialogue|music|sfx> generate'));
    assert.ok(result.stdout.includes('audio <speech|dialogue|music|sfx> batch'));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('unsupported audio mode operation fails before loading auth config', async () => {
  const cwd = await createCliCwd();
  try {
    const { configHome } = await writeSideEffectTraps(cwd);
    const result = await runCli(['audio', 'music', 'refine', '--space', 'space-side-effect'], cwd, {
      XDG_CONFIG_HOME: configHome,
      HOME: cwd,
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Audio music supports only generate or batch/);
    assert.ok(result.stdout.includes('audio <speech|dialogue|music|sfx> generate'));
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
