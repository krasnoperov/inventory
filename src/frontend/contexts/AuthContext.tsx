import { useCallback, useRef, useState, useEffect, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useNavigate } from '../hooks/useNavigate';
import { AuthContext, type User } from './AuthContextProvider';
import { apiFetch } from '../../api/client';
import {
  clearUserScopedQueries,
  sessionQueryKey,
} from '../queries';
import type { StartSession } from '../app-context';

// Re-export types for backward compatibility
export type { User, AuthContextType } from './AuthContextProvider';

interface AuthProviderProps {
  children: ReactNode;
  initialUser?: User | null;
}

export function AuthProvider({ children, initialUser }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(initialUser || null);
  const userRef = useRef<User | null>(initialUser || null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const router = useRouter();

  const applyUser = useCallback((nextUser: User | null) => {
    const previousUser = queryClient.getQueryData<StartSession>(sessionQueryKey)?.user ?? userRef.current;
    if (previousUser?.id !== nextUser?.id) {
      clearUserScopedQueries(queryClient);
    }
    userRef.current = nextUser;
    setUser(nextUser);

    queryClient.setQueryData<StartSession>(sessionQueryKey, (current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        user: nextUser,
      };
    });

    void router.invalidate();
  }, [queryClient, router]);

  const fetchUser = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch('GET /api/auth/session');
      applyUser(data.user);
    } catch (error) {
      console.error("Error fetching user:", error);
      applyUser(null);
    } finally {
      setLoading(false);
    }
  }, [applyUser]);

  useEffect(() => {
    if (initialUser === undefined) {
      fetchUser();
    }
  }, [fetchUser, initialUser]);

  const login = useCallback((user: User) => {
    applyUser(user);
  }, [applyUser]);

  const logout = useCallback(async () => {
    try {
      await apiFetch('POST /api/auth/logout');
      applyUser(null);
      navigate("/");
    } catch (error) {
      console.error("Error during logout:", error);
    }
  }, [applyUser, navigate]);

  const refreshUser = useCallback(async () => {
    await fetchUser();
  }, [fetchUser]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}
