import type { ParsedArgs } from './types';
import { DEFAULT_ENVIRONMENT } from './config';
import type { ProjectConfig } from './project-config';

const VALID_ENVIRONMENTS = new Set(['production', 'stage', 'staging', 'local']);

export function resolveCommandEnvironment(
  parsed: ParsedArgs,
  projectConfig?: Pick<ProjectConfig, 'environment'> | null
): string {
  if (parsed.options.local === 'true') return 'local';

  const environment = parsed.options.env || projectConfig?.environment || DEFAULT_ENVIRONMENT;
  return normalizeEnvironment(environment);
}

export function resolveCommandSpace(
  parsed: ParsedArgs,
  projectConfig?: Pick<ProjectConfig, 'spaceId'> | null
): string | undefined {
  const spaceId = parsed.options.space || parsed.options['space-id'] || projectConfig?.spaceId;
  if (!spaceId || spaceId === 'true') return undefined;
  return spaceId;
}

export function normalizeEnvironment(environment: string): string {
  if (!VALID_ENVIRONMENTS.has(environment)) {
    throw new Error(`Unknown environment "${environment}". Valid options: production, stage, local`);
  }
  return environment === 'staging' ? 'stage' : environment;
}

export function loginCommandForEnvironment(environment: string): string {
  if (environment === DEFAULT_ENVIRONMENT) return 'pnpm run cli login';
  if (environment === 'local') return 'pnpm run cli login --local';
  return `pnpm run cli login --env ${environment}`;
}
