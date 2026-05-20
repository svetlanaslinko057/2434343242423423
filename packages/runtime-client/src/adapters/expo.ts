/**
 * Expo platform adapter — Bearer token from AsyncStorage, with hooks for
 * auth-expired handling and explicit token priming.
 *
 * Token storage key matches the existing app convention (`atlas_token`).
 * Persistent layer for capability cache also uses AsyncStorage.
 *
 * IMPORTANT: this module imports `@react-native-async-storage/async-storage`
 * lazily so that core/ stays platform-agnostic. The lazy require is wrapped
 * in try/catch so unit tests on Node can run without RN deps installed.
 *
 * Lifecycle invariants (2026-05-13 audit P0 #2):
 *   - `ensureTokenReady()` MUST complete before the first request leaves
 *     so cold-start race doesn't produce unauthenticated requests.
 *   - `primeToken()` MUST be called by the auth layer after every
 *     login/logout/setItem('atlas_token', ...) so the cached value tracks
 *     the storage value. Otherwise the cached token diverges from storage.
 */
import type { PlatformAdapter, RequestConfig } from '../core/types';

type AsyncStorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

function loadAsyncStorage(): AsyncStorageLike | null {
  try {
    // Lazy require — only resolved on RN runtime.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-async-storage/async-storage');
    return (mod && (mod.default || mod)) as AsyncStorageLike;
  } catch {
    return null;
  }
}

const TOKEN_KEY = 'atlas_token';

export interface ExpoAdapterOptions {
  /** Override the storage key for the bearer token. Default: 'atlas_token'. */
  tokenKey?: string;
  /** Hook called on 401/session_expired. Return true to retry once. */
  onAuthExpired?: () => Promise<boolean>;
}

export function createExpoAdapter(opts: ExpoAdapterOptions = {}): PlatformAdapter {
  const storage = loadAsyncStorage();
  const tokenKey = opts.tokenKey || TOKEN_KEY;

  let cachedToken: string | null = null;
  let primePromise: Promise<void> | null = null;

  const readToken = async (): Promise<string | null> => {
    if (!storage) return null;
    try { return await storage.getItem(tokenKey); } catch { return null; }
  };

  // Single-flight initial prime. Re-entry returns the same promise.
  const startInitialPrime = (): Promise<void> => {
    if (primePromise) return primePromise;
    primePromise = readToken().then((t) => { cachedToken = t; });
    return primePromise;
  };
  // Kick off so warm-launch (token already in storage) is ready before first
  // request reaches the chain.
  void startInitialPrime();

  return {
    async getItem(key) {
      if (!storage) return null;
      try { return await storage.getItem(key); } catch { return null; }
    },
    async setItem(key, value) {
      if (!storage) return;
      try { await storage.setItem(key, value); } catch { /* ignore */ }
    },
    async removeItem(key) {
      if (!storage) return;
      try { await storage.removeItem(key); } catch { /* ignore */ }
    },
    decorateInit(init: RequestInit, _config: RequestConfig): RequestInit {
      const headers = { ...(init.headers as Record<string, string> | undefined) };
      if (cachedToken) headers['authorization'] = `Bearer ${cachedToken}`;
      return { ...init, headers };
    },
    /**
     * Force re-read token from storage and update the cached value. Called by
     * the auth layer after login/logout. Idempotent and safe to call from
     * concurrent code paths.
     */
    async primeToken() {
      cachedToken = await readToken();
      // Once explicitly primed, the initial-prime promise is considered done.
      if (!primePromise) primePromise = Promise.resolve();
    },
    /**
     * Awaited by the preflight middleware on every request. Resolves once
     * the initial token load has completed, guaranteeing the very first
     * request after cold-start carries the Authorization header (if a token
     * existed in storage).
     */
    async ensureTokenReady() {
      await startInitialPrime();
    },
    onAuthExpired: opts.onAuthExpired
      ? async () => {
          const retry = await opts.onAuthExpired!();
          // Re-prime token after caller refreshed it.
          cachedToken = await readToken();
          return retry;
        }
      : async () => {
          // Default: clear token, do not retry.
          if (storage) {
            try { await storage.removeItem(tokenKey); } catch { /* ignore */ }
          }
          cachedToken = null;
          return false;
        },
  };
}
