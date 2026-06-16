import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { AuthHandler } from '../features/auth/auth-handler';
import { AuthService } from '../features/auth/auth-service';
import { UserDAO } from '../../dao/user-dao';
import { SpaceDAO } from '../../dao/space-dao';
import { MemberDAO } from '../../dao/member-dao';
import { authRoutes } from './auth';
import { userRoutes } from './user';
import { spaceRoutes } from './space';
import { createOpenApiRouter } from './openapi';
import type { AppContext } from './types';
import { apiFetch, type ApiFetchOptions, type ApiEndpointKey } from '../../api/client';

const baseUrl = 'https://inventory.test';

const user = {
  id: 7,
  email: 'artist@example.test',
  name: 'Asset Artist',
  google_id: 'google-7',
  polar_customer_id: null,
  quota_limits: null,
  quota_limits_updated_at: null,
  rate_limit_count: 0,
  rate_limit_window_start: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const space = {
  id: 'space-1',
  name: 'Test Space',
  owner_id: String(user.id),
  created_at: 1_780_000_000_000,
};

const asset = {
  id: 'asset-1',
  name: 'Hero Sword',
  type: 'item',
  media_kind: 'image' as const,
  tags: '[]',
  parent_asset_id: null,
  active_variant_id: null,
  created_by: String(user.id),
  created_at: 1_780_000_000_100,
  updated_at: 1_780_000_000_100,
};

type FetchLike = NonNullable<ApiFetchOptions<ApiEndpointKey>['fetch']>;

function bindFetch(app: OpenAPIHono<AppContext>): FetchLike {
  return async (input, init) => app.fetch(new Request(input, init));
}

function routeApp(routes: OpenAPIHono<AppContext>, deps: Map<unknown, unknown>) {
  const app = createOpenApiRouter();
  app.use('*', async (c, next) => {
    c.env = {
      GOOGLE_CLIENT_ID: 'google-client',
      ENVIRONMENT: 'test',
      SPACES_DO: {
        idFromName: (id: string) => id,
        get: () => ({
          fetch: async () => Response.json({ assets: [asset] }),
        }),
      },
    } as unknown as AppContext['Bindings'];
    c.set('container', {
      get: (token: unknown) => {
        const dependency = deps.get(token);
        if (!dependency) {
          throw new Error('Missing fake dependency');
        }
        return dependency;
      },
    } as never);
    await next();
  });
  app.route('/', routes);
  return app;
}

describe('API contracts', () => {
  it('round-trips auth routes through the shared client contract', async () => {
    const fakeAuthHandler = {
      getSession: (c: Context) => c.json({
        user,
        config: {
          googleClientId: 'google-client',
          environment: 'test',
        },
      }, 200),
      googleAuth: async (c: Context) => {
        const body = await c.req.json<{ access_token: string }>();
        assert.equal(body.access_token, 'google-token');
        return c.json({ success: true, user }, 200);
      },
      logout: (c: Context) => c.json({ success: true }, 200),
    };
    const app = routeApp(authRoutes, new Map([[AuthHandler, fakeAuthHandler]]));
    const fetch = bindFetch(app);

    const session = await apiFetch('GET /api/auth/session', { fetch, baseUrl });
    assert.equal(session.config.environment, 'test');
    assert.equal(session.user?.id, user.id);

    const login = await apiFetch('POST /api/auth/google', {
      fetch,
      baseUrl,
      json: { access_token: 'google-token' },
    });
    assert.equal(login.user.email, user.email);

    const logout = await apiFetch('POST /api/auth/logout', { fetch, baseUrl });
    assert.equal(logout.success, true);
  });

  it('round-trips user routes through the shared client contract', async () => {
    const fakeUserDAO = {
      findById: async () => user,
      updateSettings: async (_id: number, settings: { name?: string }) => {
        if (settings.name !== undefined) {
          user.name = settings.name;
        }
      },
    };
    const fakeAuthService = {
      verifyJWT: async () => ({ userId: user.id }),
    };
    const app = routeApp(userRoutes, new Map<unknown, unknown>([
      [AuthService, fakeAuthService],
      [UserDAO, fakeUserDAO],
    ]));
    const fetch = bindFetch(app);
    const authHeaders = { Authorization: 'Bearer test-token' };

    const profile = await apiFetch('GET /api/user/profile', {
      fetch,
      baseUrl,
      headers: authHeaders,
    });
    assert.equal(profile.id, user.id);

    const updatedProfile = await apiFetch('PATCH /api/user/profile', {
      fetch,
      baseUrl,
      headers: authHeaders,
      json: { name: 'Updated Artist' },
    });
    assert.equal(updatedProfile.user.name, 'Updated Artist');

    const settings = await apiFetch('PUT /api/user/settings', {
      fetch,
      baseUrl,
      headers: authHeaders,
      json: { name: 'Settings Artist' },
    });
    assert.equal(settings.user.name, 'Settings Artist');
  });

  it('round-trips space routes through the shared client contract', async () => {
    const createdSpaces = [space];
    const fakeSpaceDAO = {
      createSpace: async (data: typeof space) => {
        createdSpaces.unshift(data);
        return data;
      },
      getSpacesForUser: async () => createdSpaces.map((item) => ({
        ...item,
        role: 'owner',
      })),
      getSpaceById: async (id: string) => createdSpaces.find((item) => item.id === id) ?? null,
      deleteSpace: async (id: string) => {
        const index = createdSpaces.findIndex((item) => item.id === id);
        if (index === -1) {
          return false;
        }
        createdSpaces.splice(index, 1);
        return true;
      },
    };
    const fakeMemberDAO = {
      addMember: async () => ({ space_id: 'space-new', user_id: String(user.id), role: 'owner', joined_at: Date.now() }),
      getMember: async () => ({ space_id: space.id, user_id: String(user.id), role: 'owner', joined_at: Date.now() }),
    };
    const fakeAuthService = {
      verifyJWT: async () => ({ userId: user.id }),
    };
    const app = routeApp(spaceRoutes, new Map<unknown, unknown>([
      [AuthService, fakeAuthService],
      [SpaceDAO, fakeSpaceDAO],
      [MemberDAO, fakeMemberDAO],
    ]));
    const fetch = bindFetch(app);
    const authHeaders = { Authorization: 'Bearer test-token' };

    const created = await apiFetch('POST /api/spaces', {
      fetch,
      baseUrl,
      headers: authHeaders,
      json: { name: 'New Space' },
    });
    assert.equal(created.space.role, 'owner');

    const listed = await apiFetch('GET /api/spaces', {
      fetch,
      baseUrl,
      headers: authHeaders,
    });
    assert.equal(listed.spaces[0].name, 'New Space');

    const fetched = await apiFetch('GET /api/spaces/:id', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id },
    });
    assert.equal(fetched.space.id, space.id);

    const assets = await apiFetch('GET /api/spaces/:id/assets', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id },
    });
    assert.equal(assets.assets[0].id, asset.id);

    const deleted = await apiFetch('DELETE /api/spaces/:id', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { id: space.id },
    });
    assert.equal(deleted.message, 'Space deleted successfully');
  });
});
