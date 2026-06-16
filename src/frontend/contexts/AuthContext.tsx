import { useState, useEffect, ReactNode } from 'react';
import { useNavigate } from '../hooks/useNavigate';
import { AuthContext, type User } from './AuthContextProvider';
import { apiFetch } from '../../api/client';

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

  const fetchUser = async () => {
    setLoading(true);
    try {
      const data = await apiFetch('GET /api/auth/session');
      setUser(data.user);
    } catch (error) {
      console.error("Error fetching user:", error);
      setUser(null);
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
    setUser(user);
  };

  const logout = async () => {
    try {
      await apiFetch('POST /api/auth/logout');
      setUser(null);
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
