import { injectable, inject } from 'inversify';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/types';
import { TYPES } from '../../core/di-types';
import type { Env } from '../../core/types';
import { PolarService } from './polarService';

const TOMBSTONE_PREFIX = 'account-deletion-tombstones/';
const BATCH_SIZE = 50;

export interface AccountDeletionResult {
  deleted: boolean;
  ownedSpacesPurged: number;
  spacePurgeFailures: number;
  sharedMembershipsDeleted: number;
  r2ObjectsDeleted: number;
  d1RowsChanged: number;
}

export interface AccountDeletionReapplyResult {
  tombstonesSeen: number;
  usersDeleted: number;
  alreadyDeleted: number;
  failures: Array<{
    tombstoneId: string;
    userId: number;
    error: string;
  }>;
}

interface AccountDeletionTombstonePayload {
  schema: 'inventory.account_deletion_tombstone.v1';
  id: string;
  user_id: number;
  source: 'self_service' | 'restore_reapply';
  owned_spaces_purged: number;
  owned_space_ids: string[];
  deleted_at: string;
  created_at: string;
}

export class AccountDeletionError extends Error {
  constructor(
    message: string,
    readonly status = 500,
    readonly code = 'account_deletion_failed',
  ) {
    super(message);
    this.name = 'AccountDeletionError';
  }
}

function chunks<T>(items: T[]): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += BATCH_SIZE) {
    batches.push(items.slice(index, index + BATCH_SIZE));
  }
  return batches;
}

function changed(result: { numDeletedRows?: bigint; numUpdatedRows?: bigint; numInsertedOrUpdatedRows?: bigint }): number {
  return Number(result.numDeletedRows ?? result.numUpdatedRows ?? result.numInsertedOrUpdatedRows ?? 0n);
}

function tombstoneId(userId: number): string {
  return `acctdel_${userId}_${crypto.randomUUID()}`;
}

function tombstoneR2Key(tombstone: AccountDeletionTombstonePayload): string {
  return `${TOMBSTONE_PREFIX}user-${tombstone.user_id}/${tombstone.id}.json`;
}

function isTombstonePayload(value: unknown): value is AccountDeletionTombstonePayload {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.schema === 'inventory.account_deletion_tombstone.v1'
    && typeof record.id === 'string'
    && typeof record.user_id === 'number'
    && (record.source === 'self_service' || record.source === 'restore_reapply')
    && typeof record.owned_spaces_purged === 'number'
    && Array.isArray(record.owned_space_ids)
    && record.owned_space_ids.every((item) => typeof item === 'string')
    && typeof record.deleted_at === 'string'
    && typeof record.created_at === 'string';
}

@injectable()
export class AccountDeletionService {
  constructor(
    @inject(TYPES.Database) private db: Kysely<Database>,
    @inject(TYPES.Env) private env: Env,
    @inject(PolarService) private polarService: PolarService,
  ) {}

  async deleteAccount(userId: number, options: { source?: 'self_service' | 'restore_reapply' } = {}): Promise<AccountDeletionResult> {
    const user = await this.db
      .selectFrom('users')
      .select(['id', 'email', 'polar_customer_id'])
      .where('id', '=', userId)
      .executeTakeFirst();

    if (!user) {
      return {
        deleted: false,
        ownedSpacesPurged: 0,
        spacePurgeFailures: 0,
        sharedMembershipsDeleted: 0,
        r2ObjectsDeleted: 0,
        d1RowsChanged: 0,
      };
    }

    const ownedSpaceIds = (await this.db
      .selectFrom('spaces')
      .select('id')
      .where('owner_id', '=', String(userId))
      .execute()).map((row) => row.id);

    if (ownedSpaceIds.length > 0 && !this.env.SPACES_DO) {
      throw new AccountDeletionError('Account deletion cannot purge owned spaces because SpaceDO is not configured', 503, 'account_deletion_space_purge_not_configured');
    }

    const source = options.source ?? 'self_service';
    this.ensureBillingCustomerDeletionConfigured(user.polar_customer_id);

    const now = new Date().toISOString();
    const tombstone: AccountDeletionTombstonePayload = {
      schema: 'inventory.account_deletion_tombstone.v1',
      id: tombstoneId(userId),
      user_id: userId,
      source,
      owned_spaces_purged: ownedSpaceIds.length,
      owned_space_ids: ownedSpaceIds,
      deleted_at: now,
      created_at: now,
    };
    let d1RowsChanged = 0;
    d1RowsChanged += changed(await this.db.insertInto('account_deletion_tombstones').values({
      id: tombstone.id,
      user_id: tombstone.user_id,
      source: tombstone.source,
      owned_spaces_purged: tombstone.owned_spaces_purged,
      owned_space_ids: JSON.stringify(tombstone.owned_space_ids),
      r2_key: null,
      deleted_at: tombstone.deleted_at,
      created_at: tombstone.created_at,
    }).executeTakeFirst());

    const r2Key = await this.writeTombstone(tombstone);
    d1RowsChanged += changed(await this.db
      .updateTable('account_deletion_tombstones')
      .set({ r2_key: r2Key })
      .where('id', '=', tombstone.id)
      .executeTakeFirst());

    try {
      await this.deleteBillingCustomer(user.polar_customer_id);
    } catch (error) {
      await this.discardTombstone(tombstone.id, r2Key);
      throw error;
    }

    d1RowsChanged += await this.archiveOwnedSpaces(ownedSpaceIds, now);
    const purgeResult = await this.purgeSpaceDos(ownedSpaceIds);

    for (const batch of chunks(ownedSpaceIds)) {
      d1RowsChanged += changed(await this.db.deleteFrom('space_members').where('space_id', 'in', batch).executeTakeFirst());
      d1RowsChanged += changed(await this.db.deleteFrom('platform_usage_events').where('space_id', 'in', batch).executeTakeFirst());
      d1RowsChanged += changed(await this.db.deleteFrom('spaces').where('id', 'in', batch).executeTakeFirst());
    }

    const sharedMembershipsDeleted = changed(await this.db
      .deleteFrom('space_members')
      .where('user_id', '=', String(userId))
      .executeTakeFirst());
    d1RowsChanged += sharedMembershipsDeleted;

    d1RowsChanged += changed(await this.db
      .updateTable('platform_usage_events')
      .set({ user_id: null })
      .where('user_id', '=', userId)
      .executeTakeFirst());

    d1RowsChanged += changed(await this.db.deleteFrom('customer_charge_ledger').where('user_id', '=', userId).executeTakeFirst());
    d1RowsChanged += changed(await this.db.deleteFrom('provider_usage_ledger').where('user_id', '=', userId).executeTakeFirst());
    d1RowsChanged += changed(await this.db.deleteFrom('usage_events').where('user_id', '=', userId).executeTakeFirst());
    d1RowsChanged += changed(await this.db.deleteFrom('user_provider_keys').where('user_id', '=', userId).executeTakeFirst());
    d1RowsChanged += changed(await this.db.deleteFrom('key_envelopes').where('scope_id', '=', `user:${userId}`).executeTakeFirst());
    d1RowsChanged += changed(await this.db.deleteFrom('user_preferences').where('user_id', '=', userId).executeTakeFirst());
    d1RowsChanged += changed(await this.db.deleteFrom('user_feedback').where('user_id', '=', userId).executeTakeFirst());
    d1RowsChanged += changed(await this.db.deleteFrom('user_patterns').where('user_id', '=', userId).executeTakeFirst());
    d1RowsChanged += changed(await this.db.deleteFrom('users').where('id', '=', userId).executeTakeFirst());

    return {
      deleted: true,
      ownedSpacesPurged: ownedSpaceIds.length,
      spacePurgeFailures: purgeResult.failures,
      sharedMembershipsDeleted,
      r2ObjectsDeleted: purgeResult.r2ObjectsDeleted,
      d1RowsChanged,
    };
  }

  async reapplyDeletionTombstones(): Promise<AccountDeletionReapplyResult> {
    const tombstones = await this.loadDeletionTombstones();
    let usersDeleted = 0;
    let alreadyDeleted = 0;
    const failures: AccountDeletionReapplyResult['failures'] = [];

    for (const tombstone of tombstones.values()) {
      try {
        const result = await this.deleteAccount(tombstone.user_id, { source: 'restore_reapply' });
        if (result.deleted) {
          usersDeleted += 1;
        } else {
          await this.purgeSpaceDos(tombstone.owned_space_ids);
          alreadyDeleted += 1;
        }
      } catch (error) {
        failures.push({
          tombstoneId: tombstone.id,
          userId: tombstone.user_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      tombstonesSeen: tombstones.size,
      usersDeleted,
      alreadyDeleted,
      failures,
    };
  }

  private ensureBillingCustomerDeletionConfigured(polarCustomerId: string | null): void {
    if (!polarCustomerId) return;
    if (!this.polarService.hasCustomerDeletionConfigured() && this.requiresConfiguredBillingDeletion()) {
      throw new AccountDeletionError('Account deletion cannot run because billing cancellation is not configured', 503, 'account_deletion_billing_not_configured');
    }
  }

  private async deleteBillingCustomer(polarCustomerId: string | null): Promise<void> {
    if (!polarCustomerId) return;
    const deleted = await this.polarService.deleteCustomer(polarCustomerId);
    if (!deleted && this.requiresConfiguredBillingDeletion()) {
      throw new AccountDeletionError('Account deletion cannot run because billing cancellation is not configured', 503, 'account_deletion_billing_not_configured');
    }
  }

  private requiresConfiguredBillingDeletion(): boolean {
    return this.env.ENVIRONMENT === 'stage' || this.env.ENVIRONMENT === 'staging' || this.env.ENVIRONMENT === 'production';
  }

  private async archiveOwnedSpaces(spaceIds: string[], deletedAt: string): Promise<number> {
    let d1RowsChanged = 0;
    for (const batch of chunks(spaceIds)) {
      d1RowsChanged += changed(await this.db
        .updateTable('spaces')
        .set({ deleted_at: deletedAt })
        .where('id', 'in', batch)
        .executeTakeFirst());
      d1RowsChanged += changed(await this.db
        .updateTable('space_members')
        .set({ deleted_at: deletedAt })
        .where('space_id', 'in', batch)
        .executeTakeFirst());
    }
    return d1RowsChanged;
  }

  private async writeTombstone(tombstone: AccountDeletionTombstonePayload): Promise<string> {
    const key = tombstoneR2Key(tombstone);
    await this.env.IMAGES.put(key, JSON.stringify(tombstone), {
      httpMetadata: { contentType: 'application/json' },
    });
    return key;
  }

  private async discardTombstone(tombstoneId: string, r2Key: string): Promise<void> {
    await Promise.allSettled([
      this.env.IMAGES.delete(r2Key),
      this.db.deleteFrom('account_deletion_tombstones')
        .where('id', '=', tombstoneId)
        .executeTakeFirst(),
    ]);
  }

  private async loadDeletionTombstones(): Promise<Map<string, AccountDeletionTombstonePayload>> {
    const tombstones = new Map<string, AccountDeletionTombstonePayload>();
    const rows = await this.db
      .selectFrom('account_deletion_tombstones')
      .select(['id', 'user_id', 'source', 'owned_spaces_purged', 'owned_space_ids', 'deleted_at', 'created_at'])
      .where('r2_key', 'is not', null)
      .execute();

    for (const row of rows) {
      const ownedSpaceIds = JSON.parse(row.owned_space_ids) as unknown;
      tombstones.set(row.id, {
        schema: 'inventory.account_deletion_tombstone.v1',
        id: row.id,
        user_id: row.user_id,
        source: row.source,
        owned_spaces_purged: row.owned_spaces_purged,
        owned_space_ids: Array.isArray(ownedSpaceIds) ? ownedSpaceIds.filter((item): item is string => typeof item === 'string') : [],
        deleted_at: row.deleted_at,
        created_at: row.created_at,
      });
    }

    for (const tombstone of await this.loadR2DeletionTombstones()) {
      tombstones.set(tombstone.id, tombstone);
    }

    return tombstones;
  }

  private async purgeSpaceDos(spaceIds: string[]): Promise<{ r2ObjectsDeleted: number; failures: number }> {
    let r2ObjectsDeleted = 0;
    let failures = 0;
    for (const spaceId of spaceIds) {
      try {
        r2ObjectsDeleted += await this.purgeSpaceDo(spaceId);
      } catch {
        failures += 1;
      }
    }
    return { r2ObjectsDeleted, failures };
  }

  private async loadR2DeletionTombstones(): Promise<AccountDeletionTombstonePayload[]> {
    const tombstones: AccountDeletionTombstonePayload[] = [];
    let cursor: string | undefined;

    do {
      const page = await this.env.IMAGES.list({ prefix: TOMBSTONE_PREFIX, cursor });
      for (const object of page.objects) {
        const body = await this.env.IMAGES.get(object.key);
        if (!body) continue;
        const value = await body.json().catch(() => null);
        if (isTombstonePayload(value)) {
          tombstones.push(value);
        }
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);

    return tombstones;
  }

  private async purgeSpaceDo(spaceId: string): Promise<number> {
    if (!this.env.SPACES_DO) {
      throw new AccountDeletionError('SpaceDO is not configured', 503, 'account_deletion_space_purge_not_configured');
    }
    const id = this.env.SPACES_DO.idFromName(spaceId);
    const response = await this.env.SPACES_DO.get(id).fetch(new Request('http://do/internal/purge', {
      method: 'DELETE',
      headers: { 'X-Space-Id': spaceId },
    }));
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new AccountDeletionError(`Space purge failed for ${spaceId}${body ? `: ${body}` : ''}`, 502, 'account_deletion_space_purge_failed');
    }
    const json = await response.json() as { r2ObjectsDeleted?: number };
    return json.r2ObjectsDeleted ?? 0;
  }
}
