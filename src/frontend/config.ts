import type { User } from './contexts/AuthContextProvider';
import type { StartSession } from './app-context';
import { apiFetch } from '../api/client';

interface Session extends StartSession {
  user: User | null;
}

export async function loadSession(): Promise<Session> {
  try {
    const data = await apiFetch('GET /api/auth/session');
    return {
      config: data.config,
      user: data.user,
    };
  } catch (error) {
    console.error('Error loading session (backend might not be running):', error);
    // Return dummy data for development when backend is not running
    return {
      config: { googleClientId: 'dummy-client-id-for-dev', features: { rotation: false } },
      user: null,
    };
  }
}
