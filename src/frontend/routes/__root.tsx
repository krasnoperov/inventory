import type { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import { AuthProvider } from '../contexts/AuthContext';
import type { User } from '../contexts/AuthContext';
import type { StartSession } from '../startSession';
import type { FetchLike } from '../../api/client';
import { sessionQueryOptions } from '../queries';

interface RouterContext {
  queryClient: QueryClient;
  initialSession?: StartSession;
  apiBaseUrl?: string;
  apiHeaders?: HeadersInit;
  // Server-only fetch used during SSR so route loaders dispatch to the worker
  // in-process instead of issuing a (failing) self-origin subrequest.
  serverFetch?: FetchLike;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(
      sessionQueryOptions(context.initialSession),
    );
    return { session };
  },
  component: RootComponent,
});

function RootComponent() {
  const { session } = Route.useRouteContext();

  return (
    <StartProviders session={session}>
      <Outlet />
    </StartProviders>
  );
}

function StartProviders({ children, session }: { children: ReactNode; session: StartSession }) {
  const clientId = session.config.googleClientId;
  const initialUser: User | null = session.user;

  if (!clientId) {
    return (
      <AuthProvider initialUser={initialUser}>
        <div style={{ color: 'white', textAlign: 'center', padding: '2rem' }}>
          Google OAuth not configured. Please contact administrator.
        </div>
      </AuthProvider>
    );
  }

  return (
    <GoogleOAuthProvider clientId={clientId}>
      <AuthProvider initialUser={initialUser}>
        {children}
      </AuthProvider>
    </GoogleOAuthProvider>
  );
}
