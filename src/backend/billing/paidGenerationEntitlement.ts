export const PAID_GENERATION_ENTITLEMENTS = ['none', 'paid', 'internal'] as const;

export type PaidGenerationEntitlement = (typeof PAID_GENERATION_ENTITLEMENTS)[number];

export const PAID_GENERATION_REQUIRED_MESSAGE =
  'Paid generation is not enabled for this account. Please upgrade your plan.';

export function normalizePaidGenerationEntitlement(value: unknown): PaidGenerationEntitlement {
  return value === 'paid' || value === 'internal' ? value : 'none';
}

export function hasPaidGenerationAccess(entitlement: PaidGenerationEntitlement): boolean {
  return entitlement === 'paid' || entitlement === 'internal';
}

export function isNonBillablePaidGenerationEntitlement(entitlement: PaidGenerationEntitlement): boolean {
  return entitlement === 'internal';
}
