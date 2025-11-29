import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/types';
import { createTestDatabase, cleanupTestDatabase } from '../../test-utils/database';
import { TestUserBuilder } from '../../test-utils/test-data-builders';
import { UsageEventDAO } from '../../dao/usage-event-dao';
import { UserDAO } from '../../dao/user-dao';
import { UsageService, USAGE_EVENTS } from './usageService';

describe('UsageService', () => {
  let db: Kysely<Database>;
  let usageEventDAO: UsageEventDAO;
  let userDAO: UserDAO;
  let usageService: UsageService;
  let testUserId: number;

  beforeEach(async () => {
    db = await createTestDatabase();
    usageEventDAO = new UsageEventDAO(db);
    userDAO = new UserDAO(db);
    // Create service without PolarService (null) for local-only testing
    usageService = new UsageService(usageEventDAO, userDAO, null, db);

    // Create a test user
    const user = await new TestUserBuilder()
      .withEmail('test@example.com')
      .withName('Test User')
      .create(db);
    testUserId = user.id;
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  describe('trackClaudeUsage', () => {
    test('creates input token event in local storage', async () => {
      await usageService.trackClaudeUsage(
        testUserId,
        1000,
        0,
        'claude-sonnet-4-20250514'
      );

      const events = await usageEventDAO.findByUser(testUserId);
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].event_name, USAGE_EVENTS.CLAUDE_INPUT_TOKENS);
      assert.strictEqual(events[0].quantity, 1000);
    });

    test('creates output token event in local storage', async () => {
      await usageService.trackClaudeUsage(
        testUserId,
        0,
        500,
        'claude-sonnet-4-20250514'
      );

      const events = await usageEventDAO.findByUser(testUserId);
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].event_name, USAGE_EVENTS.CLAUDE_OUTPUT_TOKENS);
      assert.strictEqual(events[0].quantity, 500);
    });

    test('creates both input and output token events', async () => {
      await usageService.trackClaudeUsage(
        testUserId,
        1000,
        500,
        'claude-sonnet-4-20250514',
        'req-123'
      );

      const events = await usageEventDAO.findByUser(testUserId);
      assert.strictEqual(events.length, 2);

      const inputEvent = events.find(e => e.event_name === USAGE_EVENTS.CLAUDE_INPUT_TOKENS);
      const outputEvent = events.find(e => e.event_name === USAGE_EVENTS.CLAUDE_OUTPUT_TOKENS);

      assert.ok(inputEvent);
      assert.ok(outputEvent);
      assert.strictEqual(inputEvent.quantity, 1000);
      assert.strictEqual(outputEvent.quantity, 500);
    });

    test('includes model and request_id in metadata', async () => {
      await usageService.trackClaudeUsage(
        testUserId,
        100,
        50,
        'claude-sonnet-4-20250514',
        'req-456'
      );

      const events = await usageEventDAO.findByUser(testUserId);
      const inputEvent = events.find(e => e.event_name === USAGE_EVENTS.CLAUDE_INPUT_TOKENS);
      assert.ok(inputEvent?.metadata);

      const metadata = JSON.parse(inputEvent.metadata);
      assert.strictEqual(metadata.model, 'claude-sonnet-4-20250514');
      assert.strictEqual(metadata.request_id, 'req-456');
      assert.strictEqual(metadata.token_type, 'input');
    });

    test('skips events when tokens are zero', async () => {
      await usageService.trackClaudeUsage(
        testUserId,
        0,
        0,
        'claude-sonnet-4-20250514'
      );

      const events = await usageEventDAO.findByUser(testUserId);
      assert.strictEqual(events.length, 0);
    });
  });

  describe('trackImageGeneration', () => {
    test('creates image count event in local storage', async () => {
      await usageService.trackImageGeneration(
        testUserId,
        1,
        'gemini-3-pro-image-preview',
        'generate',
        '1:1'
      );

      const events = await usageEventDAO.findByUser(testUserId);
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].event_name, USAGE_EVENTS.GEMINI_IMAGES);
      assert.strictEqual(events[0].quantity, 1);
    });

    test('includes operation and aspect_ratio in metadata', async () => {
      await usageService.trackImageGeneration(
        testUserId,
        1,
        'gemini-3-pro-image-preview',
        'compose',
        '16:9'
      );

      const events = await usageEventDAO.findByUser(testUserId);
      assert.ok(events[0].metadata);

      const metadata = JSON.parse(events[0].metadata);
      assert.strictEqual(metadata.model, 'gemini-3-pro-image-preview');
      assert.strictEqual(metadata.operation, 'compose');
      assert.strictEqual(metadata.aspect_ratio, '16:9');
    });

    test('tracks token usage when provided', async () => {
      await usageService.trackImageGeneration(
        testUserId,
        1,
        'gemini-3-pro-image-preview',
        'generate',
        '1:1',
        { inputTokens: 200, outputTokens: 100 }
      );

      const events = await usageEventDAO.findByUser(testUserId);
      assert.strictEqual(events.length, 3); // 1 image + 2 token events

      const imageEvent = events.find(e => e.event_name === USAGE_EVENTS.GEMINI_IMAGES);
      const inputEvent = events.find(e => e.event_name === USAGE_EVENTS.GEMINI_INPUT_TOKENS);
      const outputEvent = events.find(e => e.event_name === USAGE_EVENTS.GEMINI_OUTPUT_TOKENS);

      assert.ok(imageEvent);
      assert.ok(inputEvent);
      assert.ok(outputEvent);
      assert.strictEqual(inputEvent.quantity, 200);
      assert.strictEqual(outputEvent.quantity, 100);
    });
  });

  describe('syncPendingEvents', () => {
    test('returns { synced: 0, failed: 0 } when PolarService is null', async () => {
      // Create some events
      await usageService.trackClaudeUsage(testUserId, 100, 50, 'claude-sonnet-4-20250514');

      const result = await usageService.syncPendingEvents();
      assert.strictEqual(result.synced, 0);
      assert.strictEqual(result.failed, 0);
    });
  });

  describe('getUserUsageStats', () => {
    test('returns usage stats from local storage', async () => {
      // Track some usage
      await usageService.trackClaudeUsage(testUserId, 1000, 500, 'claude-sonnet-4-20250514');
      await usageService.trackImageGeneration(testUserId, 2, 'gemini-3-pro-image-preview');

      const stats = await usageService.getUserUsageStats(testUserId);

      assert.ok(stats.period.start instanceof Date);
      assert.ok(stats.period.end instanceof Date);
      assert.strictEqual(stats.usage[USAGE_EVENTS.CLAUDE_INPUT_TOKENS]?.used, 1000);
      assert.strictEqual(stats.usage[USAGE_EVENTS.CLAUDE_OUTPUT_TOKENS]?.used, 500);
      assert.strictEqual(stats.usage[USAGE_EVENTS.GEMINI_IMAGES]?.used, 2);
    });

    test('returns empty usage when no events exist', async () => {
      const stats = await usageService.getUserUsageStats(testUserId);

      assert.ok(stats.period.start instanceof Date);
      assert.ok(stats.period.end instanceof Date);
      assert.deepStrictEqual(stats.usage, {});
    });
  });

  describe('checkQuota', () => {
    test('returns allowed=true when PolarService is null', async () => {
      const result = await usageService.checkQuota(testUserId, 'claude');

      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.remaining, null);
      assert.strictEqual(result.limit, null);
    });

    test('returns allowed=true for nanobanana when PolarService is null', async () => {
      const result = await usageService.checkQuota(testUserId, 'nanobanana');

      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.remaining, null);
      assert.strictEqual(result.limit, null);
    });
  });

  describe('getCustomerPortalUrl', () => {
    test('returns null when PolarService is null', async () => {
      const result = await usageService.getCustomerPortalUrl(testUserId);
      assert.strictEqual(result, null);
    });
  });

  describe('cleanupOldEvents', () => {
    test('removes old synced events', async () => {
      // Create and sync an old event by manually inserting
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100); // 100 days ago

      await db.insertInto('usage_events').values({
        id: 'old-event-1',
        user_id: testUserId,
        event_name: USAGE_EVENTS.CLAUDE_INPUT_TOKENS,
        quantity: 100,
        metadata: null,
        created_at: oldDate.toISOString(),
        synced_at: oldDate.toISOString(), // Mark as synced
        sync_attempts: 1,
        last_sync_error: null,
        last_sync_attempt_at: oldDate.toISOString(),
      }).execute();

      // Create a recent event
      await usageService.trackClaudeUsage(testUserId, 200, 0, 'claude-sonnet-4-20250514');

      const deleted = await usageService.cleanupOldEvents(90);
      assert.strictEqual(deleted, 1);

      // Verify recent event still exists
      const remaining = await usageEventDAO.findByUser(testUserId);
      assert.strictEqual(remaining.length, 1);
      assert.strictEqual(remaining[0].quantity, 200);
    });
  });
});
