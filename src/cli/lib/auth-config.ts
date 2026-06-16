import process from 'node:process';
import type { ParsedArgs, StoredConfig } from './types';
import { CLI_COMMAND } from './auth';
import { loadStoredConfig, DEFAULT_ENVIRONMENT } from './config';
import { normalizeEnvironment } from './command-context';

export function determineEnvironment(parsed: ParsedArgs): string {
  // Priority order: --local flag, --env flag, default to production
  const isLocal = parsed.options.local === 'true';
  if (isLocal) return 'local';

  const envFlag = parsed.options.env;
  if (envFlag) {
    try {
      return normalizeEnvironment(envFlag);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
      process.exit(1);
    }
  }

  return DEFAULT_ENVIRONMENT; // Always default to production
}

export async function loadAuthenticatedConfig(parsed: ParsedArgs): Promise<StoredConfig> {
  const environment = determineEnvironment(parsed);
  const config = await loadStoredConfig(environment);

  if (!config) {
    const loginHint = environment === DEFAULT_ENVIRONMENT
      ? ''
      : environment === 'local'
        ? ' --local'
        : ` --env ${environment}`;
    console.error(`Error: Not authenticated for environment "${environment}". Please run "${CLI_COMMAND} login${loginHint}" first.`);
    process.exitCode = 1;
    process.exit(1);
  }

  // Check if token is expired
  if (config.token.expiresAt < Date.now()) {
    const loginHint = environment === DEFAULT_ENVIRONMENT
      ? ''
      : environment === 'local'
        ? ' --local'
        : ` --env ${environment}`;
    console.error(`Error: Your session for environment "${environment}" has expired. Please run "${CLI_COMMAND} login${loginHint}" again.`);
    process.exitCode = 1;
    process.exit(1);
  }

  return config;
}
