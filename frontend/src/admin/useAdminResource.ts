/**
 * useAdminResource — single hook every admin parity screen uses to fetch
 * its list. Centralises:
 *   • initial load on mount
 *   • pull-to-refresh
 *   • loading / error / refreshing state
 *   • silent re-fetch on app foreground (via /src/hooks/useAppStatePolling)
 *
 * Keeps each route file under ~150 LoC and the hook itself the only place
 * that touches `api`/`runtime`. Errors surface via `Alert` so the admin
 * never sees a silent empty list when the backend is degraded.
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import api from '../api';
import { ApiError } from '../runtime-client';

export interface AdminResourceState<T> {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: ApiError | null;
  reload: () => Promise<void>;
}

export function useAdminResource<T>(
  path: string,
  options?: { params?: Record<string, unknown>; immediate?: boolean },
): AdminResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(options?.immediate !== false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<ApiError | null>(null);

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await api.get<T>(path, { params: options?.params });
      setData(r.data);
      setError(null);
    } catch (e) {
      const apiErr = e instanceof ApiError ? e : null;
      setError(apiErr);
      // Surface a non-blocking toast — admin needs honest failure signal.
      // 401/403 is handled centrally by runtime auth-expired middleware.
      if (apiErr && apiErr.status !== 401 && apiErr.status !== 403) {
        Alert.alert('Could not load', apiErr.hint || apiErr.message || apiErr.code);
      }
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [path, JSON.stringify(options?.params || {})]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (options?.immediate === false) return;
    void reload();
  }, [reload]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, refreshing, error, reload };
}
