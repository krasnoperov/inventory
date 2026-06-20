export const PAID_GENERATION_ENTITLEMENTS = ['none', 'paid', 'internal'] as const;

export type PaidGenerationEntitlement = (typeof PAID_GENERATION_ENTITLEMENTS)[number];

export const PAID_GENERATION_REQUIRED_MESSAGE =
  'Paid Generation is not enabled for this account. Start Paid Generation in Profile.';

export function normalizePaidGenerationEntitlement(value: unknown): PaidGenerationEntitlement {
  return value === 'paid' || value === 'internal' ? value : 'none';
}

export function hasPaidGenerationAccess(entitlement: PaidGenerationEntitlement): boolean {
  return entitlement === 'paid' || entitlement === 'internal';
}

export function isNonBillablePaidGenerationEntitlement(entitlement: PaidGenerationEntitlement): boolean {
  return entitlement === 'internal';
}

export function isPaidGenerationAccessExpired(
  entitlement: PaidGenerationEntitlement,
  paidAccessExpiresAt: string | null | undefined,
  now = new Date()
): boolean {
  if (entitlement !== 'paid' || !paidAccessExpiresAt) return false;
  const expiresAt = new Date(paidAccessExpiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= now.getTime();
}

/**
 * Whether a user is an admin, based on the comma-separated ADMIN_USER_IDS env var.
 * Centralizes the parsing used by both the admin middleware and entitlement resolution.
 */
export function isAdminUserId(userId: number | string, adminUserIds: string | undefined): boolean {
  if (!adminUserIds) return false;
  const allowed = adminUserIds.split(',').map((id) => id.trim()).filter(Boolean);
  return allowed.includes(String(userId));
}

/**
 * Resolve a user's effective paid-generation entitlement.
 *
 * Admins (ADMIN_USER_IDS) are always treated as 'internal' — non-billable access
 * to every tool — regardless of the stored column, so they keep access even when
 * billing is unconfigured or a Polar sync writes 'none'.
 */
export function resolveEntitlement(
  storedValue: unknown,
  userId: number | string,
  adminUserIds: string | undefined
): PaidGenerationEntitlement {
  if (isAdminUserId(userId, adminUserIds)) return 'internal';
  return normalizePaidGenerationEntitlement(storedValue);
}
