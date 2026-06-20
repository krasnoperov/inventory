import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types';
import { UsageEventDAO } from './usage-event-dao';
import { ProviderUsageLedgerDAO } from './provider-usage-ledger-dao';
import { CustomerChargeLedgerDAO } from './customer-charge-ledger-dao';
import { createTestDatabase, cleanupTestDatabase } from '../test-utils/database';
import { TestUserBuilder } from '../test-utils/test-data-builders';

describe('ProviderUsageLedgerDAO', () => {
  let db: Kysely<Database>;
  let ledgerDAO: ProviderUsageLedgerDAO;
  let usageEventDAO: UsageEventDAO;
  let chargeLedgerDAO: CustomerChargeLedgerDAO;
  let userId: number;

  beforeEach(async () => {
    db = await createTestDatabase();
    ledgerDAO = new ProviderUsageLedgerDAO(db);
    usageEventDAO = new UsageEventDAO(db);
    chargeLedgerDAO = new CustomerChargeLedgerDAO(db);

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
    const chargeEntry = await chargeLedgerDAO.findByUsageEventId(usageEventId);
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
    assert.ok(chargeEntry);
    assert.equal(chargeEntry.provider_usage_ledger_id, id);
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

  test('summarizes provider spend with filters and unpriced rows', async () => {
    await ledgerDAO.create({
      attributionKey: 'variant:variant-4:gemini_images',
      userId,
      spaceId: 'space-1',
      assetId: 'asset-1',
      variantId: 'variant-4',
      provider: 'gemini',
      providerModel: 'gemini-3-pro-image-preview',
      operation: 'generate',
      mediaKind: 'image',
      meterEventName: 'gemini_images',
      usageUnit: 'image',
      quantity: 1,
      amountMicroUsd: 240000,
      pricingSource: 'gemini',
      createdAt: '2026-06-10T00:00:00.000Z',
    });
    await ledgerDAO.create({
      attributionKey: 'variant:variant-5:gemini_output_tokens',
      userId,
      spaceId: 'space-1',
      assetId: 'asset-2',
      variantId: 'variant-5',
      provider: 'gemini',
      providerModel: 'gemini-3-pro-image-preview',
      operation: 'generate',
      mediaKind: 'image',
      meterEventName: 'gemini_output_tokens',
      usageUnit: 'token',
      quantity: 100,
      amountMicroUsd: null,
      createdAt: '2026-06-11T00:00:00.000Z',
    });
    await ledgerDAO.create({
      attributionKey: 'variant:variant-6:elevenlabs_audio',
      userId,
      spaceId: 'space-2',
      assetId: 'asset-3',
      variantId: 'variant-6',
      provider: 'elevenlabs',
      providerModel: 'eleven_multilingual_v2',
      operation: 'generate',
      mediaKind: 'audio',
      meterEventName: 'elevenlabs_audio',
      usageUnit: 'character',
      quantity: 20,
      amountMicroUsd: 66000,
      pricingSource: 'elevenlabs',
      createdAt: '2026-06-12T00:00:00.000Z',
    });

    const summary = await ledgerDAO.getSpendSummary({
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-30T23:59:59.999Z',
      spaceId: 'space-1',
      provider: 'gemini',
    });

    assert.deepEqual(summary.period, {
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-30T23:59:59.999Z',
    });
    assert.deepEqual(summary.filters, {
      userId: null,
      spaceId: 'space-1',
      provider: 'gemini',
      mediaKind: null,
    });
    assert.deepEqual(summary.totals, {
      amountMicroUsd: 240000,
      amountUsd: 0.24,
      quantity: 101,
      entries: 2,
      unpricedEntries: 1,
    });
    assert.deepEqual(summary.byProvider, [
      {
        provider: 'gemini',
        amountMicroUsd: 240000,
        amountUsd: 0.24,
        quantity: 101,
        entries: 2,
        unpricedEntries: 1,
      },
    ]);
    assert.deepEqual(summary.byMediaKind, [
      {
        mediaKind: 'image',
        amountMicroUsd: 240000,
        amountUsd: 0.24,
        quantity: 101,
        entries: 2,
        unpricedEntries: 1,
      },
    ]);
    assert.deepEqual(summary.byMeterEventName.map((row) => row.meterEventName).sort(), [
      'gemini_images',
      'gemini_output_tokens',
    ]);
    assert.deepEqual(summary.bySpace, [
      {
        spaceId: 'space-1',
        amountMicroUsd: 240000,
        amountUsd: 0.24,
        quantity: 101,
        entries: 2,
        unpricedEntries: 1,
      },
    ]);
    assert.deepEqual(summary.byAsset, [
      {
        spaceId: 'space-1',
        assetId: 'asset-1',
        amountMicroUsd: 240000,
        amountUsd: 0.24,
        quantity: 1,
        entries: 1,
        unpricedEntries: 0,
      },
      {
        spaceId: 'space-1',
        assetId: 'asset-2',
        amountMicroUsd: 0,
        amountUsd: 0,
        quantity: 100,
        entries: 1,
        unpricedEntries: 1,
      },
    ]);
  });

  test('date-only spend bounds include the whole selected day', async () => {
    await ledgerDAO.create({
      attributionKey: 'variant:variant-before:gemini_images',
      userId,
      spaceId: 'space-1',
      variantId: 'variant-before',
      provider: 'gemini',
      providerModel: 'gemini-3-pro-image-preview',
      mediaKind: 'image',
      meterEventName: 'gemini_images',
      usageUnit: 'image',
      quantity: 1,
      amountMicroUsd: 120000,
      pricingSource: 'gemini',
      createdAt: '2026-06-29T23:59:59.999Z',
    });
    await ledgerDAO.create({
      attributionKey: 'variant:variant-day:gemini_images',
      userId,
      spaceId: 'space-1',
      variantId: 'variant-day',
      provider: 'gemini',
      providerModel: 'gemini-3-pro-image-preview',
      mediaKind: 'image',
      meterEventName: 'gemini_images',
      usageUnit: 'image',
      quantity: 1,
      amountMicroUsd: 240000,
      pricingSource: 'gemini',
      createdAt: '2026-06-30T12:00:00.000Z',
    });
    await ledgerDAO.create({
      attributionKey: 'variant:variant-after:gemini_images',
      userId,
      spaceId: 'space-1',
      variantId: 'variant-after',
      provider: 'gemini',
      providerModel: 'gemini-3-pro-image-preview',
      mediaKind: 'image',
      meterEventName: 'gemini_images',
      usageUnit: 'image',
      quantity: 1,
      amountMicroUsd: 360000,
      pricingSource: 'gemini',
      createdAt: '2026-07-01T00:00:00.000Z',
    });

    const summary = await ledgerDAO.getSpendSummary({
      from: '2026-06-30',
      to: '2026-06-30',
    });

    assert.deepEqual(summary.period, {
      from: '2026-06-30T00:00:00.000Z',
      to: '2026-06-30T23:59:59.999Z',
    });
    assert.deepEqual(summary.totals, {
      amountMicroUsd: 240000,
      amountUsd: 0.24,
      quantity: 1,
      entries: 1,
      unpricedEntries: 0,
    });
    assert.deepEqual(summary.byProvider, [
      {
        provider: 'gemini',
        amountMicroUsd: 240000,
        amountUsd: 0.24,
        quantity: 1,
        entries: 1,
        unpricedEntries: 0,
      },
    ]);
    assert.deepEqual(summary.byMeterEventName, [
      {
        meterEventName: 'gemini_images',
        amountMicroUsd: 240000,
        amountUsd: 0.24,
        quantity: 1,
        entries: 1,
        unpricedEntries: 0,
      },
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

  test('reconciles provider cost and linked customer charge rows with exclusive period end', async () => {
    const linkedUsageEventId = await usageEventDAO.create({
      userId,
      eventName: 'gemini_images',
      quantity: 1,
    });
    await ledgerDAO.create({
      attributionKey: 'variant:reconcile-linked:gemini_images',
      usageEventId: linkedUsageEventId,
      userId,
      provider: 'gemini',
      providerModel: 'gemini-3-pro-image-preview',
      meterEventName: 'gemini_images',
      usageUnit: 'image',
      quantity: 1,
      amountMicroUsd: 240000,
      pricingSource: 'gemini',
      createdAt: '2026-06-10T00:00:00.000Z',
    });

    const missingChargeUsageEventId = await usageEventDAO.create({
      userId,
      eventName: 'gemini_output_tokens',
      quantity: 100,
    });
    await ledgerDAO.create({
      attributionKey: 'variant:reconcile-unpriced:gemini_output_tokens',
      usageEventId: missingChargeUsageEventId,
      userId,
      provider: 'gemini',
      providerModel: 'gemini-3-pro-image-preview',
      meterEventName: 'gemini_output_tokens',
      usageUnit: 'token',
      quantity: 100,
      amountMicroUsd: null,
      createdAt: '2026-06-11T00:00:00.000Z',
    });
    await db
      .deleteFrom('customer_charge_ledger')
      .where('usage_event_id', '=', missingChargeUsageEventId)
      .execute();

    await ledgerDAO.create({
      attributionKey: 'variant:next-period:gemini_images',
      userId,
      provider: 'gemini',
      providerModel: 'gemini-3-pro-image-preview',
      meterEventName: 'gemini_images',
      usageUnit: 'image',
      quantity: 1,
      amountMicroUsd: 240000,
      pricingSource: 'gemini',
      createdAt: '2026-07-01T00:00:00.000Z',
    });

    const reconciliation = await ledgerDAO.getCostReconciliation({
      userId,
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    });

    assert.deepEqual(reconciliation.totals, {
      amountMicroUsd: 240000,
      amountUsd: 0.24,
      quantity: 101,
      entries: 2,
      unpricedEntries: 1,
    });
    assert.equal(reconciliation.linkedUsageEvents, 2);
    assert.equal(reconciliation.linkedCustomerCharges, 1);
    assert.equal(reconciliation.missingUsageEventLinks, 0);
    assert.equal(reconciliation.missingCustomerChargeLinks, 1);
    assert.deepEqual(reconciliation.byMeterEventName.map((row) => ({
      meterEventName: row.meterEventName,
      quantity: row.quantity,
      entries: row.entries,
      unpricedEntries: row.unpricedEntries,
    })), [
      { meterEventName: 'gemini_images', quantity: 1, entries: 1, unpricedEntries: 0 },
      { meterEventName: 'gemini_output_tokens', quantity: 100, entries: 1, unpricedEntries: 1 },
    ]);
  });
});
