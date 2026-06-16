import { useState, useEffect, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useNavigate } from '../hooks/useNavigate';
import { AuthContext, type User } from './AuthContextProvider';
import { apiFetch } from '../../api/client';
import {
  clearUserScopedQueries,
  sessionQueryKey,
} from '../queries';
import type { StartSession } from '../startSession';

// Re-export types for backward compatibility
export type { User, AuthContextType } from './AuthContextProvider';

interface AuthProviderProps {
  children: ReactNode;
  initialUser?: User | null;
}

export function AuthProvider({ children, initialUser }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(initialUser || null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const router = useRouter();

  const applyUser = (nextUser: User | null) => {
    const previousUser = queryClient.getQueryData<StartSession>(sessionQueryKey)?.user ?? user;
    if (previousUser?.id !== nextUser?.id) {
      clearUserScopedQueries(queryClient);
    }
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
  };

  const fetchUser = async () => {
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
  };

  useEffect(() => {
    if (initialUser === undefined) {
      fetchUser();
    }
  }, [initialUser]);

  const login = (user: User) => {
    applyUser(user);
  };

  const logout = async () => {
    try {
      await apiFetch('POST /api/auth/logout');
      applyUser(null);
      navigate("/");
    } catch (error) {
      console.error("Error during logout:", error);
    }
  };

  const refreshUser = async () => {
    await fetchUser();
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}
