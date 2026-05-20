/**
 * Validator capability context — shared state for the Human Validation Layer.
 *
 * Architecture (v2, May 18 2026):
 *   "Validator" is NOT a role. It's an opt-in capability flag on the client
 *   account (users.features.validation_enabled). The flag lives on the
 *   backend and we mirror it in this lightweight context so navigation and
 *   nav-tab visibility can react instantly when the user opts in / opts out.
 *
 * Surface:
 *   const { enabled, refresh, setEnabled } = useValidator()
 *
 *   - `enabled` is `null` until the first /api/validator/status round-trip
 *     resolves (so layouts can decide "not yet" vs "no"). After that it's a
 *     strict boolean.
 *   - `refresh()` re-fetches status; use it after opt-in / opt-out actions
 *     to update navigation instantly.
 *   - `setEnabled(true|false)` is an optimistic local update — useful for
 *     pre-fading the UI before the round-trip lands.
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './auth';
import { runtime } from './runtime';

type ValidatorCtx = {
  enabled: boolean | null;
  refresh: () => Promise<void>;
  setEnabled: (v: boolean) => void;
};

const Ctx = createContext<ValidatorCtx>({
  enabled: null,
  refresh: async () => {},
  setEnabled: () => {},
});

export const useValidator = () => useContext(Ctx);

export function ValidatorProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [enabled, setEnabledState] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    if (!user) { setEnabledState(false); return; }
    try {
      const r = await runtime.get<{ enabled: boolean }>('/api/validator/status');
      setEnabledState(!!r.data?.enabled);
    } catch {
      // Don't flip to "enabled" on errors — keep last known value or false.
      setEnabledState((prev) => (prev === null ? false : prev));
    }
  }, [user]);

  // Re-evaluate whenever the auth user changes (login, logout, role switch).
  useEffect(() => {
    if (!user) { setEnabledState(false); return; }
    refresh();
  }, [user, refresh]);

  return (
    <Ctx.Provider value={{ enabled, refresh, setEnabled: setEnabledState }}>
      {children}
    </Ctx.Provider>
  );
}
