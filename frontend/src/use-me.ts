import { useCallback, useEffect, useState } from 'react';
import api from './api';
import { useAuth } from './auth';

/**
 * L0: useMe — reads GET /api/me and exposes { states, active_context, ... }.
 *
 * This is separate from useAuth.user intentionally: /api/me is the canonical
 * state source (driven by actions), whereas useAuth.user mirrors the login
 * payload (driven by identity). Components that decide *what to show* read
 * from useMe; components that need token/identity read from useAuth.
 */
export type MeDoc = {
  user_id?: string;
  email?: string;
  name?: string;
  role?: string;
  states: string[];
  active_context: string | null;
  last_project_id?: string | null;
  last_project_title?: string | null;
  building_count?: number;
  total_earned?: number;
  generated_at?: string;
};

export function useMe() {
  const { token, user } = useAuth();
  const [me, setMe] = useState<MeDoc | null>(null);
  const [loading, setLoading] = useState<boolean>(!!token);

  const refresh = useCallback(async () => {
    if (!token) { setMe(null); setLoading(false); return; }
    try {
      const r = await api.get('/me');
      setMe(r.data as MeDoc);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { refresh(); }, [refresh, user?.user_id]);

  return { me, loading, refresh };
}
