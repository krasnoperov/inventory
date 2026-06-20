import process from 'node:process';
import type { ParsedArgs, StoredConfig } from '../lib/types';
import { loadStoredConfig, resolveBaseUrl } from '../lib/config';
import { loadProjectConfig, type ProjectConfig } from '../lib/project-config';
import {
  loginCommandForEnvironment,
  resolveCommandEnvironment,
} from '../lib/command-context';

type SpendMediaKind = 'image' | 'audio' | 'video';

interface SpendAggregate {
  amountMicroUsd: number;
  amountUsd: number;
  quantity: number;
  entries: number;
  unpricedEntries: number;
}

interface SpendProviderSummary extends SpendAggregate {
  provider: string;
}

interface SpendModelSummary extends SpendAggregate {
  provider: string;
  providerModel: string;
}

interface SpendMediaKindSummary extends SpendAggregate {
  mediaKind: SpendMediaKind | null;
}

interface SpendMeterSummary extends SpendAggregate {
  meterEventName: string | null;
}

interface SpendSummary {
  success: true;
  period: {
    from: string | null;
    to: string | null;
  };
  filters: {
    userId: number | null;
    spaceId: string | null;
    provider: string | null;
    mediaKind: SpendMediaKind | null;
  };
  totals: SpendAggregate;
  byProvider: SpendProviderSummary[];
  byModel: SpendModelSummary[];
  byMediaKind: SpendMediaKindSummary[];
  byMeterEventName: SpendMeterSummary[];
}

type SpendResult = { type: 'summary'; summary: SpendSummary };

interface SpendDeps {
  loadConfig: (env: string) => Promise<StoredConfig | null>;
  loadProjectConfig: () => Promise<ProjectConfig | null>;
  resolveBaseUrl: (env: string) => string;
  fetch: typeof fetch;
  print: (message: string) => void;
}

interface SpendContext {
  env: string;
  baseUrl: string;
  accessToken: string;
}

const defaultDeps: SpendDeps = {
  loadConfig: loadStoredConfig,
  loadProjectConfig,
  resolveBaseUrl,
  fetch,
  print: console.log,
};

export async function handleSpend(parsed: ParsedArgs): Promise<void> {
  try {
    await executeSpend(parsed);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    printSpend();
    process.exitCode = 1;
  }
}

export async function executeSpend(
  parsed: ParsedArgs,
  deps: SpendDeps = defaultDeps
): Promise<SpendResult> {
  const subcommand = parsed.positionals[0] || 'summary';
  if (subcommand !== 'summary') {
    throw new Error(`Unknown spend command: ${subcommand}`);
  }

  const ctx = await buildContext(parsed, deps);
  const summary = await fetchSpendSummary(ctx, deps, {
    from: optionValue(parsed.options.from),
    to: optionValue(parsed.options.to),
    userId: optionValue(parsed.options['user-id'] ?? parsed.options.userId),
    spaceId: optionValue(parsed.options['space-id'] ?? parsed.options.spaceId ?? parsed.options.space),
    provider: optionValue(parsed.options.provider),
    mediaKind: optionValue(parsed.options['media-kind'] ?? parsed.options.mediaKind),
  });

  if (parsed.options.json === 'true') {
    deps.print(JSON.stringify(summary, null, 2));
  } else {
    printSpendSummary(summary, deps.print);
  }

  return { type: 'summary', summary };
}

async function buildContext(parsed: ParsedArgs, deps: SpendDeps): Promise<SpendContext> {
  const projectConfig = await deps.loadProjectConfig();
  const env = resolveCommandEnvironment(parsed, projectConfig);
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
    baseUrl: deps.resolveBaseUrl(env),
    accessToken: config.token.accessToken,
  };
}

async function fetchSpendSummary(
  ctx: SpendContext,
  deps: Pick<SpendDeps, 'fetch'>,
  options: {
    from?: string;
    to?: string;
    userId?: string;
    spaceId?: string;
    provider?: string;
    mediaKind?: string;
  }
): Promise<SpendSummary> {
  const params = new URLSearchParams();
  if (options.from) params.set('from', options.from);
  if (options.to) params.set('to', options.to);
  if (options.userId) params.set('user_id', options.userId);
  if (options.spaceId) params.set('space_id', options.spaceId);
  if (options.provider) params.set('provider', options.provider);
  if (options.mediaKind) params.set('media_kind', options.mediaKind);
  const query = params.toString();
  const response = await deps.fetch(
    `${ctx.baseUrl}/api/billing/spend/summary${query ? `?${query}` : ''}`,
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

  return response.json() as Promise<SpendSummary>;
}

function optionValue(value: string | undefined): string | undefined {
  return !value || value === 'true' ? undefined : value;
}

function printSpendSummary(summary: SpendSummary, print: (message: string) => void): void {
  print('\nSpend summary\n');
  print(`  Period:       ${formatPeriod(summary.period)}`);
  print(`  Filters:      ${formatFilters(summary.filters)}`);
  print(`  Total spend:  ${formatUsd(summary.totals.amountMicroUsd)}`);
  print(`  Entries:      ${summary.totals.entries}`);
  print(`  Unpriced:     ${summary.totals.unpricedEntries}`);
  print(`  Quantity:     ${formatNumber(summary.totals.quantity)}`);

  if (summary.byProvider.length > 0) {
    printSpendTable('\nBy provider:', ['Provider', 'Spend', 'Entries', 'Unpriced', 'Quantity'], summary.byProvider.map((row) => [
      row.provider,
      formatUsd(row.amountMicroUsd),
      String(row.entries),
      String(row.unpricedEntries),
      formatNumber(row.quantity),
    ]), print);
  }

  if (summary.byModel.length > 0) {
    printSpendTable('\nBy model:', ['Provider', 'Model', 'Spend', 'Entries', 'Unpriced'], summary.byModel.map((row) => [
      row.provider,
      row.providerModel,
      formatUsd(row.amountMicroUsd),
      String(row.entries),
      String(row.unpricedEntries),
    ]), print);
  }

  if (summary.byMediaKind.length > 0) {
    printSpendTable('\nBy media kind:', ['Media', 'Spend', 'Entries', 'Unpriced', 'Quantity'], summary.byMediaKind.map((row) => [
      row.mediaKind || '-',
      formatUsd(row.amountMicroUsd),
      String(row.entries),
      String(row.unpricedEntries),
      formatNumber(row.quantity),
    ]), print);
  }

  if (summary.byMeterEventName.length > 0) {
    printSpendTable('\nBy meter:', ['Meter', 'Spend', 'Entries', 'Unpriced', 'Quantity'], summary.byMeterEventName.map((row) => [
      row.meterEventName || '-',
      formatUsd(row.amountMicroUsd),
      String(row.entries),
      String(row.unpricedEntries),
      formatNumber(row.quantity),
    ]), print);
  }
}

function printSpendTable(
  title: string,
  headers: string[],
  rows: string[][],
  print: (message: string) => void
): void {
  print(title);
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)));
  print(headers.map((header, index) => header.padEnd(widths[index] + 2)).join('').trimEnd());
  print(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const row of rows) {
    print(row.map((value, index) => value.padEnd(widths[index] + 2)).join('').trimEnd());
  }
}

function formatPeriod(period: SpendSummary['period']): string {
  if (!period.from && !period.to) return 'all time';
  if (period.from && period.to) return `${period.from} to ${period.to}`;
  if (period.from) return `from ${period.from}`;
  return `through ${period.to}`;
}

function formatFilters(filters: SpendSummary['filters']): string {
  const parts = [
    filters.userId !== null ? `user=${filters.userId}` : null,
    filters.spaceId ? `space=${filters.spaceId}` : null,
    filters.provider ? `provider=${filters.provider}` : null,
    filters.mediaKind ? `media=${filters.mediaKind}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(', ') : 'none';
}

function formatUsd(amountMicroUsd: number): string {
  const value = amountMicroUsd / 1_000_000;
  const fixed = value.toFixed(6);
  let trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '');
  if (!trimmed.includes('.')) {
    trimmed = `${trimmed}.00`;
  } else if (trimmed.split('.')[1].length === 1) {
    trimmed = `${trimmed}0`;
  }
  return `$${trimmed}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function printSpend(): void {
  console.log(`
Usage:
  makefx spend [summary] [--from <date>] [--to <date>]
  makefx spend --user-id <id> --provider <name> --media-kind <image|audio|video>
  makefx spend --json

Options:
  --from <date>        Include spend at or after this date or ISO timestamp
  --to <date>          Include spend at or before this date or ISO timestamp
  --user-id <id>       Filter to one user ID
  --space-id <id>      Filter to one space ID
  --space <id>         Alias for --space-id
  --provider <name>    Filter to one provider
  --media-kind <kind>  Filter to image, audio, or video spend
  --json               Print machine-readable output
  --env <env>          Environment (production|stage|local)
  --local              Shortcut for --env local
`);
}
