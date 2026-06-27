import { injectable, inject } from 'inversify';
import { sql, type Kysely } from 'kysely';
import type {
  Database,
  SpaceAccessRequest,
  SpaceAccessRequestStatus,
  SpaceAccessRole,
  SpaceInvitation,
  SpaceInvitationStatus,
  SpaceMember,
} from '../db/types';
import { TYPES } from '../core/di-types';

export type SpaceSharingErrorCode =
  | 'space_not_found'
  | 'active_member'
  | 'invalid_role'
  | 'invalid_email'
  | 'email_user_mismatch'
  | 'invitation_expired';

export class SpaceSharingError extends Error {
  constructor(
    public readonly code: SpaceSharingErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'SpaceSharingError';
  }
}

export interface SharingUserSummary {
  id: string;
  email: string;
  name: string | null;
}

export type SpaceAccessRequestWithRequester = SpaceAccessRequest & {
  requester: SharingUserSummary;
};

export type SpaceInvitationWithUsers = SpaceInvitation & {
  invitedBy: SharingUserSummary | null;
  acceptedBy: SharingUserSummary | null;
};

export type ActiveSpaceMemberWithUser = SpaceMember & {
  user: SharingUserSummary;
};

export interface SpaceSharingState {
  members: ActiveSpaceMemberWithUser[];
  pendingAccessRequests: SpaceAccessRequestWithRequester[];
  pendingInvitations: SpaceInvitationWithUsers[];
}

export interface CreateAccessRequestData {
  spaceId: string;
  requesterUserId: string;
  requestedRole: SpaceAccessRole;
  message?: string | null;
  now?: string;
}

export interface CreateInvitationData {
  spaceId: string;
  email: string;
  role: SpaceAccessRole;
  invitedByUserId: string;
  expiresAt?: string | null;
  now?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertAssignableRole(role: SpaceAccessRole): void {
  if (role !== 'editor' && role !== 'viewer') {
    throw new SpaceSharingError(
      'invalid_role',
      'Space sharing invitations and access requests can only grant editor or viewer access'
    );
  }
}

@injectable()
export class SpaceSharingDAO {
  constructor(@inject(TYPES.Database) private db: Kysely<Database>) {}

  async createAccessRequest(data: CreateAccessRequestData): Promise<SpaceAccessRequest> {
    assertAssignableRole(data.requestedRole);
    await this.assertActiveSpace(data.spaceId);
    await this.assertNoActiveMembership(data.spaceId, data.requesterUserId);

    const existing = await this.getPendingAccessRequestForUser(
      data.spaceId,
      data.requesterUserId
    );
    if (existing) {
      return existing;
    }

    const now = data.now ?? nowIso();
    const request = await this.db
      .insertInto('space_access_requests')
      .values({
        id: crypto.randomUUID(),
        space_id: data.spaceId,
        requester_user_id: data.requesterUserId,
        requested_role: data.requestedRole,
        status: 'pending',
        message: data.message ?? null,
        created_at: now,
        updated_at: now,
        resolved_at: null,
        resolved_by_user_id: null,
      })
      .onConflict((oc) => oc.doNothing())
      .returningAll()
      .executeTakeFirst();

    if (request) {
      return request;
    }

    const concurrentlyCreated = await this.getPendingAccessRequestForUser(
      data.spaceId,
      data.requesterUserId
    );
    if (!concurrentlyCreated) {
      throw new Error('Failed to create space access request');
    }

    return concurrentlyCreated;
  }

  async listAccessRequests(
    spaceId: string,
    status?: SpaceAccessRequestStatus
  ): Promise<SpaceAccessRequestWithRequester[]> {
    let query = this.db
      .selectFrom('space_access_requests')
      .innerJoin('spaces', 'spaces.id', 'space_access_requests.space_id')
      .innerJoin('users', 'users.id', 'space_access_requests.requester_user_id')
      .selectAll('space_access_requests')
      .select([
        'users.id as requester_id',
        'users.email as requester_email',
        'users.name as requester_name',
      ])
      .where('space_access_requests.space_id', '=', spaceId)
      .where('spaces.deleted_at', 'is', null);

    if (status) {
      query = query.where('space_access_requests.status', '=', status);
    }

    const rows = await query
      .orderBy('space_access_requests.created_at', 'asc')
      .execute();

    return rows.map((row) => ({
      ...toAccessRequest(row),
      requester: {
        id: String(row.requester_id),
        email: row.requester_email,
        name: row.requester_name,
      },
    }));
  }

  async updateAccessRequestRole(
    requestId: string,
    requestedRole: SpaceAccessRole
  ): Promise<SpaceAccessRequest | null> {
    assertAssignableRole(requestedRole);
    const updatedAt = nowIso();
    const result = await this.db
      .updateTable('space_access_requests')
      .set({
        requested_role: requestedRole,
        updated_at: updatedAt,
      })
      .where('id', '=', requestId)
      .where('status', '=', 'pending')
      .returningAll()
      .executeTakeFirst();

    return result ?? null;
  }

  async resolveAccessRequest(
    requestId: string,
    resolverUserId: string,
    status: Extract<SpaceAccessRequestStatus, 'approved' | 'rejected'>
  ): Promise<SpaceAccessRequest | null> {
    const request = await this.getPendingAccessRequestById(requestId);
    if (!request) {
      return null;
    }

    await this.assertActiveSpace(request.space_id);

    if (status === 'approved') {
      await this.assertNoActiveMembership(
        request.space_id,
        request.requester_user_id
      );
    }

    const resolvedAt = nowIso();
    const result = await this.db
      .updateTable('space_access_requests')
      .set({
        status,
        updated_at: resolvedAt,
        resolved_at: resolvedAt,
        resolved_by_user_id: resolverUserId,
      })
      .where('id', '=', requestId)
      .where('status', '=', 'pending')
      .returningAll()
      .executeTakeFirst();

    if (result && status === 'approved') {
      await this.upsertActiveMember(
        request.space_id,
        request.requester_user_id,
        request.requested_role
      );
    }

    return result ?? null;
  }

  async cancelAccessRequest(
    requestId: string,
    requesterUserId: string
  ): Promise<SpaceAccessRequest | null> {
    const canceledAt = nowIso();
    const result = await this.db
      .updateTable('space_access_requests')
      .set({
        status: 'canceled',
        updated_at: canceledAt,
        resolved_at: canceledAt,
      })
      .where('id', '=', requestId)
      .where('requester_user_id', '=', requesterUserId)
      .where('status', '=', 'pending')
      .returningAll()
      .executeTakeFirst();

    return result ?? null;
  }

  async createInvitation(data: CreateInvitationData): Promise<SpaceInvitation> {
    assertAssignableRole(data.role);
    await this.assertActiveSpace(data.spaceId);

    const normalizedEmail = normalizeInvitationEmail(data.email);
    if (!normalizedEmail) {
      throw new SpaceSharingError('invalid_email', 'Invitation email is required');
    }

    const invitedUser = await this.findUserByNormalizedEmail(normalizedEmail);
    if (invitedUser) {
      await this.assertNoActiveMembership(data.spaceId, String(invitedUser.id));
    }

    const existing = await this.getPendingInvitationForEmail(
      data.spaceId,
      normalizedEmail
    );
    if (existing) {
      return existing;
    }

    const now = data.now ?? nowIso();
    const invitation = await this.db
      .insertInto('space_invitations')
      .values({
        id: crypto.randomUUID(),
        space_id: data.spaceId,
        email: normalizedEmail,
        normalized_email: normalizedEmail,
        role: data.role,
        status: 'pending',
        invited_by_user_id: data.invitedByUserId,
        accepted_by_user_id: null,
        created_at: now,
        updated_at: now,
        expires_at: data.expiresAt ?? null,
        resolved_at: null,
      })
      .onConflict((oc) => oc.doNothing())
      .returningAll()
      .executeTakeFirst();

    if (invitation) {
      return invitation;
    }

    const concurrentlyCreated = await this.getPendingInvitationForEmail(
      data.spaceId,
      normalizedEmail
    );
    if (!concurrentlyCreated) {
      throw new Error('Failed to create space invitation');
    }

    return concurrentlyCreated;
  }

  async listInvitations(
    spaceId: string,
    status?: SpaceInvitationStatus
  ): Promise<SpaceInvitationWithUsers[]> {
    let query = this.db
      .selectFrom('space_invitations')
      .innerJoin('spaces', 'spaces.id', 'space_invitations.space_id')
      .leftJoin('users as invited_by_user', 'invited_by_user.id', 'space_invitations.invited_by_user_id')
      .leftJoin('users as accepted_by_user', 'accepted_by_user.id', 'space_invitations.accepted_by_user_id')
      .selectAll('space_invitations')
      .select([
        'invited_by_user.id as invited_by_id',
        'invited_by_user.email as invited_by_email',
        'invited_by_user.name as invited_by_name',
        'accepted_by_user.id as accepted_by_id',
        'accepted_by_user.email as accepted_by_email',
        'accepted_by_user.name as accepted_by_name',
      ])
      .where('space_invitations.space_id', '=', spaceId)
      .where('spaces.deleted_at', 'is', null);

    if (status) {
      query = query.where('space_invitations.status', '=', status);
    }

    const rows = await query
      .orderBy('space_invitations.created_at', 'asc')
      .execute();

    return rows.map((row) => ({
      ...toInvitation(row),
      invitedBy: row.invited_by_id == null ? null : {
        id: String(row.invited_by_id),
        email: row.invited_by_email ?? '',
        name: row.invited_by_name ?? null,
      },
      acceptedBy: row.accepted_by_id == null ? null : {
        id: String(row.accepted_by_id),
        email: row.accepted_by_email ?? '',
        name: row.accepted_by_name ?? null,
      },
    }));
  }

  async updateInvitationRole(
    invitationId: string,
    role: SpaceAccessRole
  ): Promise<SpaceInvitation | null> {
    assertAssignableRole(role);
    const updatedAt = nowIso();
    const result = await this.db
      .updateTable('space_invitations')
      .set({
        role,
        updated_at: updatedAt,
      })
      .where('id', '=', invitationId)
      .where('status', '=', 'pending')
      .returningAll()
      .executeTakeFirst();

    return result ?? null;
  }

  async acceptInvitation(
    invitationId: string,
    acceptedByUserId: string,
    now = nowIso()
  ): Promise<SpaceInvitation | null> {
    const invitation = await this.getPendingInvitationById(invitationId);
    if (!invitation) {
      return null;
    }

    await this.assertActiveSpace(invitation.space_id);
    if (invitation.expires_at && invitation.expires_at <= now) {
      await this.expireInvitation(invitationId, now);
      throw new SpaceSharingError('invitation_expired', 'Invitation has expired');
    }

    const acceptingUser = await this.db
      .selectFrom('users')
      .select(['id', 'email'])
      .where('id', '=', Number(acceptedByUserId))
      .executeTakeFirst();

    if (
      !acceptingUser ||
      normalizeInvitationEmail(acceptingUser.email) !== invitation.normalized_email
    ) {
      throw new SpaceSharingError(
        'email_user_mismatch',
        'Invitation can only be accepted by a user with the invited email address'
      );
    }

    await this.assertNoActiveMembership(invitation.space_id, acceptedByUserId);

    const resolvedAt = nowIso();
    const result = await this.db
      .updateTable('space_invitations')
      .set({
        status: 'accepted',
        accepted_by_user_id: acceptedByUserId,
        updated_at: resolvedAt,
        resolved_at: resolvedAt,
      })
      .where('id', '=', invitationId)
      .where('status', '=', 'pending')
      .returningAll()
      .executeTakeFirst();

    if (result) {
      await this.upsertActiveMember(
        invitation.space_id,
        acceptedByUserId,
        invitation.role
      );
    }

    return result ?? null;
  }

  async revokeInvitation(invitationId: string): Promise<SpaceInvitation | null> {
    const revokedAt = nowIso();
    const result = await this.db
      .updateTable('space_invitations')
      .set({
        status: 'revoked',
        updated_at: revokedAt,
        resolved_at: revokedAt,
      })
      .where('id', '=', invitationId)
      .where('status', '=', 'pending')
      .returningAll()
      .executeTakeFirst();

    return result ?? null;
  }

  async expireInvitation(
    invitationId: string,
    expiredAt = nowIso()
  ): Promise<SpaceInvitation | null> {
    const result = await this.db
      .updateTable('space_invitations')
      .set({
        status: 'expired',
        updated_at: expiredAt,
        resolved_at: expiredAt,
      })
      .where('id', '=', invitationId)
      .where('status', '=', 'pending')
      .returningAll()
      .executeTakeFirst();

    return result ?? null;
  }

  async getSharingState(spaceId: string): Promise<SpaceSharingState | null> {
    const space = await this.getActiveSpace(spaceId);
    if (!space) {
      return null;
    }

    const members = await this.db
      .selectFrom('space_members')
      .innerJoin('users', 'users.id', 'space_members.user_id')
      .select([
        'space_members.space_id',
        'space_members.user_id',
        'space_members.role',
        'space_members.joined_at',
        'space_members.deleted_at',
        'users.id as user_id_alias',
        'users.email as user_email',
        'users.name as user_name',
      ])
      .where('space_members.space_id', '=', spaceId)
      .where('space_members.deleted_at', 'is', null)
      .orderBy('space_members.joined_at', 'asc')
      .execute();

    return {
      members: members.map((row) => ({
        space_id: row.space_id,
        user_id: row.user_id,
        role: row.role,
        joined_at: row.joined_at,
        deleted_at: row.deleted_at,
        user: {
          id: String(row.user_id_alias),
          email: row.user_email,
          name: row.user_name,
        },
      })),
      pendingAccessRequests: await this.listAccessRequests(spaceId, 'pending'),
      pendingInvitations: await this.listInvitations(spaceId, 'pending'),
    };
  }

  private async getPendingAccessRequestForUser(
    spaceId: string,
    requesterUserId: string
  ): Promise<SpaceAccessRequest | null> {
    const request = await this.db
      .selectFrom('space_access_requests')
      .selectAll()
      .where('space_id', '=', spaceId)
      .where('requester_user_id', '=', requesterUserId)
      .where('status', '=', 'pending')
      .executeTakeFirst();

    return request ?? null;
  }

  private async getPendingAccessRequestById(
    requestId: string
  ): Promise<SpaceAccessRequest | null> {
    const request = await this.db
      .selectFrom('space_access_requests')
      .selectAll()
      .where('id', '=', requestId)
      .where('status', '=', 'pending')
      .executeTakeFirst();

    return request ?? null;
  }

  private async getPendingInvitationForEmail(
    spaceId: string,
    normalizedEmail: string
  ): Promise<SpaceInvitation | null> {
    const invitation = await this.db
      .selectFrom('space_invitations')
      .selectAll()
      .where('space_id', '=', spaceId)
      .where('normalized_email', '=', normalizedEmail)
      .where('status', '=', 'pending')
      .executeTakeFirst();

    return invitation ?? null;
  }

  private async getPendingInvitationById(
    invitationId: string
  ): Promise<SpaceInvitation | null> {
    const invitation = await this.db
      .selectFrom('space_invitations')
      .selectAll()
      .where('id', '=', invitationId)
      .where('status', '=', 'pending')
      .executeTakeFirst();

    return invitation ?? null;
  }

  private async assertActiveSpace(spaceId: string): Promise<void> {
    const space = await this.getActiveSpace(spaceId);
    if (!space) {
      throw new SpaceSharingError('space_not_found', 'Space not found');
    }
  }

  private async getActiveSpace(spaceId: string): Promise<{ id: string } | null> {
    const space = await this.db
      .selectFrom('spaces')
      .select('id')
      .where('id', '=', spaceId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    return space ?? null;
  }

  private async assertNoActiveMembership(
    spaceId: string,
    userId: string
  ): Promise<void> {
    const member = await this.db
      .selectFrom('space_members')
      .innerJoin('spaces', 'spaces.id', 'space_members.space_id')
      .select('space_members.user_id')
      .where('space_members.space_id', '=', spaceId)
      .where('space_members.user_id', '=', userId)
      .where('space_members.deleted_at', 'is', null)
      .where('spaces.deleted_at', 'is', null)
      .executeTakeFirst();

    if (member) {
      throw new SpaceSharingError(
        'active_member',
        'User already has active access to this space'
      );
    }
  }

  private async upsertActiveMember(
    spaceId: string,
    userId: string,
    role: SpaceAccessRole
  ): Promise<void> {
    await this.db
      .insertInto('space_members')
      .values({
        space_id: spaceId,
        user_id: userId,
        role,
        joined_at: Date.now(),
        deleted_at: null,
      })
      .onConflict((oc) => oc.columns(['space_id', 'user_id']).doUpdateSet({
        role,
        joined_at: Date.now(),
        deleted_at: null,
      }))
      .executeTakeFirst();
  }

  private async findUserByNormalizedEmail(
    normalizedEmail: string
  ): Promise<{ id: number; email: string } | null> {
    const user = await this.db
      .selectFrom('users')
      .select(['id', 'email'])
      .where(sql<string>`lower(email)`, '=', normalizedEmail)
      .executeTakeFirst();

    return user ?? null;
  }
}

function toAccessRequest(row: SpaceAccessRequest): SpaceAccessRequest {
  return {
    id: row.id,
    space_id: row.space_id,
    requester_user_id: row.requester_user_id,
    requested_role: row.requested_role,
    status: row.status,
    message: row.message,
    created_at: row.created_at,
    updated_at: row.updated_at,
    resolved_at: row.resolved_at,
    resolved_by_user_id: row.resolved_by_user_id,
  };
}

function toInvitation(row: SpaceInvitation): SpaceInvitation {
  return {
    id: row.id,
    space_id: row.space_id,
    email: row.email,
    normalized_email: row.normalized_email,
    role: row.role,
    status: row.status,
    invited_by_user_id: row.invited_by_user_id,
    accepted_by_user_id: row.accepted_by_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
    resolved_at: row.resolved_at,
  };
}
