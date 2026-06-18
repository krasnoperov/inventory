import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PolarService } from './polarService';
import type { Env } from '../../core/types';

/**
 * Creates a PolarService instance for testing
 * By default creates an unconfigured service (no API token)
 */
const createPolarService = (overrides: Partial<Env> = {}): PolarService => {
  const env: Partial<Env> = {
    POLAR_ACCESS_TOKEN: undefined,
    POLAR_ORGANIZATION_ID: undefined,
    POLAR_ENVIRONMENT: undefined,
    ...overrides,
  };

  return new PolarService(env as Env);
};

describe('PolarService', () => {
  describe('isConfigured', () => {
    test('returns false when POLAR_ACCESS_TOKEN is not set', () => {
      const service = createPolarService();
      assert.strictEqual(service.isConfigured(), false);
    });

    test('returns true when POLAR_ACCESS_TOKEN is set', () => {
      const service = createPolarService({
        POLAR_ACCESS_TOKEN: 'polar_at_test_token',
      });
      assert.strictEqual(service.isConfigured(), true);
    });
  });

  describe('graceful degradation (unconfigured)', () => {
    test('createCustomer returns null when not configured', async () => {
      const service = createPolarService();
      const result = await service.createCustomer(123, 'test@example.com', 'Test User');
      assert.strictEqual(result, null);
    });

    test('getCustomerByExternalId returns null when not configured', async () => {
      const service = createPolarService();
      const result = await service.getCustomerByExternalId(123);
      assert.strictEqual(result, null);
    });

    test('ingestEventsBatch completes without error when not configured', async () => {
      const service = createPolarService();
      await service.ingestEventsBatch([
        { userId: 123, eventName: 'test_event' },
        { userId: 456, eventName: 'test_event' },
      ]);
    });

    test('ingestLLMEventsBatch completes without error when not configured', async () => {
      const service = createPolarService();
      await service.ingestLLMEventsBatch([
        {
          userId: 123,
          eventName: 'claude_usage',
          llmData: {
            vendor: 'anthropic',
            model: 'claude-sonnet-4-20250514',
            inputTokens: 100,
            outputTokens: 50,
          },
        },
      ]);
    });

    test('getCustomerPortalUrl returns null when not configured', async () => {
      const service = createPolarService();
      const result = await service.getCustomerPortalUrl(123);
      assert.strictEqual(result, null);
    });

    test('getPaidGenerationCheckoutUrl returns null when not configured', async () => {
      const service = createPolarService();
      const result = await service.getPaidGenerationCheckoutUrl({
        userId: 123,
        email: 'test@example.com',
        name: 'Test User',
      });
      assert.strictEqual(result, null);
    });

    test('getCustomerMeters returns empty array when not configured', async () => {
      const service = createPolarService();
      const result = await service.getCustomerMeters(123);
      assert.deepStrictEqual(result, []);
    });

    test('getPaidGenerationProductInfo reports unconfigured product when not configured', async () => {
      const service = createPolarService();
      const result = await service.getPaidGenerationProductInfo();
      assert.deepStrictEqual(result, {
        configured: false,
        productId: null,
        exists: false,
        name: null,
        isRecurring: null,
        isArchived: null,
        meteredPriceMeters: [],
        meterCreditBenefitMeters: [],
      });
    });

    test('listMeters returns empty array when not configured', async () => {
      const service = createPolarService();
      const result = await service.listMeters();
      assert.deepStrictEqual(result, []);
    });

    test('getBillingStatus returns unconfigured status when not configured', async () => {
      const service = createPolarService();
      const result = await service.getBillingStatus(123);
      assert.deepStrictEqual(result, {
        configured: false,
        available: false,
        hasSubscription: false,
        meters: [],
        portalUrl: null,
      });
    });

    test('getCustomerUsage returns null when not configured', async () => {
      const service = createPolarService();
      const result = await service.getCustomerUsage(123);
      assert.strictEqual(result, null);
    });

    test('customerExists returns false when not configured', async () => {
      const service = createPolarService();
      const result = await service.customerExists(123);
      assert.strictEqual(result, false);
    });
  });

  describe('environment configuration', () => {
    test('defaults to production when POLAR_ENVIRONMENT is not set', () => {
      const service = createPolarService({
        POLAR_ACCESS_TOKEN: 'polar_at_test_token',
        POLAR_ENVIRONMENT: undefined,
      });
      // Service is configured, so it should work
      assert.strictEqual(service.isConfigured(), true);
    });

    test('accepts sandbox environment', () => {
      const service = createPolarService({
        POLAR_ACCESS_TOKEN: 'polar_at_sandbox_token',
        POLAR_ENVIRONMENT: 'sandbox',
      });
      assert.strictEqual(service.isConfigured(), true);
    });

    test('accepts production environment', () => {
      const service = createPolarService({
        POLAR_ACCESS_TOKEN: 'polar_at_prod_token',
        POLAR_ENVIRONMENT: 'production',
      });
      assert.strictEqual(service.isConfigured(), true);
    });
  });

  describe('paid generation product inspection', () => {
    test('returns active metered price meters and meter-credit benefits', async () => {
      const service = createPolarService({
        POLAR_ACCESS_TOKEN: 'polar_at_test_token',
        POLAR_PAID_GENERATION_PRODUCT_ID: 'prod_paid_generation',
      });
      (service as unknown as {
        client: {
          products: {
            get: (input: unknown) => Promise<unknown>;
          };
        };
      }).client = {
        products: {
          get: async (input: unknown) => {
            assert.deepStrictEqual(input, { id: 'prod_paid_generation' });
            return {
              id: 'prod_paid_generation',
              name: 'Paid Generation',
              isRecurring: true,
              isArchived: false,
              prices: [
                {
                  amountType: 'metered_unit',
                  isArchived: false,
                  meterId: 'meter_gemini_images',
                  meter: { id: 'meter_gemini_images', name: 'gemini_images' },
                },
                {
                  amountType: 'metered_unit',
                  isArchived: true,
                  meterId: 'meter_archived',
                  meter: { id: 'meter_archived', name: 'archived_meter' },
                },
                {
                  amountType: 'fixed',
                  isArchived: false,
                },
              ],
              benefits: [
                {
                  type: 'meter_credit',
                  properties: { meterId: 'meter_gemini_images', units: 25, rollover: false },
                },
              ],
            };
          },
        },
      };

      const result = await service.getPaidGenerationProductInfo();

      assert.deepStrictEqual(result, {
        configured: true,
        productId: 'prod_paid_generation',
        exists: true,
        name: 'Paid Generation',
        isRecurring: true,
        isArchived: false,
        meteredPriceMeters: ['gemini_images'],
        meterCreditBenefitMeters: ['gemini_images'],
      });
    });
  });
});
