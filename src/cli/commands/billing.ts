import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import { loadStoredConfig, resolveBaseUrl } from '../lib/config';

export async function handleBilling(parsed: ParsedArgs) {
  const subcommand = parsed.positionals[0];
  // Handle --local flag
  const isLocal = parsed.options.local === 'true';
  const env = isLocal ? 'local' : (parsed.options.env ?? 'stage');

  switch (subcommand) {
    case 'status':
      await handleBillingStatus(env);
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
  npm run cli billing <subcommand> [--env <environment>]

Subcommands:
  status           Show sync status (pending, failed, synced events)
  retry-failed     Reset failed events for retry (next cron will sync them)

Options:
  --env <env>      Target environment (production|stage|local), default: stage
  --local          Shortcut for local development

Examples:
  npm run cli billing status                    Show stage sync status
  npm run cli billing status --env production   Show production sync status
  npm run cli billing retry-failed              Reset failed events for retry

Note: Requires login first. Run 'npm run cli login' to authenticate.
`);
}

async function callBillingApi(env: string, path: string, method: 'GET' | 'POST' = 'GET'): Promise<unknown> {
  const config = await loadStoredConfig(env);
  if (!config) {
    throw new Error(
      `Not logged in to ${env} environment.\n` +
      `Run: npm run cli login --env ${env}`
    );
  }

  // Check token expiry
  if (config.token.expiresAt < Date.now()) {
    throw new Error(
      `Token expired for ${env} environment.\n` +
      `Run: npm run cli login --env ${env}`
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
        `Run: npm run cli login --env ${env}`
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
        console.log(`\nTip: Run 'npm run cli billing retry-failed --env ${env}' to reset failed events.`);
      }
    }
  } catch (error) {
    console.error('Failed to get billing status:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
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
      console.log(`\nRun 'npm run cli billing status --env ${env}' to check progress.`);
    }
  } catch (error) {
    console.error('Retry failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
