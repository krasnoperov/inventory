import process from 'node:process';
import type { ParsedArgs, StoredConfig } from '../lib/types';
import { loadStoredConfig, resolveBaseUrl } from '../lib/config';
import { loadProjectConfig, type ProjectConfig } from '../lib/project-config';
import {
  loginCommandForEnvironment,
  resolveCommandEnvironment,
  resolveCommandSpace,
} from '../lib/command-context';
import {
  WebSocketClient,
  type VariantMutationClient,
  type Variant,
} from '../lib/websocket-client';

export type VariantsResult =
  | { type: 'delete'; variantId: string }
  | { type: 'retry'; variant: Variant }
  | { type: 'star'; variant: Variant }
  | { type: 'rate'; variant: Variant };

interface VariantsDeps {
  loadConfig: (env: string) => Promise<StoredConfig | null>;
  loadProjectConfig: () => Promise<ProjectConfig | null>;
  resolveBaseUrl: (env: string) => string;
  createMutationClient: (env: string, spaceId: string) => Promise<VariantMutationClient>;
  print: (message: string) => void;
}

interface VariantsContext {
  env: string;
  spaceId: string;
}

const defaultDeps: VariantsDeps = {
  loadConfig: loadStoredConfig,
  loadProjectConfig,
  resolveBaseUrl,
  createMutationClient: (env, spaceId) => WebSocketClient.create(env, spaceId),
  print: console.log,
};

export async function handleVariants(parsed: ParsedArgs): Promise<void> {
  try {
    await executeVariants(parsed);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    printUsage();
    process.exitCode = 1;
  }
}

export async function executeVariants(
  parsed: ParsedArgs,
  deps: VariantsDeps = defaultDeps
): Promise<VariantsResult> {
  const ctx = await buildContext(parsed, deps);
  const subcommand = parsed.positionals[0];

  if (subcommand === 'delete') {
    const variantId = requireVariantId(parsed, 'delete');
    await withVariantClient(ctx, deps, (client) => client.deleteVariant(variantId));
    deps.print(`Deleted variant ${variantId}`);
    return { type: 'delete', variantId };
  }

  if (subcommand === 'retry') {
    const variantId = requireVariantId(parsed, 'retry');
    const variant = await withVariantClient(ctx, deps, (client) => client.retryVariant(variantId));
    deps.print(`Re-queued variant ${variantId} (status: ${variant.status}). Watch progress with: assets show ${variant.asset_id}`);
    return { type: 'retry', variant };
  }

  if (subcommand === 'star' || subcommand === 'unstar') {
    const starred = subcommand === 'star';
    const variantId = requireVariantId(parsed, subcommand);
    const variant = await withVariantClient(ctx, deps, (client) => client.starVariant(variantId, starred));
    deps.print(`${starred ? 'Starred' : 'Unstarred'} variant ${variantId}`);
    return { type: 'star', variant };
  }

  if (subcommand === 'rate') {
    const variantId = parsed.positionals[1];
    const rating = parsed.positionals[2];
    if (!variantId || (rating !== 'approved' && rating !== 'rejected')) {
      throw new Error('Usage: pnpm run cli variants rate <variant-id> <approved|rejected>');
    }
    const variant = await withVariantClient(ctx, deps, (client) => client.rateVariant(variantId, rating));
    deps.print(`Rated variant ${variantId} as ${rating}`);
    return { type: 'rate', variant };
  }

  throw new Error(`Unknown variants command: ${subcommand ?? '(none)'}`);
}

function requireVariantId(parsed: ParsedArgs, verb: string): string {
  const variantId = parsed.positionals[1];
  if (!variantId) {
    throw new Error(`Variant ID is required: pnpm run cli variants ${verb} <variant-id>`);
  }
  return variantId;
}

async function buildContext(parsed: ParsedArgs, deps: VariantsDeps): Promise<VariantsContext> {
  const projectConfig = await deps.loadProjectConfig();
  const env = resolveCommandEnvironment(parsed, projectConfig);
  const spaceId = resolveCommandSpace(parsed, projectConfig);
  if (!spaceId) {
    throw new Error('--space is required, or run: pnpm run cli init --space <id>');
  }

  const config = await deps.loadConfig(env);
  if (!config) {
    throw new Error(`Not logged in to ${env} environment. Run: ${loginCommandForEnvironment(env)}`);
  }
  if (config.token.expiresAt < Date.now()) {
    throw new Error(`Token expired for ${env} environment. Run: ${loginCommandForEnvironment(env)}`);
  }
  if (env === 'local') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  return { env, spaceId };
}

async function withVariantClient<T>(
  ctx: VariantsContext,
  deps: Pick<VariantsDeps, 'createMutationClient'>,
  run: (client: VariantMutationClient) => Promise<T>
): Promise<T> {
  const client = await deps.createMutationClient(ctx.env, ctx.spaceId);
  await client.connect();
  try {
    return await run(client);
  } finally {
    client.disconnect();
  }
}

function printUsage(): void {
  console.log(`
Usage:
  pnpm run cli variants delete <variant-id>
  pnpm run cli variants retry <variant-id>
  pnpm run cli variants star <variant-id>
  pnpm run cli variants unstar <variant-id>
  pnpm run cli variants rate <variant-id> <approved|rejected>

Options:
  --space <id>      Target space ID; defaults from the initialized project
  --env <env>       Environment (production|stage|local)
  --local           Shortcut for --env local
`);
}
