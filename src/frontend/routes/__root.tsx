import { useEffect, useState, type ReactNode } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { Outlet, createRootRoute } from '@tanstack/react-router';
import { AuthProvider } from '../contexts/AuthContext';
import { loadSession } from '../config';
import type { User } from '../contexts/AuthContext';

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
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [clientId, setClientId] = useState('');
  const [initialUser, setInitialUser] = useState<User | null>(null);

  useEffect(() => {
    loadSession().then((session) => {
      setClientId(session.config.googleClientId);
      setInitialUser(session.user);
      setSessionLoaded(true);
      if (!session.config.googleClientId) {
        console.error('Google Client ID not provided by backend');
      }
    });
  }, []);

  if (!sessionLoaded) {
    return null;
  }

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
