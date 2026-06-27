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
import { EmailService } from '../services/email-service';
import { NotificationEmailService } from '../services/notification-email-service';
import { createOpenApiRouter } from './openapi';
import { imageRoutes } from './image';
import { memberRoutes } from './member';
import { sharingRoutes } from './sharing';
import { spaceRoutes } from './space';
import type { AppContext } from './types';
import { websocketRoutes } from './websocket';

const baseUrl = 'https://sharing-flow.test';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function makeObject(key: string, body: string, contentType: string): R2ObjectBody {
  const bytes = new TextEncoder().encode(body);
  return {
    key,
    version: 'version',
    size: bytes.byteLength,
    etag: 'etag',
    httpEtag: '"etag"',
    checksums: {} as R2Checksums,
    uploaded: new Date('2026-06-27T00:00:00.000Z'),
    httpMetadata: { contentType },
    customMetadata: undefined,
    range: undefined,
    storageClass: 'Standard',
    ssecKeyMd5: undefined,
    writeHttpMetadata(headers: Headers) {
      headers.set('Content-Type', contentType);
    },
    body: new Blob([toArrayBuffer(bytes)]).stream(),
    bodyUsed: false,
    arrayBuffer: async () => toArrayBuffer(bytes),
    bytes: async () => bytes,
    text: async () => body,
    json: async <T>() => JSON.parse(body) as T,
    blob: async () => new Blob([toArrayBuffer(bytes)]),
  };
}

async function json<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('Space sharing end-to-end route flow', () => {
  let db: Kysely<Database>;
  let ownerId: string;
  let requesterId: string;
  let rejectedId: string;
  let memberDAO: MemberDAO;
  let app: ReturnType<typeof createOpenApiRouter>;
  let sent: SendEmailMessage[];
  let doCalls: string[];

  beforeEach(async () => {
    db = await createTestDatabase();
    const userDAO = new UserDAO(db);
    const spaceDAO = new SpaceDAO(db);
    memberDAO = new MemberDAO(db);
    const sharingDAO = new SpaceSharingDAO(db);
    sent = [];
    doCalls = [];

    const owner = await new TestUserBuilder()
      .withEmail('owner@example.com')
      .withName('Owner')
      .create(db);
    const requester = await new TestUserBuilder()
      .withEmail('requester@example.com')
      .withName('Requester')
      .create(db);
    const rejected = await new TestUserBuilder()
      .withEmail('rejected@example.com')
      .withName('Rejected')
      .create(db);

    ownerId = String(owner.id);
    requesterId = String(requester.id);
    rejectedId = String(rejected.id);

    const tokenUsers = new Map([
      ['owner-token', owner.id],
      ['requester-token', requester.id],
      ['rejected-token', rejected.id],
    ]);
    const fakeAuthService = {
      verifyJWT: async (token: string) => {
        const userId = tokenUsers.get(token);
        return userId ? { userId } : null;
      },
    };

    const env = {
      ENVIRONMENT: 'stage',
      OIDC_ISSUER: baseUrl,
      PUBLIC_SITE_ORIGIN: baseUrl,
      MAKEFX_EMAIL_FROM: 'notifications@makefx.app',
      EMAIL: {
        send: async (message: SendEmailMessage) => {
          sent.push(message);
          return {};
        },
      },
      IMAGES: {
        get: async (key: string) => {
          if (key === 'media/shared-space/variant-1.mp4') {
            return makeObject(key, 'media-bytes', 'video/mp4');
          }
          return null;
        },
      },
      SPACES_DO: {
        idFromName: (name: string) => name,
        get: (spaceId: string) => ({
          fetch: async (request: Request) => {
            const url = new URL(request.url);
            doCalls.push(url.pathname);

            if (url.pathname === '/internal/state') {
              return Response.json({
                assets: [{
                  id: 'asset-1',
                  name: 'Hero Sword',
                  type: 'item',
                  media_kind: 'video',
                  tags: '[]',
                  parent_asset_id: null,
                  active_variant_id: 'variant-1',
                  created_by: ownerId,
                  created_at: 1_787_000_000_100,
                  updated_at: 1_787_000_000_100,
                }],
              });
            }

            if (url.pathname === '/internal/variant/variant-1') {
              return Response.json({
                id: 'variant-1',
                status: 'completed',
                media_kind: 'video',
                media_key: 'media/shared-space/variant-1.mp4',
                media_mime_type: 'video/mp4',
              });
            }

            if (url.pathname === `/api/spaces/${spaceId}/ws`) {
              const token = request.headers.get('Authorization')?.replace(/^Bearer /, '');
              const userId = token ? tokenUsers.get(token) : null;
              if (!userId || !(await memberDAO.getMember(spaceId, String(userId)))) {
                return new Response('Not a member', { status: 403 });
              }
              return new Response('WebSocket accepted', { status: 200 });
            }

            return Response.json({ error: 'Not found' }, { status: 404 });
          },
        }),
      },
    } as unknown as Env;
    const emailService = new EmailService(env);
    const notificationEmailService = new NotificationEmailService(emailService, env);

    app = createOpenApiRouter();
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
    app.route('/', spaceRoutes);
    app.route('/', memberRoutes);
    app.route('/', sharingRoutes);
    app.route('/', imageRoutes);
    app.route('/', websocketRoutes);
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  test('covers request, approval, access, duplicate, rejection, and revocation paths', async () => {
    const createdSpaceResponse = await app.fetch(new Request(`${baseUrl}/api/spaces`, {
      method: 'POST',
      headers: { ...auth('owner-token'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Shared Space' }),
    }));
    assert.equal(createdSpaceResponse.status, 201);
    const createdSpace = await json<{ space: { id: string; name: string; role: string } }>(createdSpaceResponse);
    const spaceId = createdSpace.space.id;
    assert.equal(createdSpace.space.role, 'owner');

    await assertDeniedWithoutMetadata(
      await app.fetch(new Request(`${baseUrl}/api/spaces/${spaceId}`, {
        headers: auth('requester-token'),
      }))
    );
    await assertDeniedWithoutMetadata(
      await app.fetch(new Request(`${baseUrl}/api/spaces/${spaceId}/assets`, {
        headers: auth('requester-token'),
      }))
    );
    const beforeVariantLookups = doCalls.filter((path) => path.startsWith('/internal/variant')).length;
    await assertDeniedWithoutMetadata(
      await app.fetch(new Request(`${baseUrl}/api/spaces/${spaceId}/variants/variant-1/media`, {
        headers: auth('requester-token'),
      }))
    );
    assert.equal(doCalls.filter((path) => path.startsWith('/internal/variant')).length, beforeVariantLookups);
    const deniedWs = await app.fetch(new Request(`${baseUrl}/api/spaces/${spaceId}/ws`, {
      headers: { ...auth('requester-token'), Upgrade: 'websocket' },
    }));
    assert.equal(deniedWs.status, 403);

    const initialAccess = await json<{ access: { status: string } }>(
      await app.fetch(new Request(`${baseUrl}/api/spaces/${spaceId}/access`, {
        headers: auth('requester-token'),
      }))
    );
    assert.equal(initialAccess.access.status, 'none');

    const createdRequest = await json<{ request: { id: string; requested_role: string; status: string } }>(
      await app.fetch(new Request(`${baseUrl}/api/spaces/${spaceId}/access-requests`, {
        method: 'POST',
        headers: { ...auth('requester-token'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestedRole: 'editor', message: 'Please add me' }),
      }))
    );
    assert.equal(createdRequest.request.status, 'pending');
    assert.equal(createdRequest.request.requested_role, 'editor');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'owner@example.com');
    assert.match(sent[0].text, /requester@example\.com/);

    const duplicateRequest = await json<{ request: { id: string; requested_role: string } }>(
      await app.fetch(new Request(`${baseUrl}/api/spaces/${spaceId}/access-requests`, {
        method: 'POST',
        headers: { ...auth('requester-token'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestedRole: 'viewer' }),
      }))
    );
    assert.equal(duplicateRequest.request.id, createdRequest.request.id);
    assert.equal(duplicateRequest.request.requested_role, 'editor');
    assert.equal(sent.length, 1);
    assert.equal(await pendingRequestCount(spaceId, requesterId), 1);

    const ownerSharing = await json<{
      members: Array<{ user_id: string; role: string }>;
      pendingAccessRequests: Array<{ id: string; requester: { email: string } }>;
    }>(
      await app.fetch(new Request(`${baseUrl}/api/spaces/${spaceId}/sharing`, {
        headers: auth('owner-token'),
      }))
    );
    assert.deepEqual(ownerSharing.members.map((member) => member.role), ['owner']);
    assert.equal(ownerSharing.pendingAccessRequests[0].id, createdRequest.request.id);
    assert.equal(ownerSharing.pendingAccessRequests[0].requester.email, 'requester@example.com');

    const approved = await app.fetch(new Request(`${baseUrl}/api/spaces/${spaceId}/access-requests/${createdRequest.request.id}/approve`, {
      method: 'POST',
      headers: { ...auth('owner-token'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'viewer' }),
    }));
    assert.equal(approved.status, 200);
    assert.equal((await memberDAO.getMember(spaceId, requesterId))?.role, 'viewer');
    assert.equal(sent.length, 2);
    assert.equal(sent[1].to, 'requester@example.com');
    assert.match(sent[1].text, /Role: viewer/);

    const memberAccess = await json<{ access: { status: string; member: { role: string } } }>(
      await app.fetch(new Request(`${baseUrl}/api/spaces/${spaceId}/access`, {
        headers: auth('requester-token'),
      }))
    );
    assert.equal(memberAccess.access.status, 'member');
    assert.equal(memberAccess.access.member.role, 'viewer');

    const requesterSpace = await json<{ space: { name: string; role: string } }>(
      await app.fetch(new Request(`${baseUrl}/api/spaces/${spaceId}`, {
        headers: auth('requester-token'),
      }))
    );
    assert.equal(requesterSpace.space.name, 'Shared Space');
    assert.equal(requesterSpace.space.role, 'viewer');

    const requesterAssets = await json<{ assets: Array<{ id: string; name: string }> }>(
      await app.fetch(new Request(`${baseUrl}/api/spaces/${spaceId}/assets`, {
        headers: auth('requester-token'),
      }))
    );
    assert.deepEqual(requesterAssets.assets.map((asset) => asset.name), ['Hero Sword']);

    const requesterMedia = await app.fetch(new Request(`${baseUrl}/api/spaces/${spaceId}/variants/variant-1/media`, {
      headers: auth('requester-token'),
    }));
    assert.equal(requesterMedia.status, 200);
    assert.equal(await requesterMedia.text(), 'media-bytes');

    const allowedWs = await app.fetch(new Request(`${baseUrl}/api/spaces/${spaceId}/ws`, {
      headers: { ...auth('requester-token'), Upgrade: 'websocket' },
    }));
    assert.equal(allowedWs.status, 200);

    const rejectedRequest = await json<{ request: { id: string } }>(
      await app.fetch(new Request(`${baseUrl}/api/spaces/${spaceId}/access-requests`, {
        method: 'POST',
        headers: { ...auth('rejected-token'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestedRole: 'viewer' }),
      }))
    );
    const rejected = await app.fetch(new Request(`${baseUrl}/api/spaces/${spaceId}/access-requests/${rejectedRequest.request.id}/reject`, {
      method: 'POST',
      headers: auth('owner-token'),
    }));
    assert.equal(rejected.status, 200);
    assert.equal(await memberDAO.getMember(spaceId, rejectedId), null);
    await assertDeniedWithoutMetadata(
      await app.fetch(new Request(`${baseUrl}/api/spaces/${spaceId}`, {
        headers: auth('rejected-token'),
      }))
    );

    const revoked = await app.fetch(new Request(`${baseUrl}/api/spaces/${spaceId}/members/${requesterId}`, {
      method: 'DELETE',
      headers: auth('owner-token'),
    }));
    assert.equal(revoked.status, 200);
    assert.equal(await memberDAO.getMember(spaceId, requesterId), null);
    assert.equal(sent.length, 4);
    assert.equal(sent[3].to, 'requester@example.com');
    assert.match(sent[3].text, /revoked/);

    await assertDeniedWithoutMetadata(
      await app.fetch(new Request(`${baseUrl}/api/spaces/${spaceId}`, {
        headers: auth('requester-token'),
      }))
    );
    await assertDeniedWithoutMetadata(
      await app.fetch(new Request(`${baseUrl}/api/spaces/${spaceId}/variants/variant-1/media`, {
        headers: auth('requester-token'),
      }))
    );
    const revokedWs = await app.fetch(new Request(`${baseUrl}/api/spaces/${spaceId}/ws`, {
      headers: { ...auth('requester-token'), Upgrade: 'websocket' },
    }));
    assert.equal(revokedWs.status, 403);
  });

  async function pendingRequestCount(spaceId: string, userId: string): Promise<number> {
    const rows = await db
      .selectFrom('space_access_requests')
      .select('id')
      .where('space_id', '=', spaceId)
      .where('requester_user_id', '=', userId)
      .where('status', '=', 'pending')
      .execute();
    return rows.length;
  }
});

async function assertDeniedWithoutMetadata(response: Response): Promise<void> {
  assert.equal(response.status, 403);
  const body = await response.text();
  assert.deepEqual(JSON.parse(body), { error: 'Access denied' });
  assert.doesNotMatch(body, /Shared Space/);
  assert.doesNotMatch(body, /Hero Sword/);
  assert.doesNotMatch(body, /variant-1/);
  assert.doesNotMatch(body, /media\/shared-space/);
}
