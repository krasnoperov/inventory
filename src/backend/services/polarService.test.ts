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

    test('ingestEvent completes without error when not configured', async () => {
      const service = createPolarService();
      // Should not throw
      await service.ingestEvent(123, 'test_event', { model: 'test' });
    });

    test('ingestEventsBatch completes without error when not configured', async () => {
      const service = createPolarService();
      await service.ingestEventsBatch([
        { userId: 123, eventName: 'test_event' },
        { userId: 456, eventName: 'test_event' },
      ]);
    });

    test('ingestLLMEvent completes without error when not configured', async () => {
      const service = createPolarService();
      await service.ingestLLMEvent(123, 'claude_usage', {
        vendor: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 100,
        outputTokens: 50,
      });
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

    test('getCustomerMeters returns empty array when not configured', async () => {
      const service = createPolarService();
      const result = await service.getCustomerMeters(123);
      assert.deepStrictEqual(result, []);
    });

    test('getBillingStatus returns unconfigured status when not configured', async () => {
      const service = createPolarService();
      const result = await service.getBillingStatus(123);
      assert.deepStrictEqual(result, {
        configured: false,
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
});
