import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import { AuthService } from '../features/auth/auth-service';
import { MemberDAO } from '../../dao/member-dao';
import { SpaceDAO } from '../../dao/space-dao';
import { UserDAO } from '../../dao/user-dao';
import type { Env, SendEmailMessage } from '../../core/types';
import type { Database } from '../../db/types';
import { cleanupTestDatabase, createTestDatabase } from '../../test-utils/database';
import { TestUserBuilder } from '../../test-utils/test-data-builders';
import { EmailService } from '../services/email-service';
import { NotificationEmailService } from '../services/notification-email-service';
import { memberRoutes } from './member';
import type { AppContext } from './types';

const baseUrl = 'https://members.test';

describe('memberRoutes notifications', () => {
  let db: Kysely<Database>;
  let currentUserId: number;
  let ownerId: string;
  let memberId: string;
  let candidateId: string;
  let memberDAO: MemberDAO;
  let sent: SendEmailMessage[];
  let app: Hono<AppContext>;

  beforeEach(async () => {
    db = await createTestDatabase();
    const userDAO = new UserDAO(db);
    const spaceDAO = new SpaceDAO(db);
    memberDAO = new MemberDAO(db);
    sent = [];

    const owner = await new TestUserBuilder()
      .withEmail('owner@example.com')
      .withName('Owner')
      .create(db);
    const member = await new TestUserBuilder()
      .withEmail('member@example.com')
      .withName('Member')
      .create(db);
    const candidate = await new TestUserBuilder()
      .withEmail('candidate@example.com')
      .withName('Candidate')
      .create(db);

    ownerId = String(owner.id);
    memberId = String(member.id);
    candidateId = String(candidate.id);
    currentUserId = owner.id;

    await spaceDAO.createSpace({
      id: 'space-1',
      name: 'Shared Space',
      owner_id: ownerId,
      created_at: 1_787_000_000_000,
    });
    await memberDAO.addMember({ space_id: 'space-1', user_id: ownerId, role: 'owner', joined_at: 1 });
    await memberDAO.addMember({ space_id: 'space-1', user_id: memberId, role: 'editor', joined_at: 2 });

    const env = {
      ENVIRONMENT: 'stage',
      OIDC_ISSUER: baseUrl,
      MAKEFX_EMAIL_FROM: 'notifications@makefx.app',
      EMAIL: {
        send: async (message: SendEmailMessage) => {
          sent.push(message);
          return {};
        },
      },
    } as Env;
    const emailService = new EmailService(env);
    const notificationEmailService = new NotificationEmailService(emailService, env);
    const fakeAuthService = {
      verifyJWT: async () => ({ userId: currentUserId }),
    };

    app = new Hono<AppContext>();
    app.use('*', async (c, next) => {
      c.env = env as AppContext['Bindings'];
      c.set('container', {
        get: (token: unknown) => {
          const deps = new Map<unknown, unknown>([
            [AuthService, fakeAuthService],
            [UserDAO, userDAO],
            [SpaceDAO, spaceDAO],
            [MemberDAO, memberDAO],
            [NotificationEmailService, notificationEmailService],
          ]);
          const dep = deps.get(token);
          if (!dep) throw new Error('Missing fake dependency');
          return dep;
        },
      } as never);
      await next();
    });
    app.route('/', memberRoutes);
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  test('direct member add sends accepted notification', async () => {
    const response = await app.request(`${baseUrl}/api/spaces/space-1/members`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer owner-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'candidate@example.com', role: 'viewer' }),
    });

    assert.equal(response.status, 200);
    assert.equal((await memberDAO.getMember('space-1', candidateId))?.role, 'viewer');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'candidate@example.com');
    assert.match(sent[0].text, /accepted/);
  });

  test('active member removal sends revoked notification', async () => {
    const response = await app.request(`${baseUrl}/api/spaces/space-1/members/${memberId}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer owner-token' },
    });

    assert.equal(response.status, 200);
    assert.equal(await memberDAO.getMember('space-1', memberId), null);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'member@example.com');
    assert.match(sent[0].text, /revoked/);
  });
});
