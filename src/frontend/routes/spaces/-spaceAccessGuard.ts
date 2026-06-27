import { notFound, redirect } from '@tanstack/react-router';
import { ApiFetchError } from '../../../api/client';
import type { StartRouterContext, StartServerContext } from '../../app-context';
import { ssrFetchArgs, type StartSession } from '../../app-context';
import {
  getCachedSession,
  SpaceAccessRequiredError,
  spaceAccessQueryOptions,
} from '../../queries';
import { prepareSpaceSession } from '../../space/spaceSessionRuntime';

interface SpaceAccessGuardOptions {
  context: StartRouterContext & { session?: StartSession };
  params: { id: string };
  location: { href: string };
  serverContext?: StartServerContext;
}

export async function requireSpaceRouteAccess(opts: SpaceAccessGuardOptions) {
  const { context, location, params } = opts;
  if (!getCachedSession(context.queryClient, context.session)?.user) {
    throw redirect({
      to: '/login',
      search: { redirect: location.href },
    });
  }

  const { baseUrl, headers, fetchImpl } = ssrFetchArgs(opts);
  let access;
  try {
    access = await context.queryClient.ensureQueryData(
      spaceAccessQueryOptions(params.id, baseUrl, headers, fetchImpl),
    );
  } catch (error) {
    if (error instanceof ApiFetchError && error.status === 404) {
      throw notFound();
    }
    throw error;
  }

  if (access.access.status !== 'member') {
    throw new SpaceAccessRequiredError(params.id, access.access);
  }

  prepareSpaceSession(params.id);
}
