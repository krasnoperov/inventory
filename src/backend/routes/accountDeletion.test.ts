import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenApiRouter } from './openapi';
import { userRoutes } from './user';
import { AuthService } from '../features/auth/auth-service';
import { UserDAO } from '../../dao/user-dao';
import { AccountDeletionService } from '../services/accountDeletionService';
import { apiFetch } from '../../shared/api/client';
import type { AppContext } from './types';

const baseUrl = 'https://inventory.test';
const cookieHeaders = {
  Cookie: 'auth_token=test-token',
  'content-type': 'application/json',
};

function routeApp(options: {
  user?: { id: number; email: string; name: string };
  deleteAccount?: (userId: number) => Promise<unknown>;
}) {
  const app = createOpenApiRouter();
  app.use('*', async (c, next) => {
    c.env = { ENVIRONMENT: 'test' } as unknown as AppContext['Bindings'];
    c.set('container', {
      get: (token: unknown) => {
        if (token === AuthService) {
          return { verifyJWT: async () => ({ userId: options.user?.id ?? 7 }) };
        }
        if (token === UserDAO) {
          return {
            findById: async () => options.user ?? {
              id: 7,
              email: 'delete@example.com',
              name: 'Delete Me',
              google_id: null,
            },
          };
        }
        if (token === AccountDeletionService) {
          return {
            deleteAccount: options.deleteAccount ?? (async () => ({
              deleted: true,
              ownedSpacesPurged: 0,
              sharedMembershipsDeleted: 0,
              r2ObjectsDeleted: 0,
              d1RowsChanged: 1,
            })),
          };
        }
        throw new Error('Missing fake dependency');
      },
    } as never);
    await next();
  });
  app.route('/', userRoutes);
  return app;
}

function bindFetch(app: ReturnType<typeof routeApp>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    return app.request(url, init);
  }) as typeof fetch;
}

describe('DELETE /api/user/account', () => {
  test('requires an interactive cookie session instead of bearer-only auth', async () => {
    let called = false;
    const appResponse = await bindFetch(routeApp({
      deleteAccount: async () => {
        called = true;
        return { deleted: true, ownedSpacesPurged: 0, sharedMembershipsDeleted: 0, r2ObjectsDeleted: 0, d1RowsChanged: 1 };
      },
    }))(`${baseUrl}/api/user/account`, {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email: 'delete@example.com', confirmation: 'DELETE MY ACCOUNT' }),
    });

    assert.equal(appResponse.status, 401);
    assert.equal(called, false);
  });

  test('rejects mismatched typed confirmation before deleting', async () => {
    let called = false;
    const response = await bindFetch(routeApp({
      deleteAccount: async () => {
        called = true;
        return { deleted: true, ownedSpacesPurged: 0, sharedMembershipsDeleted: 0, r2ObjectsDeleted: 0, d1RowsChanged: 1 };
      },
    }))(`${baseUrl}/api/user/account`, {
      method: 'DELETE',
      headers: cookieHeaders,
      body: JSON.stringify({ email: 'other@example.com', confirmation: 'DELETE MY ACCOUNT' }),
    });

    assert.equal(response.status, 400);
    assert.equal(called, false);
  });

  test('deletes the account and clears the auth cookie when both gates match', async () => {
    let deletedUserId: number | null = null;
    const responses: Response[] = [];
    const data = await apiFetch('DELETE /api/user/account', {
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await bindFetch(routeApp({
          deleteAccount: async (userId) => {
            deletedUserId = userId;
            return {
              deleted: true,
              ownedSpacesPurged: 2,
              sharedMembershipsDeleted: 1,
              r2ObjectsDeleted: 4,
              d1RowsChanged: 9,
            };
          },
        }))(input, init);
        responses.push(response);
        return response;
      }) as typeof fetch,
      baseUrl,
      headers: { Cookie: 'auth_token=test-token' },
      json: { email: 'delete@example.com', confirmation: 'DELETE MY ACCOUNT' },
    });

    assert.equal(deletedUserId, 7);
    assert.equal(data.success, true);
    assert.equal(data.ownedSpacesPurged, 2);
    assert.match(responses[0]?.headers.get('set-cookie') ?? '', /auth_token=; Max-Age=0/);
  });
});
