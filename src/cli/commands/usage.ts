import process from 'node:process';
import type { ParsedArgs, StoredConfig } from '../lib/types';
import { loadStoredConfig, resolveBaseUrl } from '../lib/config';
import { loadProjectConfig, type ProjectConfig } from '../lib/project-config';
import {
  loginCommandForEnvironment,
  resolveCommandEnvironment,
  resolveCommandSpace,
} from '../lib/command-context';

interface PlatformUsageTypeSummary {
  usageType: 'storage' | 'workflow' | 'delivery';
  unit: 'byte' | 'run';
  quantity: number;
  events: number;
}

interface PlatformUsageMediaKindSummary {
  mediaKind: 'image' | 'audio' | 'video' | null;
  storageBytes: number;
  workflowRuns: number;
  deliveryBytes: number;
  events: number;
}

interface PlatformUsageSummary {
  success: true;
  spaceId: string;
  period: {
    from: string | null;
    to: string | null;
  };
  totals: {
    storageBytes: number;
    workflowRuns: number;
    deliveryBytes: number;
  };
  byType: PlatformUsageTypeSummary[];
  byMediaKind: PlatformUsageMediaKindSummary[];
}

type UsageResult = { type: 'summary'; summary: PlatformUsageSummary };

interface UsageDeps {
  loadConfig: (env: string) => Promise<StoredConfig | null>;
  loadProjectConfig: () => Promise<ProjectConfig | null>;
  resolveBaseUrl: (env: string) => string;
  fetch: typeof fetch;
  print: (message: string) => void;
}

interface UsageContext {
  env: string;
  spaceId: string;
  baseUrl: string;
  accessToken: string;
}

const defaultDeps: UsageDeps = {
  loadConfig: loadStoredConfig,
  loadProjectConfig,
  resolveBaseUrl,
  fetch,
  print: console.log,
};

export async function handleUsage(parsed: ParsedArgs): Promise<void> {
  try {
    await executeUsage(parsed);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    printUsage();
    process.exitCode = 1;
  }
}

export async function executeUsage(
  parsed: ParsedArgs,
  deps: UsageDeps = defaultDeps
): Promise<UsageResult> {
  const subcommand = parsed.positionals[0] || 'summary';
  if (subcommand !== 'summary') {
    throw new Error(`Unknown usage command: ${subcommand}`);
  }

  const ctx = await buildContext(parsed, deps);
  const summary = await fetchUsageSummary(ctx, deps, {
    from: optionValue(parsed.options.from),
    to: optionValue(parsed.options.to),
  });

  if (parsed.options.json === 'true') {
    deps.print(JSON.stringify(summary, null, 2));
  } else {
    printUsageSummary(summary, deps.print);
  }

  return { type: 'summary', summary };
}

async function buildContext(parsed: ParsedArgs, deps: UsageDeps): Promise<UsageContext> {
  const projectConfig = await deps.loadProjectConfig();
  const env = resolveCommandEnvironment(parsed, projectConfig);
  const spaceId = resolveCommandSpace(parsed, projectConfig);
  if (!spaceId) {
    throw new Error('--space is required, or run: makefx init --space <id>');
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

  return {
    env,
    spaceId,
    baseUrl: deps.resolveBaseUrl(env),
    accessToken: config.token.accessToken,
  };
}

async function fetchUsageSummary(
  ctx: UsageContext,
  deps: Pick<UsageDeps, 'fetch'>,
  options: { from?: string; to?: string }
): Promise<PlatformUsageSummary> {
  const params = new URLSearchParams();
  if (options.from) params.set('from', options.from);
  if (options.to) params.set('to', options.to);
  const query = params.toString();
  const response = await deps.fetch(
    `${ctx.baseUrl}/api/spaces/${encodeURIComponent(ctx.spaceId)}/usage/summary${query ? `?${query}` : ''}`,
    {
      headers: {
        'Authorization': `Bearer ${ctx.accessToken}`,
        'Accept': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed (${response.status}): ${text || response.statusText}`);
  }

  return response.json() as Promise<PlatformUsageSummary>;
}

function optionValue(value: string | undefined): string | undefined {
  return !value || value === 'true' ? undefined : value;
}

function printUsageSummary(summary: PlatformUsageSummary, print: (message: string) => void): void {
  print(`\nUsage summary for ${summary.spaceId}\n`);
  print(`  Period:        ${formatPeriod(summary.period)}`);
  print(`  Storage:       ${formatBytes(summary.totals.storageBytes)}`);
  print(`  Workflow runs: ${summary.totals.workflowRuns}`);
  print(`  Delivery:      ${formatBytes(summary.totals.deliveryBytes)}`);

  if (summary.byMediaKind.length > 0) {
    print('\nBy media kind:');
    print('Media'.padEnd(10) + 'Storage'.padEnd(14) + 'Workflows'.padEnd(12) + 'Delivery'.padEnd(14) + 'Events');
    print('-'.repeat(58));
    for (const row of summary.byMediaKind) {
      print(
        (row.mediaKind || '-').padEnd(10) +
        formatBytes(row.storageBytes).padEnd(14) +
        String(row.workflowRuns).padEnd(12) +
        formatBytes(row.deliveryBytes).padEnd(14) +
        String(row.events)
      );
    }
  }
}

function formatPeriod(period: PlatformUsageSummary['period']): string {
  if (!period.from && !period.to) return 'all time';
  if (period.from && period.to) return `${period.from} to ${period.to}`;
  if (period.from) return `from ${period.from}`;
  return `through ${period.to}`;
}

function formatBytes(bytes: number): string {
  const sign = bytes < 0 ? '-' : '';
  let value = Math.abs(bytes);
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted = unitIndex === 0 ? String(value) : value.toFixed(value >= 10 ? 1 : 2);
  return `${sign}${formatted} ${units[unitIndex]}`;
}

function printUsage(): void {
  console.log(`
Usage:
  makefx usage [summary] [--space <id>] [--from <date>] [--to <date>]
  makefx usage --json

Options:
  --space <id>      Target space ID; defaults from the initialized project
  --from <date>     Include usage at or after this date or ISO timestamp
  --to <date>       Include usage at or before this date or ISO timestamp
  --json            Print machine-readable output
  --env <env>       Environment (production|stage|local)
  --local           Shortcut for --env local
`);
}
