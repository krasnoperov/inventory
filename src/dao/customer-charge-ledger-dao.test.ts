import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types';
import { UsageEventDAO } from './usage-event-dao';
import { CustomerChargeLedgerDAO } from './customer-charge-ledger-dao';
import { createTestDatabase, cleanupTestDatabase } from '../test-utils/database';
import { TestUserBuilder } from '../test-utils/test-data-builders';

describe('CustomerChargeLedgerDAO', () => {
  let db: Kysely<Database>;
  let usageEventDAO: UsageEventDAO;
  let chargeLedgerDAO: CustomerChargeLedgerDAO;
  let userId: number;

  beforeEach(async () => {
    db = await createTestDatabase();
    usageEventDAO = new UsageEventDAO(db);
    chargeLedgerDAO = new CustomerChargeLedgerDAO(db);

    const user = await new TestUserBuilder()
      .withEmail('customer-charge-ledger@example.com')
      .withName('Customer Charge Ledger User')
      .create(db);
    userId = user.id;
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  test('records a customer charge row for usage events', async () => {
    const usageEventId = await usageEventDAO.create({
      userId,
      eventName: 'gemini_videos',
      quantity: 2,
      metadata: { model: 'veo-3.1-generate-preview', resolution: '720p' },
    });

    const charge = await chargeLedgerDAO.findByUsageEventId(usageEventId);

    assert.ok(charge);
    assert.equal(charge.charge_key, `usage_event:${usageEventId}`);
    assert.equal(charge.usage_event_id, usageEventId);
    assert.equal(charge.provider_usage_ledger_id, null);
    assert.equal(charge.user_id, userId);
    assert.equal(charge.meter_event_name, 'gemini_videos');
    assert.equal(charge.charge_unit, 'video_unit');
    assert.equal(charge.quantity, 2);
    assert.equal(charge.polar_billable, 1);
    assert.equal(charge.billing_provider, 'polar');
    assert.equal(charge.billing_external_id, usageEventId);
    assert.deepEqual(JSON.parse(charge.metadata!), {
      model: 'veo-3.1-generate-preview',
      resolution: '720p',
    });
  });

  test('preserves non-billable customer charge audit rows', async () => {
    const usageEventId = await usageEventDAO.create({
      userId,
      eventName: 'claude_input_tokens',
      quantity: 100,
      metadata: { model: 'claude-sonnet-4' },
      polarBillable: false,
    });

    const charge = await chargeLedgerDAO.findByUsageEventId(usageEventId);

    assert.ok(charge);
    assert.equal(charge.meter_event_name, 'claude_input_tokens');
    assert.equal(charge.charge_unit, 'token');
    assert.equal(charge.polar_billable, 0);
  });

  test('reconciles billable usage against customer charge rows', async () => {
    await usageEventDAO.create({
      userId,
      eventName: 'gemini_images',
      quantity: 2,
    });
    const missingChargeUsageEventId = await usageEventDAO.create({
      userId,
      eventName: 'gemini_videos',
      quantity: 1,
    });
    await usageEventDAO.create({
      userId,
      eventName: 'gemini_images',
      quantity: 1,
      polarBillable: false,
    });
    await db
      .deleteFrom('customer_charge_ledger')
      .where('usage_event_id', '=', missingChargeUsageEventId)
      .execute();

    const reconciliation = await chargeLedgerDAO.getReconciliationForPeriod(
      userId,
      '2026-01-01T00:00:00.000Z',
      '2100-01-01T00:00:00.000Z'
    );

    assert.equal(reconciliation.usageEvents, 3);
    assert.equal(reconciliation.chargeRows, 2);
    assert.equal(reconciliation.missingChargeRows, 1);
    assert.equal(reconciliation.billableUsageQuantity, 3);
    assert.equal(reconciliation.billableChargeQuantity, 2);
    assert.equal(reconciliation.billableQuantityDelta, 1);
    assert.deepEqual(reconciliation.meters, [
      { name: 'gemini_images', usageQuantity: 2, chargeQuantity: 2, delta: 0, matched: true },
      { name: 'gemini_videos', usageQuantity: 1, chargeQuantity: 0, delta: 1, matched: false },
    ]);
  });
});
