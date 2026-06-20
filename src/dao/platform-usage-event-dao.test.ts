import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types';
import { PlatformUsageEventDAO } from './platform-usage-event-dao';
import { createTestDatabase, cleanupTestDatabase } from '../test-utils/database';
import { TestUserBuilder } from '../test-utils/test-data-builders';

describe('PlatformUsageEventDAO', () => {
  let db: Kysely<Database>;
  let dao: PlatformUsageEventDAO;
  let userId: number;

  beforeEach(async () => {
    db = await createTestDatabase();
    dao = new PlatformUsageEventDAO(db);

    const user = await new TestUserBuilder()
      .withEmail('platform-usage@example.com')
      .withName('Platform Usage User')
      .create(db);
    userId = user.id;

    await db.insertInto('spaces').values({
      id: 'space-1',
      name: 'Usage Space',
      owner_id: String(userId),
      created_at: Date.now(),
    }).execute();
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  test('persists platform usage by space and type', async () => {
    await dao.create({
      idempotencyKey: 'storage:space-1:variant-1:generated',
      spaceId: 'space-1',
      userId,
      usageType: 'storage',
      quantity: 2048,
      unit: 'byte',
      assetId: 'asset-1',
      variantId: 'variant-1',
      workflowId: 'workflow-1',
      mediaKind: 'image',
      metadata: { reason: 'generated' },
    });
    await dao.create({
      idempotencyKey: 'delivery:space-1:variant-1:req-1',
      spaceId: 'space-1',
      userId,
      usageType: 'delivery',
      quantity: 512,
      unit: 'byte',
      variantId: 'variant-1',
      artifactKey: 'images/space-1/variant-1.png',
    });

    const events = await dao.findBySpace('space-1');
    assert.equal(events.length, 2);
    assert.deepEqual(await dao.getSpaceTotals('space-1'), {
      delivery: 512,
      storage: 2048,
    });
  });

  test('does not duplicate deterministic idempotency keys', async () => {
    const event = {
      idempotencyKey: 'workflow:space-1:variant-1:start',
      spaceId: 'space-1',
      userId,
      usageType: 'workflow' as const,
      quantity: 1,
      unit: 'run' as const,
      variantId: 'variant-1',
      workflowId: 'variant-1',
    };

    await dao.create(event);
    await dao.create(event);

    const events = await dao.findBySpace('space-1');
    assert.equal(events.length, 1);
    assert.equal(events[0].usage_type, 'workflow');
    assert.deepEqual(await dao.getSpaceTotals('space-1'), { workflow: 1 });
  });

  test('summarizes storage, workflow, and delivery usage within date bounds', async () => {
    await dao.create({
      idempotencyKey: 'storage:old',
      spaceId: 'space-1',
      userId,
      usageType: 'storage',
      quantity: 100,
      unit: 'byte',
      mediaKind: 'image',
      createdAt: '2026-05-31T23:59:59.000Z',
    });
    await dao.create({
      idempotencyKey: 'storage:new',
      spaceId: 'space-1',
      userId,
      usageType: 'storage',
      quantity: 2048,
      unit: 'byte',
      mediaKind: 'video',
      createdAt: '2026-06-01T12:00:00.000Z',
    });
    await dao.create({
      idempotencyKey: 'storage:deleted',
      spaceId: 'space-1',
      userId,
      usageType: 'storage',
      quantity: -512,
      unit: 'byte',
      mediaKind: 'video',
      createdAt: '2026-06-02T12:00:00.000Z',
    });
    await dao.create({
      idempotencyKey: 'workflow:new',
      spaceId: 'space-1',
      userId,
      usageType: 'workflow',
      quantity: 1,
      unit: 'run',
      mediaKind: 'video',
      createdAt: '2026-06-02T12:00:00.000Z',
    });
    await dao.create({
      idempotencyKey: 'delivery:new',
      spaceId: 'space-1',
      userId,
      usageType: 'delivery',
      quantity: 256,
      unit: 'byte',
      mediaKind: 'video',
      createdAt: '2026-06-03T12:00:00.000Z',
    });

    const summary = await dao.getSpaceSummary('space-1', {
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-30T23:59:59.999Z',
    });

    assert.deepEqual(summary.totals, {
      storageBytes: 1536,
      workflowRuns: 1,
      deliveryBytes: 256,
    });
    assert.deepEqual(summary.byType, [
      { usageType: 'delivery', unit: 'byte', quantity: 256, events: 1 },
      { usageType: 'storage', unit: 'byte', quantity: 1536, events: 2 },
      { usageType: 'workflow', unit: 'run', quantity: 1, events: 1 },
    ]);
    assert.deepEqual(summary.byMediaKind, [
      {
        mediaKind: 'video',
        storageBytes: 1536,
        workflowRuns: 1,
        deliveryBytes: 256,
        events: 4,
      },
    ]);
  });

  test('summarizes account platform usage across spaces', async () => {
    await db.insertInto('spaces').values({
      id: 'space-2',
      name: 'Second Usage Space',
      owner_id: String(userId),
      created_at: Date.now(),
    }).execute();
    await dao.create({
      idempotencyKey: 'storage:account:space-1',
      spaceId: 'space-1',
      userId,
      usageType: 'storage',
      quantity: 2048,
      unit: 'byte',
      mediaKind: 'image',
      createdAt: '2026-06-01T12:00:00.000Z',
    });
    await dao.create({
      idempotencyKey: 'storage:account:space-1:delete',
      spaceId: 'space-1',
      userId,
      usageType: 'storage',
      quantity: -512,
      unit: 'byte',
      mediaKind: 'image',
      createdAt: '2026-06-02T12:00:00.000Z',
    });
    await dao.create({
      idempotencyKey: 'workflow:account:space-2',
      spaceId: 'space-2',
      userId,
      usageType: 'workflow',
      quantity: 2,
      unit: 'run',
      mediaKind: 'video',
      createdAt: '2026-06-03T12:00:00.000Z',
    });
    await dao.create({
      idempotencyKey: 'delivery:account:space-2',
      spaceId: 'space-2',
      userId,
      usageType: 'delivery',
      quantity: 256,
      unit: 'byte',
      mediaKind: 'video',
      createdAt: '2026-06-04T12:00:00.000Z',
    });

    const summary = await dao.getAccountSummary(userId, {
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    });

    assert.deepEqual(summary.totals, {
      storageBytes: 1536,
      workflowRuns: 2,
      deliveryBytes: 256,
    });
    assert.deepEqual(summary.byType, [
      { usageType: 'delivery', unit: 'byte', quantity: 256, events: 1 },
      { usageType: 'storage', unit: 'byte', quantity: 1536, events: 2 },
      { usageType: 'workflow', unit: 'run', quantity: 2, events: 1 },
    ]);
    assert.deepEqual(summary.bySpace, [
      {
        spaceId: 'space-1',
        storageBytes: 1536,
        workflowRuns: 0,
        deliveryBytes: 0,
        events: 2,
      },
      {
        spaceId: 'space-2',
        storageBytes: 0,
        workflowRuns: 2,
        deliveryBytes: 256,
        events: 2,
      },
    ]);
  });
});
