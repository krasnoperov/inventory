import { test, beforeEach, afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types';
import { createTestDatabase, cleanupTestDatabase } from '../test-utils/database';
import { SpaceDAO } from './space-dao';
import { MemberDAO } from './member-dao';

describe('SpaceDAO soft delete', () => {
  let db: Kysely<Database>;
  let spaceDAO: SpaceDAO;
  let memberDAO: MemberDAO;

  beforeEach(async () => {
    db = await createTestDatabase();
    spaceDAO = new SpaceDAO(db);
    memberDAO = new MemberDAO(db);

    await db.insertInto('users').values([
      {
        id: 1,
        email: 'owner@example.com',
        name: 'Owner',
        google_id: null,
        polar_customer_id: null,
        paid_generation_entitlement: 'none',
        quota_limits: null,
        quota_limits_updated_at: null,
        polar_current_period_start: null,
        polar_current_period_end: null,
        polar_paid_access_expires_at: null,
        rate_limit_count: 0,
        rate_limit_window_start: null,
        created_at: '2026-06-22T00:00:00.000Z',
        updated_at: '2026-06-22T00:00:00.000Z',
      },
      {
        id: 2,
        email: 'editor@example.com',
        name: 'Editor',
        google_id: null,
        polar_customer_id: null,
        paid_generation_entitlement: 'none',
        quota_limits: null,
        quota_limits_updated_at: null,
        polar_current_period_start: null,
        polar_current_period_end: null,
        polar_paid_access_expires_at: null,
        rate_limit_count: 0,
        rate_limit_window_start: null,
        created_at: '2026-06-22T00:00:00.000Z',
        updated_at: '2026-06-22T00:00:00.000Z',
      },
    ]).execute();

    await spaceDAO.createSpace({
      id: 'space-1',
      name: 'Russafa',
      owner_id: '1',
      created_at: 1_787_000_000_000,
    });
    await memberDAO.addMember({ space_id: 'space-1', user_id: '1', role: 'owner', joined_at: 1 });
    await memberDAO.addMember({ space_id: 'space-1', user_id: '2', role: 'editor', joined_at: 2 });
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  test('deleteSpace hides a space from active reads but keeps the row', async () => {
    assert.equal(await spaceDAO.deleteSpace('space-1'), true);
    assert.equal(await spaceDAO.getSpaceById('space-1'), null);
    assert.equal(await memberDAO.getMember('space-1', '2'), null);
    assert.deepEqual(await spaceDAO.getSpacesForUser('2'), []);

    const deleted = await spaceDAO.getSpaceByIdIncludingDeleted('space-1');
    assert.equal(deleted?.id, 'space-1');
    assert.match(deleted?.deleted_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
  });

  test('purgeDeletedSpace only hard-deletes already soft-deleted spaces', async () => {
    assert.equal(await spaceDAO.purgeDeletedSpace('space-1'), false);
    assert.equal(await spaceDAO.deleteSpace('space-1'), true);
    assert.equal(await spaceDAO.purgeDeletedSpace('space-1'), true);
    assert.equal(await spaceDAO.getSpaceByIdIncludingDeleted('space-1'), null);
  });

  test('removeMember hides membership and addMember restores it', async () => {
    assert.equal(await memberDAO.removeMember('space-1', '2'), true);
    assert.equal(await memberDAO.getMember('space-1', '2'), null);
    assert.equal(await memberDAO.isSpaceMember('space-1', '2'), false);

    const restored = await memberDAO.addMember({ space_id: 'space-1', user_id: '2', role: 'viewer', joined_at: 3 });
    assert.equal(restored.role, 'viewer');
    assert.equal(restored.deleted_at, null);
    assert.equal(await memberDAO.getMemberRole('space-1', '2'), 'viewer');
  });
});
