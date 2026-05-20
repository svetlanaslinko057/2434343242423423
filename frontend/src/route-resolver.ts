/**
 * L0 route resolver — the single source of truth for "where do I send this user?"
 *
 * Rule (from CONTRACTS.md):
 *   ROLE ≠ ACCOUNT. ROLE = STATE.
 *   One account, many states. UI follows `states` + `active_context`.
 *
 * Inputs come straight from GET /api/me. No derived logic, no fallbacks to role-based
 * routing, no inference about "is this a client" — the backend already decided.
 */

export type Me = {
  states?: string[];
  active_context?: string | null;
  role?: string;
};

export function resolveContextRoute(ctx: string | null | undefined): string {
  switch (ctx) {
    case 'client':    return '/client/home';
    case 'developer': return '/developer/home';
    case 'admin':     return '/admin/home';
    default:          return '/hub';
  }
}

export function resolveRoute(me: Me | null | undefined): string {
  // Smart Hub model: /home is the single entry for everyone.
  // It merges visitor / client / developer / admin sections based on me.states —
  // we never route users AWAY from the hub into an isolated role-specific world.
  // Context stacks (/client/*, /developer/*, /admin/*) are still reachable from
  // the hub when the user explicitly opens them.
  if (!me) return '/auth';
  return '/hub';
}
