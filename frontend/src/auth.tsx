import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';
import { runtime } from './runtime';
import { syncPushTokenWithServer } from './push';

type User = {
  user_id: string;
  email: string;
  name: string;
  roles: string[];
  active_role: string;
  tier: string;
  strikes: number;
  capacity: number;
  active_modules: number;
};

type AuthCtx = {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, roles: string[]) => Promise<void>;
  verifyCode: (email: string, code: string, name?: string) => Promise<void>;
  demoLogin: () => Promise<string>;  // returns project_id for redirect
  googleLogin: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
  switchRole: (role: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthCtx>({} as AuthCtx);

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSession = useCallback(async () => {
    try {
      const t = await AsyncStorage.getItem('atlas_token');
      if (t) {
        const res = await api.get('/mobile/auth/me', { headers: { Authorization: `Bearer ${t}` } });
        setToken(t);
        setUser(res.data.user);
      }
    } catch {
      await AsyncStorage.removeItem('atlas_token');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSession(); }, [loadSession]);

  /**
   * Persist token + re-prime runtime cache. Always call this instead of
   * raw AsyncStorage.setItem so the runtime-client's cached token tracks
   * storage. Fixes audit P0 #2 (cold-start / post-login token race).
   */
  const persistToken = async (t: string) => {
    await AsyncStorage.setItem('atlas_token', t);
    await runtime.primeToken();
  };
  const clearToken = async () => {
    await AsyncStorage.removeItem('atlas_token');
    await runtime.primeToken();
  };

  const login = async (email: string, password: string) => {
    const res = await api.post('/mobile/auth/login', { email, password });
    // 2FA gate: backend returns { requires_2fa: true, challenge_token } when
    // a second factor is required. We surface the challenge to the caller so
    // they can route to the 2FA challenge screen — no session is persisted
    // until the user verifies their second factor.
    if (res.data?.requires_2fa) {
      const e: any = new Error('TwoFactorRequired');
      e.requires_2fa = true;
      e.challenge_token = res.data.challenge_token;
      e.method = res.data.method || 'totp';
      throw e;
    }
    await persistToken(res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
    // Fire-and-forget: register Expo push token so backend pushes land
    // on this device. Silent on web / simulator / permission-denied.
    syncPushTokenWithServer().catch(() => {});
  };

  const register = async (email: string, password: string, name: string, roles: string[]) => {
    const res = await api.post('/mobile/auth/register', { email, password, name, roles });
    await persistToken(res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
    syncPushTokenWithServer().catch(() => {});
  };

  const verifyCode = async (email: string, code: string, name?: string) => {
    const res = await api.post('/auth/verify-code', { email, code, name });
    await persistToken(res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
    syncPushTokenWithServer().catch(() => {});
  };

  const demoLogin = async (): Promise<string> => {
    const res = await api.post('/mobile/auth/demo', { role: 'client' });
    await persistToken(res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
    syncPushTokenWithServer().catch(() => {});
    return res.data.project_id as string;
  };

  // Real Google Sign-In. `idToken` is the JWT Google handed us in the
  // `expo-auth-session` callback (`authentication.idToken` on web OR
  // `id_token` in the URL fragment on native). Backend verifies signature
  // + aud, then issues the same bearer token the rest of the app uses.
  const googleLogin = async (idToken: string) => {
    const res = await api.post('/mobile/auth/google', { credential: idToken });
    await persistToken(res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
    syncPushTokenWithServer().catch(() => {});
  };

  const logout = async () => {
    try { await api.post('/mobile/auth/logout'); } catch {}
    await clearToken();
    setToken(null);
    setUser(null);
  };

  const switchRole = async (role: string) => {
    const res = await api.post('/mobile/auth/switch-role', { role });
    setUser(res.data.user);
  };

  const refresh = async () => { await loadSession(); };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, verifyCode, demoLogin, googleLogin, logout, switchRole, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}
