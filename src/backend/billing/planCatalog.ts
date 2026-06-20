import type { PaidGenerationEntitlement } from './paidGenerationEntitlement';
import { EXPECTED_POLAR_METERS, type PolarMeterName } from './polarMeteringContract';

export type BillingPlanKey = 'paid_generation';
export type BillingProductIdEnvVar = 'POLAR_PAID_GENERATION_PRODUCT_ID';

export interface PolarMeteredProductContract {
  productIdEnvVar: BillingProductIdEnvVar;
  checkoutPurpose: string;
  requiredRecurring: true;
  requiredMeteredPriceMeters: readonly PolarMeterName[];
  allowedMeterCreditBenefitMeters: readonly PolarMeterName[];
}

export interface BillingPlanCatalogEntry {
  key: BillingPlanKey;
  displayName: string;
  paidGenerationEntitlement: Extract<PaidGenerationEntitlement, 'paid'>;
  polar: PolarMeteredProductContract;
}

export const PAID_GENERATION_PLAN = {
  key: 'paid_generation',
  displayName: 'Paid Generation',
  paidGenerationEntitlement: 'paid',
  polar: {
    productIdEnvVar: 'POLAR_PAID_GENERATION_PRODUCT_ID',
    checkoutPurpose: 'paid_generation',
    requiredRecurring: true,
    requiredMeteredPriceMeters: EXPECTED_POLAR_METERS,
    allowedMeterCreditBenefitMeters: EXPECTED_POLAR_METERS,
  },
} as const satisfies BillingPlanCatalogEntry;

export const BILLING_PLAN_CATALOG = [
  PAID_GENERATION_PLAN,
] as const satisfies readonly BillingPlanCatalogEntry[];

export function getBillingPlan(key: string): BillingPlanCatalogEntry | undefined {
  return BILLING_PLAN_CATALOG.find((plan) => plan.key === key);
}
