import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { isNotFound, isRedirect } from '@tanstack/react-router';
import { requireSpaceRouteAccess } from './-spaceAccessGuard';
import { SpaceAccessRequiredError } from '../../queries';
import type { StartSession } from '../../app-context';
import type { FetchLike } from '../../../api/client';

const signedInSession: StartSession = {
  config: { googleClientId: 'google-client', environment: 'test' },
  user: {
    id: 2,
    email: 'requester@example.com',
    name: 'Requester',
    google_id: 'google-2',
  },
};

const signedOutSession: StartSession = {
  config: signedInSession.config,
  user: null,
};

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function createBeforeLoadOpts(session: StartSession, fetchImpl: FetchLike) {
  return {
    context: {
      queryClient: createQueryClient(),
      session,
    },
    params: { id: 'space-1' },
    location: { href: '/spaces/space-1/assets/asset-1' },
    serverContext: {
      apiFetch: fetchImpl,
      requestMeta: {
        origin: 'https://makefx.test',
        pathname: '/spaces/space-1/assets/asset-1',
        search: '',
      },
    },
  };
}

async function runBeforeLoad(opts: ReturnType<typeof createBeforeLoadOpts>) {
  return requireSpaceRouteAccess(opts);
}

describe('/spaces/$id access guard', () => {
  test('redirects signed-out users back to the attempted nested Space URL', async () => {
    const opts = createBeforeLoadOpts(signedOutSession, async () => {
      throw new Error('access endpoint should not be called');
    });

    await assert.rejects(
      () => runBeforeLoad(opts),
      (error) => {
        assert.equal(isRedirect(error), true);
        assert.equal((error as { options: { to: string } }).options.to, '/login');
        assert.deepEqual(
          (error as { options: { search: { redirect: string } } }).options.search,
          { redirect: '/spaces/space-1/assets/asset-1' },
        );
        return true;
      },
    );
  });

  test('throws access-required before nested loaders can fetch private content', async () => {
    const opts = createBeforeLoadOpts(signedInSession, async () => new Response(JSON.stringify({
      success: true,
      access: {
        status: 'none',
        member: null,
        pendingRequest: null,
        pendingInvitation: null,
      },
    })));

    await assert.rejects(
      () => runBeforeLoad(opts),
      (error) => {
        assert.equal(error instanceof SpaceAccessRequiredError, true);
        assert.equal((error as SpaceAccessRequiredError).access.status, 'none');
        return true;
      },
    );
  });

  test('allows members through to existing Space routes', async () => {
    const opts = createBeforeLoadOpts(signedInSession, async () => new Response(JSON.stringify({
      success: true,
      access: {
        status: 'member',
        member: {
          user_id: '2',
          role: 'viewer',
          joined_at: 1,
          user: {
            id: '2',
            email: 'requester@example.com',
            name: 'Requester',
          },
        },
        pendingRequest: null,
        pendingInvitation: null,
      },
    })));

    await runBeforeLoad(opts);
  });

  test('maps deleted or nonexistent Spaces to not-found', async () => {
    const opts = createBeforeLoadOpts(signedInSession, async () => new Response(JSON.stringify({
      error: 'Space not found',
    }), { status: 404 }));

    await assert.rejects(
      () => runBeforeLoad(opts),
      (error) => {
        assert.equal(isNotFound(error), true);
        return true;
      },
    );
  });
});
