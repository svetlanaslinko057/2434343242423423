/**
 * Root route `/` — the unconditional entry gate.
 *
 * Decision tree (no UI rendered here — splash only while resolving auth):
 *   1. auth still resolving      → null (host layout paints the background)
 *   2. authenticated user        → redirect to role-specific home via resolveUserEntry
 *   3. unauthenticated visitor   → redirect to /welcome (the canonical first page)
 *
 * This file is intentionally tiny. The previous implementation rendered the
 * "describe your product" form here and used a sessionStorage flag to gate
 * the welcome bounce — which meant after the first click-through, every
 * subsequent visit to `/` skipped welcome entirely. That produced the bug
 * where /welcome stopped being the first thing a returning visitor saw.
 *
 * Now `/` is purely a router decision; the describe form lives at /describe
 * and is reached only via the welcome CTA (or direct deep-link / back-nav
 * from the post-describe funnel: lead/workspace, estimate-result).
 */
import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/auth';
import { useMe } from '../src/use-me';
import { resolveUserEntry } from '../src/resolve-entry';

export default function Index() {
  const router = useRouter();
  const { token, loading: authLoading } = useAuth();
  const { me, loading: meLoading } = useMe();

  useEffect(() => {
    if (authLoading) return;
    if (token) {
      if (meLoading) return;
      if (me) {
        router.replace(resolveUserEntry(me) as any);
        return;
      }
      // token present but no `me` payload → treat as guest (token will be
      // cleared by useMe on its own error path).
    }
    router.replace('/welcome' as any);
  }, [authLoading, meLoading, token, me, router]);

  return null;
}
