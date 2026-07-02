import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import {
  clearUserScopedQueries,
  sessionQueryKey,
  sessionQueryOptions,
  spacesQueryKey,
  userProfileQueryKey,
} from './queries';
import type { StartSession } from './app-context';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalFetch = globalThis.fetch;

function restoreWindow() {
  if (originalWindow) {
    Object.defineProperty(globalThis, 'window', originalWindow);
    return;
  }
  delete (globalThis as { window?: Window }).window;
}

afterEach(() => {
  restoreWindow();
  globalThis.fetch = originalFetch;
});

describe('sessionQueryOptions', () => {
  test('uses injected session data only outside the browser', async () => {
    restoreWindow();
    const initialSession: StartSession = {
      config: { googleClientId: 'google-client', environment: 'test' },
      user: null,
    };
    globalThis.fetch = async () => {
      throw new Error('session fetch should not run during SSR');
    };

    const queryClient = new QueryClient();
    const session = await queryClient.fetchQuery(sessionQueryOptions(initialSession));

    assert.deepEqual(session, initialSession);
  });

  test('refetches session in the browser instead of replaying injected null user', async () => {
    Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
    const initialSession: StartSession = {
      config: { googleClientId: 'google-client', environment: 'test' },
      user: null,
    };
    const fetchedSession: StartSession = {
      config: { googleClientId: 'google-client', environment: 'test' },
      user: {
        id: 2,
        email: 'user@example.com',
        name: 'User B',
        google_id: 'google-2',
      },
    };
    let fetchCount = 0;
    globalThis.fetch = async (input) => {
      fetchCount += 1;
      assert.equal(input, '/api/auth/session');
      return new Response(JSON.stringify(fetchedSession), {
        headers: { 'content-type': 'application/json' },
      });
    };

    const queryClient = new QueryClient();
    const session = await queryClient.fetchQuery(sessionQueryOptions(initialSession));

    assert.equal(fetchCount, 1);
    assert.deepEqual(session, fetchedSession);
  });
});

describe('clearUserScopedQueries', () => {
  test('removes spaces and profile data without dropping session config', () => {
    const queryClient = new QueryClient();
    const session: StartSession = {
      config: { googleClientId: 'google-client', environment: 'test' },
      user: {
        id: 1,
        email: 'a@example.com',
        name: 'User A',
        google_id: 'google-1',
      },
    };

    queryClient.setQueryData(sessionQueryKey, session);
    queryClient.setQueryData(spacesQueryKey, [{ id: 'space-a' }]);
    queryClient.setQueryData(['spaces', 'space-a', 'page'], { space: { id: 'space-a' } });
    queryClient.setQueryData(userProfileQueryKey, { id: 1, email: 'a@example.com', name: 'User A' });

    clearUserScopedQueries(queryClient);

    assert.deepEqual(queryClient.getQueryData(sessionQueryKey), session);
    assert.equal(queryClient.getQueryData(spacesQueryKey), undefined);
    assert.equal(queryClient.getQueryData(['spaces', 'space-a', 'page']), undefined);
    assert.equal(queryClient.getQueryData(userProfileQueryKey), undefined);
  });
});
