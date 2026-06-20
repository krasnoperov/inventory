import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types';
import { UsageEventDAO } from './usage-event-dao';
import { ProviderUsageLedgerDAO } from './provider-usage-ledger-dao';
import { createTestDatabase, cleanupTestDatabase } from '../test-utils/database';
import { TestUserBuilder } from '../test-utils/test-data-builders';

describe('ProviderUsageLedgerDAO', () => {
  let db: Kysely<Database>;
  let ledgerDAO: ProviderUsageLedgerDAO;
  let usageEventDAO: UsageEventDAO;
  let userId: number;

  beforeEach(async () => {
    db = await createTestDatabase();
    ledgerDAO = new ProviderUsageLedgerDAO(db);
    usageEventDAO = new UsageEventDAO(db);

    const user = await new TestUserBuilder()
      .withEmail('provider-ledger@example.com')
      .withName('Provider Ledger User')
      .create(db);
    userId = user.id;
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  test('persists provider spend with attribution keys', async () => {
    const usageEventId = await usageEventDAO.create({
      userId,
      eventName: 'gemini_images',
      quantity: 1,
      metadata: { model: 'gemini-3-pro-image-preview' },
    });

    const id = await ledgerDAO.create({
      attributionKey: 'variant:variant-1:gemini_images',
      usageEventId,
      userId,
      spaceId: 'space-1',
      assetId: 'asset-1',
      variantId: 'variant-1',
      workflowId: 'workflow-1',
      requestId: 'request-1',
      provider: 'gemini',
      providerModel: 'gemini-3-pro-image-preview',
      operation: 'generate',
      mediaKind: 'image',
      meterEventName: 'gemini_images',
      usageUnit: 'image',
      quantity: 1,
      unitPriceUsd: 0.24,
      amountMicroUsd: 240000,
      pricingSource: 'gemini',
      providerRequestId: 'provider-request-1',
      providerUsageId: 'provider-usage-1',
      metadata: { imageSize: '4K' },
    });

    const entry = await ledgerDAO.findByAttributionKey('variant:variant-1:gemini_images');
    assert.ok(entry);
    assert.equal(entry.id, id);
    assert.equal(entry.usage_event_id, usageEventId);
    assert.equal(entry.user_id, userId);
    assert.equal(entry.space_id, 'space-1');
    assert.equal(entry.asset_id, 'asset-1');
    assert.equal(entry.variant_id, 'variant-1');
    assert.equal(entry.workflow_id, 'workflow-1');
    assert.equal(entry.request_id, 'request-1');
    assert.equal(entry.provider, 'gemini');
    assert.equal(entry.provider_model, 'gemini-3-pro-image-preview');
    assert.equal(entry.media_kind, 'image');
    assert.equal(entry.usage_unit, 'image');
    assert.equal(entry.unit_price_usd, 0.24);
    assert.equal(entry.amount_micro_usd, 240000);
    assert.deepEqual(JSON.parse(entry.metadata!), { imageSize: '4K' });
  });

  test('finds ledger entries by generated variant', async () => {
    await ledgerDAO.create({
      attributionKey: 'variant:variant-2:gemini_images',
      userId,
      variantId: 'variant-2',
      provider: 'gemini',
      providerModel: 'gemini-3-pro-image-preview',
      usageUnit: 'image',
      quantity: 1,
    });
    await ledgerDAO.create({
      attributionKey: 'variant:variant-2:gemini_output_tokens',
      userId,
      variantId: 'variant-2',
      provider: 'gemini',
      providerModel: 'gemini-3-pro-image-preview',
      usageUnit: 'token',
      quantity: 100,
    });

    const entries = await ledgerDAO.findByVariant('variant-2');
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((entry) => entry.attribution_key).sort(), [
      'variant:variant-2:gemini_images',
      'variant:variant-2:gemini_output_tokens',
    ]);
  });

  test('rejects duplicate attribution keys', async () => {
    const data = {
      attributionKey: 'variant:variant-3:gemini_images',
      userId,
      variantId: 'variant-3',
      provider: 'gemini',
      providerModel: 'gemini-3-pro-image-preview',
      usageUnit: 'image',
      quantity: 1,
    };

    await ledgerDAO.create(data);
    await assert.rejects(() => ledgerDAO.create(data), /UNIQUE constraint failed/);
  });
});
