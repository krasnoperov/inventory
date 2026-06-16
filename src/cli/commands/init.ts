import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import { saveProjectConfig } from '../lib/project-config';

interface InitDeps {
  saveProjectConfig: typeof saveProjectConfig;
}

const defaultDeps: InitDeps = {
  saveProjectConfig,
};

export async function handleInit(parsed: ParsedArgs): Promise<void> {
  try {
    await executeInit(parsed);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    printUsage();
    process.exitCode = 1;
  }
}

export async function executeInit(
  parsed: ParsedArgs,
  deps: InitDeps = defaultDeps
): Promise<{ configPath: string; environment: string; spaceId: string }> {
  const environment = parsed.options.local === 'true'
    ? 'local'
    : parsed.options.env || 'stage';
  const spaceId = parsed.options.space || parsed.options['space-id'];

  if (!spaceId || spaceId === 'true') {
    throw new Error('--space is required');
  }

  const configPath = await deps.saveProjectConfig({ environment, spaceId });

  console.log('\nInventory project initialized.\n');
  console.log(`  Config: ${configPath}`);
  console.log(`  Env:    ${environment}`);
  console.log(`  Space:  ${spaceId}`);
  console.log('\nForge commands can now omit --space inside this project.');

  return { configPath, environment, spaceId };
}

function printUsage(): void {
  console.log(`
Usage:
  npm run cli -- init --space <id> [--env stage|production|local]
`);
}
