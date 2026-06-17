import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import { loadStoredConfig, resolveBaseUrl } from '../lib/config';
import { loginCommandForEnvironment, resolveCommandEnvironment } from '../lib/command-context';

export async function handleBilling(parsed: ParsedArgs) {
  const subcommand = parsed.positionals[0];
  const env = resolveCommandEnvironment(parsed);

  switch (subcommand) {
    case 'status':
      await handleBillingStatus(env);
      break;
    case 'check':
    case 'ops-check':
      await handleBillingOpsCheck(env);
      break;
    case 'retry':
    case 'retry-failed':
      await handleBillingRetry(env);
      break;
    default:
      printBillingHelp();
      if (subcommand) {
        console.error(`\nUnknown billing subcommand: ${subcommand}`);
        process.exitCode = 1;
      }
  }
}

function printBillingHelp() {
  console.log(`
Billing Commands - Polar.sh Usage Sync

Usage:
  pnpm run cli billing <subcommand> [--env <environment>]

Subcommands:
  status           Show sync status (pending, failed, synced events)
  check            Run operational checks for workers, Polar meters, and sync health
  retry-failed     Reset failed events for retry (next cron will sync them)

Options:
  --env <env>      Target environment (production|stage|local), default: production
  --local          Shortcut for local development

Examples:
  pnpm run cli billing status                    Show production sync status
  pnpm run cli billing status --env stage        Show stage sync status
  pnpm run cli billing check                     Run production operational checks
  pnpm run cli billing retry-failed              Reset failed events for retry

Note: Requires login first. Run 'pnpm run cli login' to authenticate.
`);
}

async function callBillingApi(env: string, path: string, method: 'GET' | 'POST' = 'GET'): Promise<unknown> {
  const config = await loadStoredConfig(env);
  if (!config) {
    throw new Error(
      `Not logged in to ${env} environment.\n` +
      `Run: ${loginCommandForEnvironment(env)}`
    );
  }

  // Check token expiry
  if (config.token.expiresAt < Date.now()) {
    throw new Error(
      `Token expired for ${env} environment.\n` +
      `Run: ${loginCommandForEnvironment(env)}`
    );
  }

  const baseUrl = resolveBaseUrl(env);

  // Disable SSL verification for local dev
  if (env === 'local') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${config.token.accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        `Authentication failed. Token may have expired.\n` +
        `Run: ${loginCommandForEnvironment(env)}`
      );
    }
    const text = await response.text();
    throw new Error(`API error (${response.status}): ${text}`);
  }

  return response.json();
}

async function handleBillingStatus(env: string) {
  console.log(`Fetching billing status for ${env}...\n`);

  try {
    const data = await callBillingApi(env, '/api/billing/sync-status') as {
      events: { pending: number; failed: number; synced: number };
      customers: { withoutPolarId: number };
    };

    console.log('=== Billing Sync Status ===\n');

    // Events status
    console.log('Usage Events:');
    console.log(`  Pending:  ${data.events.pending}`);
    console.log(`  Failed:   ${data.events.failed}`);
    console.log(`  Synced:   ${data.events.synced}`);

    // Customers status
    console.log('\nCustomers:');
    console.log(`  Without Polar ID: ${data.customers.withoutPolarId}`);

    // Summary
    const totalUnsyncedEvents = data.events.pending + data.events.failed;
    const totalUnsynced = totalUnsyncedEvents + data.customers.withoutPolarId;

    if (totalUnsynced === 0) {
      console.log('\nAll caught up! No pending sync operations.');
    } else {
      console.log(`\nTotal items needing attention: ${totalUnsynced}`);
      if (data.events.failed > 0) {
        console.log(`\nTip: Run 'pnpm run cli billing retry-failed --env ${env}' to reset failed events.`);
      }
    }
  } catch (error) {
    console.error('Failed to get billing status:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

type OperationalStatus = 'ok' | 'warning' | 'critical';

interface BillingOperationalChecksResponse {
  generatedAt: string;
  environment: string;
  status: OperationalStatus;
  checks: {
    polarMeters: {
      status: OperationalStatus;
      configured: boolean;
      error: string | null;
      expected: string[];
      active: Array<{ id: string; name: string; aggregation: string; archivedAt: string | null }>;
      missing: string[];
    };
    syncHealth: {
      status: OperationalStatus;
      pendingWarnAfterSeconds: number;
      events: {
        pending: number;
        failed: number;
        synced: number;
        oldestPendingCreatedAt: string | null;
        oldestFailedCreatedAt: string | null;
        lastSyncedAt: string | null;
        lastSyncAttemptAt: string | null;
        oldestPendingAgeSeconds: number | null;
        oldestFailedAgeSeconds: number | null;
        lastSyncedAgeSeconds: number | null;
        lastSyncAttemptAgeSeconds: number | null;
      };
      customers: { withoutPolarId: number };
    };
    internalUsers: {
      status: OperationalStatus;
      internalUsers: number;
      billableEvents: number;
      nonBillableEvents: number;
    };
  };
}

interface WorkerCheck {
  name: string;
  url: string;
  status: OperationalStatus;
  message: string;
}

function workerHealthUrls(env: string): Array<{ name: string; url: string }> {
  if (env === 'production') {
    return [
      { name: 'application', url: 'https://inventory.krasnoperov.me/api/health' },
      { name: 'processing', url: 'https://inventory-processing.krasnoperov.me/api/health' },
      { name: 'polar', url: 'https://inventory-polar.krasnoperov.me/api/health' },
    ];
  }

  if (env === 'stage') {
    return [
      { name: 'application', url: 'https://inventory-stage.krasnoperov.me/api/health' },
      { name: 'processing', url: 'https://inventory-processing-stage.krasnoperov.me/api/health' },
      { name: 'polar', url: 'https://inventory-polar-stage.krasnoperov.me/api/health' },
    ];
  }

  return [
    { name: 'application', url: 'http://localhost:3001/api/health' },
    { name: 'processing', url: 'http://localhost:8789/api/health' },
    { name: 'polar', url: 'http://localhost:8790/api/health' },
  ];
}

async function checkWorkerHealth(env: string): Promise<WorkerCheck[]> {
  return await Promise.all(workerHealthUrls(env).map(async ({ name, url }) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) {
        return {
          name,
          url,
          status: 'critical' as const,
          message: `HTTP ${response.status}`,
        };
      }

      const body = await response.json() as { status?: string; worker?: string; environment?: string };
      if (body.status !== 'ok') {
        return {
          name,
          url,
          status: 'critical' as const,
          message: `unexpected status ${JSON.stringify(body.status)}`,
        };
      }

      return {
        name,
        url,
        status: 'ok' as const,
        message: body.worker ? `worker=${body.worker}` : `environment=${body.environment ?? 'unknown'}`,
      };
    } catch (error) {
      return {
        name,
        url,
        status: 'critical' as const,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }));
}

function statusLabel(status: OperationalStatus): string {
  return status.toUpperCase().padEnd(8);
}

function secondsSummary(seconds: number | null): string {
  if (seconds === null) return 'n/a';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

async function handleBillingOpsCheck(env: string) {
  console.log(`Running billing operational checks for ${env}...\n`);

  const [workerChecks, billingChecks] = await Promise.all([
    checkWorkerHealth(env),
    callBillingApi(env, '/api/billing/operational-checks') as Promise<BillingOperationalChecksResponse>,
  ]);

  console.log('=== Billing Operational Checks ===\n');

  console.log('Workers:');
  for (const check of workerChecks) {
    console.log(`  ${statusLabel(check.status)} ${check.name.padEnd(12)} ${check.message}`);
  }

  const meterCheck = billingChecks.checks.polarMeters;
  console.log('\nPolar meters:');
  console.log(`  ${statusLabel(meterCheck.status)} configured=${meterCheck.configured} active=${meterCheck.active.length} expected=${meterCheck.expected.length}`);
  if (meterCheck.error) {
    console.log(`  Error: ${meterCheck.error}`);
  }
  if (meterCheck.missing.length > 0) {
    console.log(`  Missing: ${meterCheck.missing.join(', ')}`);
  }

  const syncCheck = billingChecks.checks.syncHealth;
  console.log('\nSync health:');
  console.log(`  ${statusLabel(syncCheck.status)} pending=${syncCheck.events.pending} failed=${syncCheck.events.failed} synced=${syncCheck.events.synced}`);
  console.log(`  Oldest pending age: ${secondsSummary(syncCheck.events.oldestPendingAgeSeconds)} (warns after ${secondsSummary(syncCheck.pendingWarnAfterSeconds)})`);
  console.log(`  Customers without Polar ID: ${syncCheck.customers.withoutPolarId}`);

  const internalCheck = billingChecks.checks.internalUsers;
  console.log('\nInternal users:');
  console.log(`  ${statusLabel(internalCheck.status)} users=${internalCheck.internalUsers} nonBillableEvents=${internalCheck.nonBillableEvents} billableEvents=${internalCheck.billableEvents}`);

  const hasCriticalWorker = workerChecks.some((check) => check.status === 'critical');
  const hasCriticalBilling = billingChecks.status === 'critical';
  const hasWarning = workerChecks.some((check) => check.status === 'warning') || billingChecks.status === 'warning';

  if (hasCriticalWorker || hasCriticalBilling) {
    console.log('\nResult: CRITICAL - production billing operations need attention.');
    process.exitCode = 1;
  } else if (hasWarning) {
    console.log('\nResult: WARNING - billing is operational but has lag or cleanup work.');
  } else {
    console.log('\nResult: OK - billing workers, meters, and sync health are ready.');
  }
}

async function handleBillingRetry(env: string) {
  console.log(`Resetting failed events for ${env}...\n`);

  try {
    const data = await callBillingApi(env, '/api/billing/retry-failed', 'POST') as {
      reset: number;
      message: string;
    };

    console.log('=== Retry Results ===\n');
    console.log(data.message);

    if (data.reset > 0) {
      console.log(`\nRun 'pnpm run cli billing status --env ${env}' to check progress.`);
    }
  } catch (error) {
    console.error('Retry failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
