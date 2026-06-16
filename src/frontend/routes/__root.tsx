import { useEffect, useState, type ReactNode } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { Outlet, createRootRoute } from '@tanstack/react-router';
import { AuthProvider } from '../contexts/AuthContext';
import { loadSession } from '../config';
import type { User } from '../contexts/AuthContext';
import { useStartSession, type StartSession } from '../startSession';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <StartProviders>
      <Outlet />
    </StartProviders>
  );
}

function StartProviders({ children }: { children: ReactNode }) {
  const providedSession = useStartSession();
  const [session, setSession] = useState<StartSession | undefined>(providedSession);

  useEffect(() => {
    if (session) {
      return;
    }
    loadSession().then((session) => {
      if (!session.config.googleClientId) {
        console.error('Google Client ID not provided by backend');
      }
      setSession(session);
    });
  }, [session]);

  if (!session) {
    return null;
  }

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
