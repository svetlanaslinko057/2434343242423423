/**
 * Phase 2.D — referral capture & bind, mobile side.
 *
 * Single rule: backend is the source of truth. We just shuttle the code
 * from URL → AsyncStorage → POST /api/referral/bind once a user is signed in.
 *
 * Edge cases this module handles (the "silent loss" cases the user
 * called out in Phase 2.D feedback):
 *   1. Visitor opens link, leaves, comes back hours later → still bound,
 *      as long as < 24h have passed since capture.
 *   2. Already-authed user opens a referral link → bound immediately,
 *      not lost.
 *   3. Double-bind on every app open → blocked by `bound:true` flag.
 *   4. Self-referral or invalid code → backend rejects, we just clear.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import api from './api';

const KEY = 'eva_referral_v1';
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

type RefRecord = {
  code: string;
  captured_at: number; // epoch ms
  bound: boolean;
};

async function read(): Promise<RefRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (typeof obj?.code !== 'string') return null;
    return obj as RefRecord;
  } catch { return null; }
}

async function write(rec: RefRecord): Promise<void> {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(rec)); } catch { /* ignore */ }
}

async function clear(): Promise<void> {
  try { await AsyncStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Extract `?ref=XXX` from any URL string. */
function extractRef(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = Linking.parse(url);
    const v = (parsed.queryParams as any)?.ref;
    if (typeof v === 'string' && v.length > 0) return v;
    if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  } catch { /* fall through to regex */ }
  const m = String(url).match(/[?&]ref=([A-Za-z0-9_-]{4,32})/);
  return m ? m[1] : null;
}

/**
 * Capture phase. Runs on app boot. Reads the URL we were opened with
 * (deeplink OR current web URL) and, if it carries `?ref=XXX`, hits the
 * public capture endpoint and stashes the code locally with a 24h TTL.
 */
export async function captureFromUrl(): Promise<void> {
  let initial: string | null = null;
  try {
    initial = await Linking.getInitialURL();
  } catch { /* native fallback */ }

  // Web: also look at the current location (the user might be already
  // on the page when we run, not via a deeplink event).
  if (!initial && typeof window !== 'undefined' && window.location?.href) {
    initial = window.location.href;
  }

  const code = extractRef(initial);
  if (!code) return;

  // If we already have an active capture for the same code, don't double-fire.
  const existing = await read();
  if (existing && existing.code === code && Date.now() - existing.captured_at < TTL_MS) {
    return;
  }

  try {
    await api.post('/public/capture-referral', { ref: code });
  } catch { /* non-fatal — we still keep the code, bind will retry */ }

  await write({ code, captured_at: Date.now(), bound: false });
}

/**
 * Bind phase. Called whenever we know we have a signed-in user.
 * Idempotent: returns immediately if there's nothing to bind, the code
 * is older than 24h (stale → drop), or it's already been bound on this device.
 */
export async function bindIfNeeded(): Promise<{ bound: boolean; reason?: string }> {
  const rec = await read();
  if (!rec) return { bound: false, reason: 'no_code' };

  // Stale
  if (Date.now() - rec.captured_at > TTL_MS) {
    await clear();
    return { bound: false, reason: 'expired' };
  }

  // Already bound on this device — nothing to do.
  if (rec.bound) return { bound: true, reason: 'already_bound_local' };

  try {
    const r = await api.post('/referral/bind', { referral_code: rec.code });
    if (r.data?.ok) {
      await write({ ...rec, bound: true });
      return { bound: true };
    }
    // Backend said no (invalid / self / already bound on the account).
    // Mark it bound locally anyway so we don't retry on every app open.
    await write({ ...rec, bound: true });
    return { bound: false, reason: r.data?.reason || 'rejected' };
  } catch (e: any) {
    // 401 = not signed in yet — leave the record alone, we'll retry next time.
    const status = e?.response?.status;
    if (status === 401) return { bound: false, reason: 'not_authed' };
    // Other errors: keep retrying on next mount, don't mark bound.
    return { bound: false, reason: 'network' };
  }
}
