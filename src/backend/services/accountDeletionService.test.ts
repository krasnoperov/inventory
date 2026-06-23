import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import { AccountDeletionError, AccountDeletionService } from './accountDeletionService';
import type { Database } from '../../db/types';
import { createTestDatabase, cleanupTestDatabase } from '../../test-utils/database';
import type { Env } from '../../core/types';
import type { PolarService } from './polarService';

function createUser(id: number, email: string, polarCustomerId: string | null = null) {
  return {
    id,
    email,
    name: `User ${id}`,
    google_id: null,
    polar_customer_id: polarCustomerId,
    paid_generation_entitlement: 'none' as const,
    quota_limits: null,
    quota_limits_updated_at: null,
    polar_current_period_start: null,
    polar_current_period_end: null,
    polar_paid_access_expires_at: null,
    rate_limit_count: 0,
    rate_limit_window_start: null,
    created_at: '2026-06-23T00:00:00.000Z',
    updated_at: '2026-06-23T00:00:00.000Z',
  };
}

function fakeImages(puts: Array<{ key: string; body: string }>, initialObjects: Record<string, string> = {}): R2Bucket {
  const objects = new Map<string, string>(Object.entries(initialObjects));
  return {
    put: async (key: string, value: string) => {
      objects.set(key, value);
      puts.push({ key, body: value });
      return null;
    },
    get: async (key: string) => {
      const value = objects.get(key);
      if (!value) return null;
      return {
        json: async () => JSON.parse(value),
        text: async () => value,
      };
    },
    list: async (options?: R2ListOptions) => ({
      objects: Array.from(objects.keys())
        .filter((key) => !options?.prefix || key.startsWith(options.prefix))
        .map((key) => ({ key })),
      truncated: false,
      delimitedPrefixes: [],
    }),
  } as unknown as R2Bucket;
}

function fakeSpacesDo(calls: string[], response: Response = Response.json({ success: true, r2ObjectsDeleted: 2 })): DurableObjectNamespace {
  return {
    idFromName: (spaceId: string) => {
      calls.push(`id:${spaceId}`);
      return spaceId;
    },
    get: (id: string) => ({
      fetch: async (request: Request) => {
        calls.push(`${request.method}:${id}:${new URL(request.url).pathname}:${request.headers.get('X-Space-Id')}`);
        return response;
      },
    }),
  } as unknown as DurableObjectNamespace;
}

function fakePolar(calls: string[], deleted = true): PolarService {
  return {
    deleteCustomer: async (customerId: string) => {
      calls.push(customerId);
      return deleted;
    },
    hasCustomerDeletionConfigured: () => deleted,
  } as unknown as PolarService;
}

describe('AccountDeletionService', () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = await createTestDatabase();
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  test('hard-deletes the account, owned spaces, credentials, and preserves shared spaces', async () => {
    await db.insertInto('users').values([
      createUser(1, 'delete@example.com', 'polar-customer-1'),
      createUser(2, 'owner@example.com'),
      createUser(3, 'member@example.com'),
    ]).execute();
    await db.insertInto('spaces').values([
      { id: 'owned-space', name: 'Owned', owner_id: '1', created_at: 1, deleted_at: null },
      { id: 'shared-space', name: 'Shared', owner_id: '2', created_at: 2, deleted_at: null },
    ]).execute();
    await db.insertInto('space_members').values([
      { space_id: 'owned-space', user_id: '1', role: 'owner', joined_at: 1, deleted_at: null },
      { space_id: 'owned-space', user_id: '3', role: 'editor', joined_at: 2, deleted_at: null },
      { space_id: 'shared-space', user_id: '1', role: 'editor', joined_at: 3, deleted_at: null },
      { space_id: 'shared-space', user_id: '2', role: 'owner', joined_at: 4, deleted_at: null },
    ]).execute();
    await db.insertInto('usage_events').values({
      id: 'usage-1',
      user_id: 1,
      event_name: 'gemini_images',
      quantity: 1,
      metadata: null,
      polar_billable: 1,
      created_at: '2026-06-23T00:00:00.000Z',
      synced_at: null,
      sync_attempts: 0,
      last_sync_error: null,
      last_sync_attempt_at: null,
    }).execute();
    await db.insertInto('provider_usage_ledger').values({
      id: 'provider-1',
      attribution_key: 'attr-1',
      usage_event_id: 'usage-1',
      user_id: 1,
      space_id: 'owned-space',
      asset_id: null,
      variant_id: null,
      workflow_id: null,
      request_id: null,
      provider: 'gemini',
      provider_model: 'gemini-test',
      operation: null,
      media_kind: 'image',
      meter_event_name: 'gemini_images',
      usage_unit: 'image',
      quantity: 1,
      unit_price_usd: null,
      amount_micro_usd: null,
      currency: 'USD',
      pricing_source: null,
      provider_request_id: null,
      provider_response_id: null,
      provider_usage_id: null,
      metadata: null,
      created_at: '2026-06-23T00:00:00.000Z',
    }).execute();
    await db.insertInto('customer_charge_ledger').values({
      id: 'charge-1',
      charge_key: 'charge-key-1',
      usage_event_id: 'usage-1',
      provider_usage_ledger_id: 'provider-1',
      user_id: 1,
      meter_event_name: 'gemini_images',
      charge_unit: 'image',
      quantity: 1,
      polar_billable: 1,
      billing_provider: 'polar',
      billing_external_id: 'usage-1',
      customer_amount_micro_usd: null,
      currency: 'USD',
      metadata: null,
      created_at: '2026-06-23T00:00:00.000Z',
    }).execute();
    await db.insertInto('platform_usage_events').values([
      {
        id: 'platform-owned',
        idempotency_key: 'platform-owned',
        space_id: 'owned-space',
        user_id: 1,
        usage_type: 'storage',
        quantity: 10,
        unit: 'byte',
        asset_id: null,
        variant_id: null,
        workflow_id: null,
        request_id: null,
        artifact_key: null,
        operation: null,
        media_kind: null,
        metadata: null,
        created_at: '2026-06-23T00:00:00.000Z',
      },
      {
        id: 'platform-shared',
        idempotency_key: 'platform-shared',
        space_id: 'shared-space',
        user_id: 1,
        usage_type: 'workflow',
        quantity: 1,
        unit: 'run',
        asset_id: null,
        variant_id: null,
        workflow_id: null,
        request_id: null,
        artifact_key: null,
        operation: null,
        media_kind: null,
        metadata: null,
        created_at: '2026-06-23T00:00:00.000Z',
      },
    ]).execute();
    await db.insertInto('user_provider_keys').values({
      user_id: 1,
      provider: 'google_ai',
      encrypted_api_key: 'enc:v2:test',
      key_hint: '****test',
      created_at: '2026-06-23T00:00:00.000Z',
      updated_at: '2026-06-23T00:00:00.000Z',
    }).execute();
    await db.insertInto('key_envelopes').values({
      scope_id: 'user:1',
      wrapped_dek: 'wrapped',
      dek_version: 1,
      kek_version: 1,
      created_at: '2026-06-23T00:00:00.000Z',
      updated_at: '2026-06-23T00:00:00.000Z',
    }).execute();

    const r2Puts: Array<{ key: string; body: string }> = [];
    const doCalls: string[] = [];
    const polarCalls: string[] = [];
    const service = new AccountDeletionService(db, {
      ENVIRONMENT: 'production',
      IMAGES: fakeImages(r2Puts),
      SPACES_DO: fakeSpacesDo(doCalls),
    } as unknown as Env, fakePolar(polarCalls));

    const result = await service.deleteAccount(1);

    assert.equal(result.deleted, true);
    assert.equal(result.ownedSpacesPurged, 1);
    assert.equal(result.sharedMembershipsDeleted, 1);
    assert.equal(result.r2ObjectsDeleted, 2);
    assert.deepEqual(polarCalls, ['polar-customer-1']);
    assert.deepEqual(doCalls, [
      'id:owned-space',
      'DELETE:owned-space:/internal/purge:owned-space',
    ]);
    assert.equal((await db.selectFrom('users').selectAll().where('id', '=', 1).execute()).length, 0);
    assert.equal((await db.selectFrom('spaces').selectAll().where('id', '=', 'owned-space').execute()).length, 0);
    assert.equal((await db.selectFrom('spaces').selectAll().where('id', '=', 'shared-space').execute()).length, 1);
    assert.equal((await db.selectFrom('space_members').selectAll().where('space_id', '=', 'shared-space').where('user_id', '=', '1').execute()).length, 0);
    assert.equal((await db.selectFrom('space_members').selectAll().where('space_id', '=', 'shared-space').where('user_id', '=', '2').execute()).length, 1);
    assert.equal((await db.selectFrom('user_provider_keys').selectAll().where('user_id', '=', 1).execute()).length, 0);
    assert.equal((await db.selectFrom('key_envelopes').selectAll().where('scope_id', '=', 'user:1').execute()).length, 0);
    assert.equal((await db.selectFrom('usage_events').selectAll().where('user_id', '=', 1).execute()).length, 0);
    assert.equal((await db.selectFrom('provider_usage_ledger').selectAll().where('user_id', '=', 1).execute()).length, 0);
    assert.equal((await db.selectFrom('customer_charge_ledger').selectAll().where('user_id', '=', 1).execute()).length, 0);
    const sharedUsage = await db.selectFrom('platform_usage_events').selectAll().where('id', '=', 'platform-shared').executeTakeFirstOrThrow();
    assert.equal(sharedUsage.user_id, null);

    const tombstone = await db.selectFrom('account_deletion_tombstones').selectAll().where('user_id', '=', 1).executeTakeFirstOrThrow();
    assert.equal(tombstone.source, 'self_service');
    assert.equal(tombstone.owned_spaces_purged, 1);
    assert.match(tombstone.r2_key ?? '', /^account-deletion-tombstones\/user-1\/acctdel_1_/);
    assert.equal(r2Puts.length, 1);
    assert.equal(JSON.parse(r2Puts[0].body).user_id, 1);
    assert.equal(JSON.stringify(JSON.parse(r2Puts[0].body)).includes('delete@example.com'), false);
  });

  test('returns deleted false when the user is already gone', async () => {
    const service = new AccountDeletionService(db, {
      ENVIRONMENT: 'test',
      IMAGES: fakeImages([]),
    } as unknown as Env, fakePolar([]));

    const result = await service.deleteAccount(999);

    assert.equal(result.deleted, false);
    assert.equal(result.d1RowsChanged, 0);
  });

  test('refuses production deletion when a Polar customer exists but billing cleanup is unavailable', async () => {
    await db.insertInto('users').values(createUser(1, 'delete@example.com', 'polar-customer-1')).execute();
    const service = new AccountDeletionService(db, {
      ENVIRONMENT: 'production',
      IMAGES: fakeImages([]),
    } as unknown as Env, fakePolar([], false));

    await assert.rejects(
      () => service.deleteAccount(1),
      (error) => error instanceof AccountDeletionError && error.code === 'account_deletion_billing_not_configured'
    );
    assert.equal((await db.selectFrom('users').selectAll().where('id', '=', 1).execute()).length, 1);
    assert.equal((await db.selectFrom('account_deletion_tombstones').selectAll().execute()).length, 0);
  });

  test('records a durable tombstone before destructive downstream purges fail', async () => {
    await db.insertInto('users').values(createUser(1, 'delete@example.com', 'polar-customer-1')).execute();
    await db.insertInto('spaces').values({
      id: 'owned-space',
      name: 'Owned',
      owner_id: '1',
      created_at: 1,
      deleted_at: null,
    }).execute();

    const r2Puts: Array<{ key: string; body: string }> = [];
    const polarCalls: string[] = [];
    const service = new AccountDeletionService(db, {
      ENVIRONMENT: 'production',
      IMAGES: fakeImages(r2Puts),
      SPACES_DO: fakeSpacesDo([], new Response('purge failed', { status: 500 })),
    } as unknown as Env, fakePolar(polarCalls));

    await assert.rejects(
      () => service.deleteAccount(1),
      (error) => error instanceof AccountDeletionError && error.code === 'account_deletion_space_purge_failed'
    );

    assert.deepEqual(polarCalls, ['polar-customer-1']);
    assert.equal((await db.selectFrom('users').selectAll().where('id', '=', 1).execute()).length, 1);
    const tombstone = await db.selectFrom('account_deletion_tombstones')
      .selectAll()
      .where('user_id', '=', 1)
      .executeTakeFirstOrThrow();
    assert.equal(tombstone.source, 'self_service');
    assert.match(tombstone.r2_key ?? '', /^account-deletion-tombstones\/user-1\/acctdel_1_/);
    assert.equal(r2Puts.length, 1);
  });

  test('reapplies R2 deletion tombstones after a database restore', async () => {
    await db.insertInto('users').values(createUser(1, 'restore@example.com', 'polar-customer-1')).execute();
    await db.insertInto('spaces').values({
      id: 'restored-owned-space',
      name: 'Restored',
      owner_id: '1',
      created_at: 1,
      deleted_at: null,
    }).execute();
    await db.insertInto('space_members').values({
      space_id: 'restored-owned-space',
      user_id: '1',
      role: 'owner',
      joined_at: 1,
      deleted_at: null,
    }).execute();

    const tombstone = {
      schema: 'inventory.account_deletion_tombstone.v1',
      id: 'acctdel_1_restore',
      user_id: 1,
      source: 'self_service',
      owned_spaces_purged: 1,
      deleted_at: '2026-06-23T00:00:00.000Z',
      created_at: '2026-06-23T00:00:00.000Z',
    };
    const r2Puts: Array<{ key: string; body: string }> = [];
    const polarCalls: string[] = [];
    const service = new AccountDeletionService(db, {
      ENVIRONMENT: 'production',
      IMAGES: fakeImages(r2Puts, {
        'account-deletion-tombstones/user-1/acctdel_1_restore.json': JSON.stringify(tombstone),
      }),
      SPACES_DO: fakeSpacesDo([]),
    } as unknown as Env, fakePolar(polarCalls));

    const result = await service.reapplyDeletionTombstones();

    assert.deepEqual(result, {
      tombstonesSeen: 1,
      usersDeleted: 1,
      alreadyDeleted: 0,
      failures: [],
    });
    assert.deepEqual(polarCalls, ['polar-customer-1']);
    assert.equal((await db.selectFrom('users').selectAll().where('id', '=', 1).execute()).length, 0);
    assert.equal((await db.selectFrom('spaces').selectAll().where('id', '=', 'restored-owned-space').execute()).length, 0);
    const reapplied = await db.selectFrom('account_deletion_tombstones')
      .selectAll()
      .where('user_id', '=', 1)
      .where('source', '=', 'restore_reapply')
      .executeTakeFirstOrThrow();
    assert.equal(reapplied.owned_spaces_purged, 1);
  });
});
