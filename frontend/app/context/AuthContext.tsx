'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import axios from 'axios';

import api from '../../lib/api';

export type Role = 'student' | 'parent' | 'coach' | 'admin' | 'superadmin';

export interface AuthUser {
  _id: string;
  role: Role;
  firstName: string;
  lastName: string;
  email?: string;
  parentId?: string;
  skillLevel?: 'beginner' | 'intermediate' | 'advanced';
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    firstName: string,
    lastName: string,
    email: string,
    password: string
  ) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      try {
        const res = await api.get<{ user: AuthUser }>('/auth/me');

        if (isMounted) {
          setUser(res.data.user);
        }
      } catch (error) {
        // 401 is the expected "not logged in" case — no session to restore,
        // not an error worth surfacing. Anything else is unexpected.
        if (!axios.isAxiosError(error) || error.response?.status !== 401) {
          console.error('Failed to restore session:', error);
        }

        if (isMounted) {
          setUser(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    restoreSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ user: AuthUser }>('/auth/login', { email, password });
    setUser(res.data.user);
  }, []);

  const register = useCallback(
    async (firstName: string, lastName: string, email: string, password: string) => {
      const res = await api.post<{ user: AuthUser }>('/auth/register', {
        firstName,
        lastName,
        email,
        password,
      });
      setUser(res.data.user);
    },
    []
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}
