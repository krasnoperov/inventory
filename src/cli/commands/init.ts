import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import { saveProjectConfig } from '../lib/project-config';
import { resolveCommandEnvironment, resolveCommandSpace } from '../lib/command-context';

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
  const environment = resolveCommandEnvironment(parsed);
  const spaceId = resolveCommandSpace(parsed);

  if (!spaceId) {
    throw new Error('--space is required');
  }

  const configPath = await deps.saveProjectConfig({ environment, spaceId });

  if (parsed.options.json === 'true') {
    console.log(JSON.stringify({ configPath, environment, spaceId }, null, 2));
  } else {
    console.log('\nInventory project initialized.\n');
    console.log(`  Config: ${configPath}`);
    console.log(`  Env:    ${environment}`);
    console.log(`  Space:  ${spaceId}`);
    console.log('\nForge, asset, upload, and listen commands can now omit --space inside this project.');
  }

  return { configPath, environment, spaceId };
}

function printUsage(): void {
  console.log(`
Usage:
  pnpm run cli init --space <id> [--env production|stage|local]
  pnpm run cli init --space <id> --json
`);
}
