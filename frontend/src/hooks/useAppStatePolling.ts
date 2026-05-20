/**
 * useAppStatePolling — focus-aware, AppState-aware polling primitive.
 *
 * Solves audit Probes 1 (suspend/resume) + 4 (orphan polling on navigation):
 *
 *  - Pauses the interval when the screen is unfocused (expo-router native
 *    stack keeps screens mounted — without this hook, polls would keep
 *    firing for every screen the user navigated through this session).
 *  - Pauses the interval when the app is backgrounded.
 *  - Fires one immediate refresh when the app returns to foreground OR
 *    the screen regains focus, so the user sees fresh data on resume
 *    without waiting a full interval tick.
 *  - Uses a callback ref so the polled function is always the latest
 *    closure (no stale-state bugs).
 *
 * Intentionally does NOT trigger an initial fetch on mount — keep the
 * caller's existing `useEffect(() => { load(); }, [load])` so the boot
 * fetch stays explicit (parents often have other initial wiring like
 * setLoading(true), error reset, etc.).
 *
 * Usage:
 *
 *   const load = useCallback(async () => { ... }, [deps]);
 *   useEffect(() => { load(); }, [load]);
 *   useAppStatePolling(load, 8000);
 *
 *   // On-demand polling (e.g., wait for WayForPay payment):
 *   useAppStatePolling(checkPayment, 4000, { enabled: !!invoiceUrl });
 *
 *   // No background pause (rare; e.g., transactional state machines):
 *   useAppStatePolling(tick, 1000, { pauseInBackground: false });
 */
import { useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useFocusEffect } from 'expo-router';

export interface AppStatePollingOptions {
  /** When false, no interval is created. Default: true. */
  enabled?: boolean;
  /** Pause interval when app is backgrounded. Default: true. */
  pauseInBackground?: boolean;
  /** Fire callback immediately when app returns to foreground. Default: true. */
  refreshOnResume?: boolean;
  /** Fire callback immediately when screen regains focus. Default: false. */
  refreshOnFocus?: boolean;
}

export function useAppStatePolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  options: AppStatePollingOptions = {},
): void {
  const {
    enabled = true,
    pauseInBackground = true,
    refreshOnResume = true,
    refreshOnFocus = false,
  } = options;

  // Always invoke the latest callback closure.
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useFocusEffect(
    useCallback(() => {
      if (!enabled || intervalMs <= 0) return undefined;

      let appState: AppStateStatus = AppState.currentState;
      const cleanups: Array<() => void> = [];

      if (refreshOnFocus) {
        // Defer one tick so React commits before fetching.
        const id = setTimeout(() => { callbackRef.current(); }, 0);
        cleanups.push(() => clearTimeout(id));
      }

      const interval = setInterval(() => {
        if (pauseInBackground && appState !== 'active') return;
        callbackRef.current();
      }, intervalMs);
      cleanups.push(() => clearInterval(interval));

      const sub = AppState.addEventListener('change', (next) => {
        const prev = appState;
        appState = next;
        if (refreshOnResume && prev !== 'active' && next === 'active') {
          callbackRef.current();
        }
      });
      cleanups.push(() => sub.remove());

      return () => {
        for (const fn of cleanups) {
          try { fn(); } catch { /* ignore */ }
        }
      };
    }, [enabled, intervalMs, pauseInBackground, refreshOnResume, refreshOnFocus]),
  );
}
