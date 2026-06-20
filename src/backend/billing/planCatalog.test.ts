import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { USAGE_EVENTS } from '../services/usageService';
import { BILLING_PLAN_CATALOG, PAID_GENERATION_PLAN } from './planCatalog';
import { EXPECTED_POLAR_METERS } from './polarMeteringContract';

describe('billing plan catalog', () => {
  test('defines the paid generation plan as the Polar checkout-backed plan', () => {
    assert.deepEqual(BILLING_PLAN_CATALOG.map((plan) => plan.key), ['paid_generation']);
    assert.equal(PAID_GENERATION_PLAN.displayName, 'Paid Generation');
    assert.equal(PAID_GENERATION_PLAN.paidGenerationEntitlement, 'paid');
    assert.equal(PAID_GENERATION_PLAN.polar.productIdEnvVar, 'POLAR_PAID_GENERATION_PRODUCT_ID');
    assert.equal(PAID_GENERATION_PLAN.polar.checkoutPurpose, 'paid_generation');
    assert.equal(PAID_GENERATION_PLAN.polar.requiredRecurring, true);
  });

  test('requires every canonical Polar meter as an active product metered price', () => {
    assert.deepEqual(PAID_GENERATION_PLAN.polar.requiredMeteredPriceMeters, EXPECTED_POLAR_METERS);
    assert.deepEqual(PAID_GENERATION_PLAN.polar.allowedMeterCreditBenefitMeters, EXPECTED_POLAR_METERS);
  });

  test('keeps local usage event names aligned with canonical Polar meters', () => {
    assert.deepEqual(
      Object.values(USAGE_EVENTS).sort(),
      [...EXPECTED_POLAR_METERS].sort()
    );
  });
});
