/**
 * Expo runtime-client singleton.
 *
 * Same shape as web/src/runtime — but with the Expo adapter (Bearer token
 * via AsyncStorage, no cookies).
 *
 * Usage in any /app screen:
 *
 *   import { runtime } from '../../src/runtime';
 *   const { data } = await runtime.get('/api/developer/wallet');
 */
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createExpoRuntimeClient } from '../runtime-client';
import type { TelemetryEvent } from '../runtime-client';

// Resolve backend URL — same logic the existing api.ts uses.
const RAW_BACKEND =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  (Constants.expoConfig?.extra as { backendUrl?: string } | undefined)?.backendUrl ||
  '';

// ─── Telemetry sink ──────────────────────────────────────────────────────────
// We surface ALL completed/failed requests + capability blocks + retries so
// consumers (DevTools panel, future logger) can subscribe.
type Listener = (ev: TelemetryEvent) => void;
const telemetryListeners: Set<Listener> = new Set();

export function onTelemetry(listener: Listener): () => void {
  telemetryListeners.add(listener);
  return () => { telemetryListeners.delete(listener); };
}

function emit(ev: TelemetryEvent): void {
  // Always log compat-route hits + failures; everything else is verbose-only.
  if (ev.type === 'compat_route_hit') {
    // eslint-disable-next-line no-console
    console.warn('[runtime] compat_route_hit', ev);
  } else if (ev.type === 'request_failed') {
    // eslint-disable-next-line no-console
    console.warn('[runtime] request_failed', ev);
  } else if (ev.type === 'capability_gate_blocked') {
    // eslint-disable-next-line no-console
    console.warn('[runtime] capability_gate_blocked', ev);
  }
  for (const l of telemetryListeners) {
    try { l(ev); } catch { /* listener errors are isolated */ }
  }
}

// ─── Auth-expired hook ──────────────────────────────────────────────────────
// Clears the bearer token. UI listens via `onAuthExpired()` and routes the
// user back to /auth. Returning `false` means: do NOT auto-retry the failed
// request — the user has to log in first.
type AuthListener = () => void;
const authListeners: Set<AuthListener> = new Set();

export function onAuthExpired(listener: AuthListener): () => void {
  authListeners.add(listener);
  return () => { authListeners.delete(listener); };
}

async function handleAuthExpired(): Promise<boolean> {
  try { await AsyncStorage.removeItem('atlas_token'); } catch { /* ignore */ }
  for (const l of authListeners) {
    try { l(); } catch { /* ignore */ }
  }
  return false;
}

export const runtime = createExpoRuntimeClient(
  {
    baseURL: RAW_BACKEND.replace(/\/+$/, ''),
    defaultTimeoutMs: 20_000,
    defaultRetries: 2,
    onTelemetry: emit,
  },
  {
    tokenKey: 'atlas_token', // matches existing app convention
    onAuthExpired: handleAuthExpired,
  },
);
