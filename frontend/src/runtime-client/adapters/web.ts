/**
 * Web platform adapter — uses cookies (`credentials: 'include'`) for auth
 * and `localStorage` for the persistent layer of capability cache.
 *
 * Web NEVER attaches a Bearer token from a header — backend's session is
 * cookie-based via `auth_session_token` HttpOnly cookie. UI only ensures
 * `credentials: 'include'` so the browser sends the cookie cross-origin.
 */
import type { PlatformAdapter, RequestConfig } from '../core/types';

export function createWebAdapter(): PlatformAdapter {
  return {
    async getItem(key) {
      try {
        return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
      } catch { return null; }
    },
    async setItem(key, value) {
      try {
        if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
      } catch { /* quota exceeded — ignore */ }
    },
    async removeItem(key) {
      try {
        if (typeof window !== 'undefined') window.localStorage.removeItem(key);
      } catch { /* ignore */ }
    },
    decorateInit(init: RequestInit, _config: RequestConfig): RequestInit {
      // Ensure the browser sends cookies even cross-origin.
      return { ...init, credentials: 'include' };
    },
  };
}
