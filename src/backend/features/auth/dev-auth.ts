import type { Env } from '../../../core/types';

const DEFAULT_DEV_AUTH_TOKEN = 'inventory-dev-token';
const DEFAULT_DEV_USER_ID = 1;

function isLocalEnvironment(env: Env): boolean {
  return env.ENVIRONMENT === 'local' || env.ENVIRONMENT === 'development';
}

export function getDevAuthUserId(env: Env, token: string | undefined): number | null {
  if (!isLocalEnvironment(env) || !token) return null;

  const allowedToken = env.INVENTORY_DEV_AUTH_TOKEN || DEFAULT_DEV_AUTH_TOKEN;
  if (token !== allowedToken) return null;

  const configuredUserId = Number(env.INVENTORY_DEV_USER_ID || DEFAULT_DEV_USER_ID);
  if (!Number.isInteger(configuredUserId) || configuredUserId <= 0) return DEFAULT_DEV_USER_ID;
  return configuredUserId;
}

export async function ensureDevAuthUser(env: Env, userId: number): Promise<void> {
  await env.DB
    .prepare(`
      INSERT INTO users (
        id, email, name, google_id, paid_generation_entitlement, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, 'internal', datetime('now'), datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        paid_generation_entitlement = 'internal',
        updated_at = datetime('now')
    `)
    .bind(userId, `dev-${userId}@inventory.local`, `Dev User ${userId}`, `dev-${userId}`)
    .run();
}
