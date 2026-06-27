import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types';
import { createTestDatabase, cleanupTestDatabase } from '../test-utils/database';
import { TestUserBuilder } from '../test-utils/test-data-builders';
import { MemberDAO } from './member-dao';
import { SpaceDAO } from './space-dao';
import {
  SpaceSharingDAO,
  SpaceSharingError,
  normalizeInvitationEmail,
} from './space-sharing-dao';

describe('SpaceSharingDAO', () => {
  let db: Kysely<Database>;
  let sharingDAO: SpaceSharingDAO;
  let memberDAO: MemberDAO;
  let spaceDAO: SpaceDAO;
  let ownerId: string;
  let requesterId: string;
  let inviteeId: string;

  beforeEach(async () => {
    db = await createTestDatabase();
    sharingDAO = new SpaceSharingDAO(db);
    memberDAO = new MemberDAO(db);
    spaceDAO = new SpaceDAO(db);

    const owner = await new TestUserBuilder()
      .withEmail('owner@example.com')
      .withName('Owner')
      .create(db);
    const requester = await new TestUserBuilder()
      .withEmail('requester@example.com')
      .withName('Requester')
      .create(db);
    const invitee = await new TestUserBuilder()
      .withEmail('Invitee@Example.com')
      .withName('Invitee')
      .create(db);

    ownerId = String(owner.id);
    requesterId = String(requester.id);
    inviteeId = String(invitee.id);

    await spaceDAO.createSpace({
      id: 'space-1',
      name: 'Sharing Space',
      owner_id: ownerId,
      created_at: 1_787_000_000_000,
    });
    await memberDAO.addMember({
      space_id: 'space-1',
      user_id: ownerId,
      role: 'owner',
      joined_at: 1,
    });
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  test('creates and approves access requests without granting access while pending', async () => {
    const request = await sharingDAO.createAccessRequest({
      spaceId: 'space-1',
      requesterUserId: requesterId,
      requestedRole: 'editor',
      message: 'Please add me',
      now: '2026-06-27T10:00:00.000Z',
    });

    assert.equal(request.status, 'pending');
    assert.equal(request.requested_role, 'editor');
    assert.equal(await memberDAO.getMember('space-1', requesterId), null);

    const duplicate = await sharingDAO.createAccessRequest({
      spaceId: 'space-1',
      requesterUserId: requesterId,
      requestedRole: 'viewer',
      message: 'Repeated request',
    });
    assert.equal(duplicate.id, request.id);
    assert.equal(duplicate.requested_role, 'editor');

    const pending = await sharingDAO.listAccessRequests('space-1', 'pending');
    assert.equal(pending.length, 1);
    assert.equal(pending[0].requester.email, 'requester@example.com');

    const approved = await sharingDAO.resolveAccessRequest(
      request.id,
      ownerId,
      'approved'
    );
    assert.equal(approved?.status, 'approved');
    assert.equal(approved?.resolved_by_user_id, ownerId);

    const member = await memberDAO.getMember('space-1', requesterId);
    assert.equal(member?.role, 'editor');
    assert.equal(await sharingDAO.resolveAccessRequest(request.id, ownerId, 'approved'), null);
  });

  test('returns the pending access request when a duplicate create wins the insert race', async () => {
    const originalGetPending = (sharingDAO as unknown as {
      getPendingAccessRequestForUser: (spaceId: string, userId: string) => Promise<unknown>;
    }).getPendingAccessRequestForUser.bind(sharingDAO);
    let insertedRaceWinner = false;
    (sharingDAO as unknown as {
      getPendingAccessRequestForUser: (spaceId: string, userId: string) => Promise<unknown>;
    }).getPendingAccessRequestForUser = async (spaceId, userId) => {
      const existing = await originalGetPending(spaceId, userId);
      if (!existing && !insertedRaceWinner) {
        insertedRaceWinner = true;
        await db.insertInto('space_access_requests').values({
          id: 'request-race-winner',
          space_id: spaceId,
          requester_user_id: userId,
          requested_role: 'viewer',
          status: 'pending',
          message: 'first submit',
          created_at: '2026-06-27T10:00:00.000Z',
          updated_at: '2026-06-27T10:00:00.000Z',
          resolved_at: null,
          resolved_by_user_id: null,
        }).execute();
      }
      return existing;
    };

    const request = await sharingDAO.createAccessRequest({
      spaceId: 'space-1',
      requesterUserId: requesterId,
      requestedRole: 'editor',
      message: 'retry submit',
    });

    assert.equal(request.id, 'request-race-winner');
    assert.equal(request.requested_role, 'viewer');
    assert.equal((await sharingDAO.listAccessRequests('space-1', 'pending')).length, 1);
  });

  test('does not grant access when an access request is canceled before approval is committed', async () => {
    const request = await sharingDAO.createAccessRequest({
      spaceId: 'space-1',
      requesterUserId: requesterId,
      requestedRole: 'editor',
    });
    const originalAssertNoActiveMembership = (sharingDAO as unknown as {
      assertNoActiveMembership: (spaceId: string, userId: string) => Promise<void>;
    }).assertNoActiveMembership.bind(sharingDAO);
    (sharingDAO as unknown as {
      assertNoActiveMembership: (spaceId: string, userId: string) => Promise<void>;
    }).assertNoActiveMembership = async (spaceId, userId) => {
      await originalAssertNoActiveMembership(spaceId, userId);
      await sharingDAO.cancelAccessRequest(request.id, requesterId);
    };

    const approved = await sharingDAO.resolveAccessRequest(request.id, ownerId, 'approved');

    assert.equal(approved, null);
    assert.equal(await memberDAO.getMember('space-1', requesterId), null);
    const rows = await db
      .selectFrom('space_access_requests')
      .select(['id', 'status'])
      .where('id', '=', request.id)
      .execute();
    assert.deepEqual(rows, [{ id: request.id, status: 'canceled' }]);
  });

  test('updates, rejects, and cancels access requests without changing membership', async () => {
    const request = await sharingDAO.createAccessRequest({
      spaceId: 'space-1',
      requesterUserId: requesterId,
      requestedRole: 'viewer',
    });

    const updated = await sharingDAO.updateAccessRequestRole(request.id, 'editor');
    assert.equal(updated?.requested_role, 'editor');

    const rejected = await sharingDAO.resolveAccessRequest(
      request.id,
      ownerId,
      'rejected'
    );
    assert.equal(rejected?.status, 'rejected');
    assert.equal(await memberDAO.getMember('space-1', requesterId), null);

    const second = await sharingDAO.createAccessRequest({
      spaceId: 'space-1',
      requesterUserId: requesterId,
      requestedRole: 'viewer',
    });
    assert.notEqual(second.id, request.id);

    const canceled = await sharingDAO.cancelAccessRequest(second.id, requesterId);
    assert.equal(canceled?.status, 'canceled');
    assert.equal(await memberDAO.getMember('space-1', requesterId), null);
  });

  test('rejects access requests from active members but allows soft-deleted members to request again', async () => {
    await assert.rejects(
      () => sharingDAO.createAccessRequest({
        spaceId: 'space-1',
        requesterUserId: ownerId,
        requestedRole: 'viewer',
      }),
      isSharingError('active_member')
    );

    await memberDAO.addMember({
      space_id: 'space-1',
      user_id: requesterId,
      role: 'viewer',
      joined_at: 2,
    });
    await memberDAO.removeMember('space-1', requesterId);

    const request = await sharingDAO.createAccessRequest({
      spaceId: 'space-1',
      requesterUserId: requesterId,
      requestedRole: 'editor',
    });
    await sharingDAO.resolveAccessRequest(request.id, ownerId, 'approved');

    const restored = await memberDAO.getMember('space-1', requesterId);
    assert.equal(restored?.role, 'editor');
    assert.equal(restored?.deleted_at, null);
  });

  test('creates, updates, and accepts case-normalized invitations', async () => {
    assert.equal(normalizeInvitationEmail(' Invitee@Example.COM '), 'invitee@example.com');

    const invitation = await sharingDAO.createInvitation({
      spaceId: 'space-1',
      email: ' Invitee@Example.COM ',
      role: 'editor',
      invitedByUserId: ownerId,
      now: '2026-06-27T10:00:00.000Z',
    });

    assert.equal(invitation.email, 'invitee@example.com');
    assert.equal(invitation.normalized_email, 'invitee@example.com');
    assert.equal(await memberDAO.getMember('space-1', inviteeId), null);

    const duplicate = await sharingDAO.createInvitation({
      spaceId: 'space-1',
      email: 'invitee@example.com',
      role: 'viewer',
      invitedByUserId: ownerId,
    });
    assert.equal(duplicate.id, invitation.id);
    assert.equal(duplicate.role, 'editor');

    const updated = await sharingDAO.updateInvitationRole(invitation.id, 'viewer');
    assert.equal(updated?.role, 'viewer');

    const accepted = await sharingDAO.acceptInvitation(invitation.id, inviteeId);
    assert.equal(accepted?.status, 'accepted');
    assert.equal(accepted?.accepted_by_user_id, inviteeId);

    const member = await memberDAO.getMember('space-1', inviteeId);
    assert.equal(member?.role, 'viewer');

    const acceptedInvitations = await sharingDAO.listInvitations('space-1', 'accepted');
    assert.equal(acceptedInvitations.length, 1);
    assert.equal(acceptedInvitations[0].invitedBy?.id, ownerId);
    assert.equal(acceptedInvitations[0].acceptedBy?.id, inviteeId);
  });

  test('returns the pending invitation when a duplicate create wins the insert race', async () => {
    const originalGetPending = (sharingDAO as unknown as {
      getPendingInvitationForEmail: (spaceId: string, email: string) => Promise<unknown>;
    }).getPendingInvitationForEmail.bind(sharingDAO);
    let insertedRaceWinner = false;
    (sharingDAO as unknown as {
      getPendingInvitationForEmail: (spaceId: string, email: string) => Promise<unknown>;
    }).getPendingInvitationForEmail = async (spaceId, email) => {
      const existing = await originalGetPending(spaceId, email);
      if (!existing && !insertedRaceWinner) {
        insertedRaceWinner = true;
        await db.insertInto('space_invitations').values({
          id: 'invite-race-winner',
          space_id: spaceId,
          email,
          normalized_email: email,
          role: 'viewer',
          status: 'pending',
          invited_by_user_id: ownerId,
          accepted_by_user_id: null,
          created_at: '2026-06-27T10:00:00.000Z',
          updated_at: '2026-06-27T10:00:00.000Z',
          expires_at: null,
          resolved_at: null,
        }).execute();
      }
      return existing;
    };

    const invitation = await sharingDAO.createInvitation({
      spaceId: 'space-1',
      email: 'Invitee@Example.COM',
      role: 'editor',
      invitedByUserId: ownerId,
    });

    assert.equal(invitation.id, 'invite-race-winner');
    assert.equal(invitation.role, 'viewer');
    assert.equal((await sharingDAO.listInvitations('space-1', 'pending')).length, 1);
  });

  test('does not grant access when an invitation is revoked before acceptance is committed', async () => {
    const invitation = await sharingDAO.createInvitation({
      spaceId: 'space-1',
      email: 'invitee@example.com',
      role: 'viewer',
      invitedByUserId: ownerId,
    });
    const originalAssertNoActiveMembership = (sharingDAO as unknown as {
      assertNoActiveMembership: (spaceId: string, userId: string) => Promise<void>;
    }).assertNoActiveMembership.bind(sharingDAO);
    (sharingDAO as unknown as {
      assertNoActiveMembership: (spaceId: string, userId: string) => Promise<void>;
    }).assertNoActiveMembership = async (spaceId, userId) => {
      await originalAssertNoActiveMembership(spaceId, userId);
      await sharingDAO.revokeInvitation(invitation.id);
    };

    const accepted = await sharingDAO.acceptInvitation(invitation.id, inviteeId);

    assert.equal(accepted, null);
    assert.equal(await memberDAO.getMember('space-1', inviteeId), null);
    const rows = await db
      .selectFrom('space_invitations')
      .select(['id', 'status'])
      .where('id', '=', invitation.id)
      .execute();
    assert.deepEqual(rows, [{ id: invitation.id, status: 'revoked' }]);
  });

  test('revokes invitations and allows a new pending invite for the same email', async () => {
    const invitation = await sharingDAO.createInvitation({
      spaceId: 'space-1',
      email: 'external@example.com',
      role: 'viewer',
      invitedByUserId: ownerId,
    });

    const revoked = await sharingDAO.revokeInvitation(invitation.id);
    assert.equal(revoked?.status, 'revoked');
    assert.equal(await sharingDAO.revokeInvitation(invitation.id), null);

    const replacement = await sharingDAO.createInvitation({
      spaceId: 'space-1',
      email: 'EXTERNAL@example.com',
      role: 'editor',
      invitedByUserId: ownerId,
    });

    assert.notEqual(replacement.id, invitation.id);
    assert.equal(replacement.normalized_email, 'external@example.com');
  });

  test('rejects invitations for active members and acceptance by the wrong email', async () => {
    await assert.rejects(
      () => sharingDAO.createInvitation({
        spaceId: 'space-1',
        email: 'owner@example.com',
        role: 'viewer',
        invitedByUserId: ownerId,
      }),
      isSharingError('active_member')
    );

    const invitation = await sharingDAO.createInvitation({
      spaceId: 'space-1',
      email: 'external@example.com',
      role: 'viewer',
      invitedByUserId: ownerId,
    });

    await assert.rejects(
      () => sharingDAO.acceptInvitation(invitation.id, inviteeId),
      isSharingError('email_user_mismatch')
    );
    assert.equal(await memberDAO.getMember('space-1', inviteeId), null);
  });

  test('expires invitations instead of granting access after expiry', async () => {
    const invitation = await sharingDAO.createInvitation({
      spaceId: 'space-1',
      email: 'invitee@example.com',
      role: 'viewer',
      invitedByUserId: ownerId,
      expiresAt: '2026-06-27T10:00:00.000Z',
    });

    await assert.rejects(
      () => sharingDAO.acceptInvitation(
        invitation.id,
        inviteeId,
        '2026-06-27T10:00:00.000Z'
      ),
      isSharingError('invitation_expired')
    );

    const expired = await sharingDAO.listInvitations('space-1', 'expired');
    assert.equal(expired.length, 1);
    assert.equal(expired[0].id, invitation.id);
    assert.equal(await memberDAO.getMember('space-1', inviteeId), null);
  });

  test('sharing state hides deleted spaces and deleted memberships', async () => {
    await memberDAO.addMember({
      space_id: 'space-1',
      user_id: inviteeId,
      role: 'viewer',
      joined_at: 2,
    });
    await memberDAO.removeMember('space-1', inviteeId);
    await sharingDAO.createAccessRequest({
      spaceId: 'space-1',
      requesterUserId: requesterId,
      requestedRole: 'viewer',
    });
    await sharingDAO.createInvitation({
      spaceId: 'space-1',
      email: 'external@example.com',
      role: 'viewer',
      invitedByUserId: ownerId,
    });

    const state = await sharingDAO.getSharingState('space-1');
    assert.deepEqual(state?.members.map((member) => member.user_id), [ownerId]);
    assert.equal(state?.pendingAccessRequests.length, 1);
    assert.equal(state?.pendingInvitations.length, 1);

    await spaceDAO.deleteSpace('space-1');

    assert.equal(await sharingDAO.getSharingState('space-1'), null);
    assert.deepEqual(await sharingDAO.listAccessRequests('space-1', 'pending'), []);
    assert.deepEqual(await sharingDAO.listInvitations('space-1', 'pending'), []);
    await assert.rejects(
      () => sharingDAO.createInvitation({
        spaceId: 'space-1',
        email: 'new@example.com',
        role: 'viewer',
        invitedByUserId: ownerId,
      }),
      isSharingError('space_not_found')
    );
  });
});

function isSharingError(code: SpaceSharingError['code']) {
  return (error: unknown) => {
    assert(error instanceof SpaceSharingError);
    assert.equal(error.code, code);
    return true;
  };
}
