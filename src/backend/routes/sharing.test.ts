import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import { AuthService } from '../features/auth/auth-service';
import { MemberDAO } from '../../dao/member-dao';
import { SpaceDAO } from '../../dao/space-dao';
import { SpaceSharingDAO } from '../../dao/space-sharing-dao';
import { UserDAO } from '../../dao/user-dao';
import type { Env, SendEmailMessage } from '../../core/types';
import type { Database } from '../../db/types';
import { cleanupTestDatabase, createTestDatabase } from '../../test-utils/database';
import { TestUserBuilder } from '../../test-utils/test-data-builders';
import { apiFetch, type ApiEndpointKey, type ApiFetchOptions } from '../../shared/api/client';
import { EmailService } from '../services/email-service';
import { NotificationEmailService } from '../services/notification-email-service';
import { createOpenApiRouter } from './openapi';
import { sharingRoutes } from './sharing';
import type { AppContext } from './types';

const baseUrl = 'https://sharing.test';
type FetchLike = NonNullable<ApiFetchOptions<ApiEndpointKey>['fetch']>;

function bindFetch(app: ReturnType<typeof createOpenApiRouter>): FetchLike {
  return async (input, init) => app.fetch(new Request(input, init));
}

describe('sharingRoutes', () => {
  let db: Kysely<Database>;
  let currentUserId: number;
  let ownerId: string;
  let requesterId: string;
  let inviteeId: string;
  let memberDAO: MemberDAO;
  let fetch: FetchLike;
  let sent: SendEmailMessage[];
  let emailShouldThrow: boolean;

  beforeEach(async () => {
    db = await createTestDatabase();
    const userDAO = new UserDAO(db);
    const spaceDAO = new SpaceDAO(db);
    memberDAO = new MemberDAO(db);
    const sharingDAO = new SpaceSharingDAO(db);
    sent = [];
    emailShouldThrow = false;
    const env = {
      ENVIRONMENT: 'stage',
      OIDC_ISSUER: baseUrl,
      MAKEFX_EMAIL_FROM: 'notifications@makefx.app',
      EMAIL: {
        send: async (message: SendEmailMessage) => {
          if (emailShouldThrow) {
            throw new Error('email unavailable');
          }
          sent.push(message);
          return {};
        },
      },
    } as Env;
    const emailService = new EmailService(env);
    const notificationEmailService = new NotificationEmailService(emailService, env);

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
    currentUserId = owner.id;

    await spaceDAO.createSpace({
      id: 'space-1',
      name: 'Shared Space',
      owner_id: ownerId,
      created_at: 1_787_000_000_000,
    });
    await memberDAO.addMember({
      space_id: 'space-1',
      user_id: ownerId,
      role: 'owner',
      joined_at: 1,
    });

    const fakeAuthService = {
      verifyJWT: async () => ({ userId: currentUserId }),
    };
    const app = createOpenApiRouter();
    app.use('*', async (c, next) => {
      c.env = env as AppContext['Bindings'];
      c.set('container', {
        get: (token: unknown) => {
          const deps = new Map<unknown, unknown>([
            [AuthService, fakeAuthService],
            [UserDAO, userDAO],
            [SpaceDAO, spaceDAO],
            [MemberDAO, memberDAO],
            [SpaceSharingDAO, sharingDAO],
            [NotificationEmailService, notificationEmailService],
          ]);
          const dep = deps.get(token);
          if (!dep) throw new Error('Missing fake dependency');
          return dep;
        },
      } as never);
      await next();
    });
    app.route('/', sharingRoutes);
    fetch = bindFetch(app);
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  test('lets a signed-in non-member inspect, request, and cancel space access', async () => {
    currentUserId = Number(requesterId);

    const initial = await apiFetch('GET /api/spaces/:id/access', {
      fetch,
      baseUrl,
      headers: { Authorization: 'Bearer requester-token' },
      params: { id: 'space-1' },
    });
    assert.equal(initial.access.status, 'none');

    const created = await apiFetch('POST /api/spaces/:id/access-requests', {
      fetch,
      baseUrl,
      headers: { Authorization: 'Bearer requester-token' },
      params: { id: 'space-1' },
      json: { requestedRole: 'editor', message: 'Please add me' },
    });
    assert.equal(created.request.status, 'pending');
    assert.equal(created.request.requested_role, 'editor');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'owner@example.com');
    assert.match(sent[0].text, /requester@example\.com/);
    assert.match(sent[0].text, /Open Space: https:\/\/sharing\.test\/spaces\/space-1/);

    const duplicate = await apiFetch('POST /api/spaces/:id/access-requests', {
      fetch,
      baseUrl,
      headers: { Authorization: 'Bearer requester-token' },
      params: { id: 'space-1' },
      json: { requestedRole: 'viewer' },
    });
    assert.equal(duplicate.request.id, created.request.id);
    assert.equal(duplicate.request.requested_role, 'editor');
    assert.equal(sent.length, 1);

    const pending = await apiFetch('GET /api/spaces/:id/access', {
      fetch,
      baseUrl,
      headers: { Authorization: 'Bearer requester-token' },
      params: { id: 'space-1' },
    });
    assert.equal(pending.access.status, 'pending_request');
    assert.equal(pending.access.pendingRequest?.id, created.request.id);

    const canceled = await apiFetch('DELETE /api/spaces/:id/access-requests/me', {
      fetch,
      baseUrl,
      headers: { Authorization: 'Bearer requester-token' },
      params: { id: 'space-1' },
    });
    assert.equal(canceled.request?.status, 'canceled');
    assert.equal(await memberDAO.getMember('space-1', requesterId), null);
  });

  test('lets an owner list sharing state, invite by normalized email, and revoke without membership', async () => {
    currentUserId = Number(requesterId);
    await apiFetch('POST /api/spaces/:id/access-requests', {
      fetch,
      baseUrl,
      headers: { Authorization: 'Bearer requester-token' },
      params: { id: 'space-1' },
      json: { requestedRole: 'viewer' },
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'owner@example.com');

    currentUserId = Number(inviteeId);
    const invited = await apiFetch('GET /api/spaces/:id/access', {
      fetch,
      baseUrl,
      headers: { Authorization: 'Bearer invitee-token' },
      params: { id: 'space-1' },
    });
    assert.equal(invited.access.status, 'none');

    currentUserId = Number(ownerId);
    const invitation = await apiFetch('POST /api/spaces/:id/invitations', {
      fetch,
      baseUrl,
      headers: { Authorization: 'Bearer owner-token' },
      params: { id: 'space-1' },
      json: { email: ' Invitee@Example.COM ', role: 'editor' },
    });
    assert.equal(invitation.invitation.email, 'invitee@example.com');
    assert.equal(invitation.invitation.normalized_email, 'invitee@example.com');
    assert.equal(sent.length, 2);
    assert.equal(sent[1].to, 'invitee@example.com');
    assert.match(sent[1].text, /invited you/);

    currentUserId = Number(inviteeId);
    const pendingInvitation = await apiFetch('GET /api/spaces/:id/access', {
      fetch,
      baseUrl,
      headers: { Authorization: 'Bearer invitee-token' },
      params: { id: 'space-1' },
    });
    assert.equal(pendingInvitation.access.status, 'pending_invitation');
    assert.equal(pendingInvitation.access.pendingInvitation?.id, invitation.invitation.id);

    currentUserId = Number(ownerId);
    const sharing = await apiFetch('GET /api/spaces/:id/sharing', {
      fetch,
      baseUrl,
      headers: { Authorization: 'Bearer owner-token' },
      params: { id: 'space-1' },
    });
    assert.deepEqual(sharing.members.map((member) => member.role), ['owner']);
    assert.equal(sharing.pendingInvitations.length, 1);

    const revoked = await apiFetch('POST /api/spaces/:id/invitations/:invitationId/revoke', {
      fetch,
      baseUrl,
      headers: { Authorization: 'Bearer owner-token' },
      params: { id: 'space-1', invitationId: invitation.invitation.id },
    });
    assert.equal(revoked.invitation.status, 'revoked');
    assert.equal(await memberDAO.getMember('space-1', inviteeId), null);
    assert.equal(sent.length, 3);
    assert.equal(sent[2].to, 'invitee@example.com');
    assert.match(sent[2].text, /revoked/);
  });

  test('lets an invited user accept and receive an accepted notification', async () => {
    currentUserId = Number(ownerId);
    const invitation = await apiFetch('POST /api/spaces/:id/invitations', {
      fetch,
      baseUrl,
      headers: { Authorization: 'Bearer owner-token' },
      params: { id: 'space-1' },
      json: { email: 'Invitee@Example.com', role: 'viewer' },
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'invitee@example.com');

    currentUserId = Number(inviteeId);
    const accepted = await apiFetch('POST /api/spaces/:id/invitations/:invitationId/accept', {
      fetch,
      baseUrl,
      headers: { Authorization: 'Bearer invitee-token' },
      params: { id: 'space-1', invitationId: invitation.invitation.id },
    });

    assert.equal(accepted.invitation.status, 'accepted');
    assert.equal((await memberDAO.getMember('space-1', inviteeId))?.role, 'viewer');
    assert.equal(sent.length, 2);
    assert.equal(sent[1].to, 'Invitee@Example.com');
    assert.match(sent[1].text, /accepted/);
  });

  test('approves requests idempotently enough for retries and rejects without membership', async () => {
    currentUserId = Number(requesterId);
    const created = await apiFetch('POST /api/spaces/:id/access-requests', {
      fetch,
      baseUrl,
      headers: { Authorization: 'Bearer requester-token' },
      params: { id: 'space-1' },
      json: { requestedRole: 'editor' },
    });

    currentUserId = Number(ownerId);
    const approved = await apiFetch('POST /api/spaces/:id/access-requests/:requestId/approve', {
      fetch,
      baseUrl,
      headers: { Authorization: 'Bearer owner-token' },
      params: { id: 'space-1', requestId: created.request.id },
      json: { role: 'viewer' },
    });
    assert.equal(approved.request.status, 'approved');
    assert.equal(approved.request.requested_role, 'viewer');
    assert.equal((await memberDAO.getMember('space-1', requesterId))?.role, 'viewer');
    assert.equal(sent.length, 2);
    assert.equal(sent[1].to, 'requester@example.com');
    assert.match(sent[1].text, /accepted/);
    assert.match(sent[1].text, /Role: viewer/);

    const retry = await fetch(`${baseUrl}/api/spaces/space-1/access-requests/${created.request.id}/approve`, {
      method: 'POST',
      headers: { Authorization: 'Bearer owner-token' },
    });
    assert.equal(retry.status, 404);

    const rows = await db
      .selectFrom('space_members')
      .selectAll()
      .where('space_id', '=', 'space-1')
      .where('user_id', '=', requesterId)
      .where('deleted_at', 'is', null)
      .execute();
    assert.equal(rows.length, 1);

    currentUserId = Number(inviteeId);
    const rejectCandidate = await apiFetch('POST /api/spaces/:id/access-requests', {
      fetch,
      baseUrl,
      headers: { Authorization: 'Bearer invitee-token' },
      params: { id: 'space-1' },
      json: { requestedRole: 'viewer' },
    });

    currentUserId = Number(ownerId);
    const rejected = await apiFetch('POST /api/spaces/:id/access-requests/:requestId/reject', {
      fetch,
      baseUrl,
      headers: { Authorization: 'Bearer owner-token' },
      params: { id: 'space-1', requestId: rejectCandidate.request.id },
    });
    assert.equal(rejected.request.status, 'rejected');
    assert.equal(await memberDAO.getMember('space-1', inviteeId), null);
    assert.equal(sent.length, 3);
  });

  test('email send failures do not corrupt access state', async () => {
    currentUserId = Number(requesterId);
    emailShouldThrow = true;

    const created = await apiFetch('POST /api/spaces/:id/access-requests', {
      fetch,
      baseUrl,
      headers: { Authorization: 'Bearer requester-token' },
      params: { id: 'space-1' },
      json: { requestedRole: 'viewer' },
    });

    assert.equal(created.request.status, 'pending');
    assert.equal(sent.length, 0);
    const pending = await db
      .selectFrom('space_access_requests')
      .selectAll()
      .where('id', '=', created.request.id)
      .executeTakeFirst();
    assert.equal(pending?.status, 'pending');
  });

  test('requires owner role for owner sharing actions', async () => {
    currentUserId = Number(requesterId);

    const response = await fetch(`${baseUrl}/api/spaces/space-1/sharing`, {
      headers: { Authorization: 'Bearer requester-token' },
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: 'Only the owner can manage space sharing',
    });
  });
});
