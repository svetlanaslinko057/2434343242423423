/**
 * Admin · System · Users tab.
 *
 * Identity Layer UI. Lists every user with their roles[]; lets an admin
 * assign/remove any of the 4 canonical roles (admin · developer · tester ·
 * client). Backend guards: admin-only, last-admin-safe, audited to
 * db.system_actions_log source=admin_system, realtime-broadcast.
 *
 * UI rule per /app/web/ARCHITECTURE.md: we render what the backend returns,
 * no client-side aggregation. Every toggle POSTs, then refetches the list.
 */
import { useState, useEffect, useMemo } from 'react';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import { Shield, Code2, TestTube2, Briefcase, RefreshCw, Search, CheckCircle2, Circle, AlertTriangle } from 'lucide-react';

const ROLES = [
  { key: 'admin',     label: 'Admin',     icon: Shield,    color: 'text-rose-400',    bg: 'bg-rose-500/15',    border: 'border-rose-500/30' },
  { key: 'developer', label: 'Developer', icon: Code2,     color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/30' },
  { key: 'tester',    label: 'Tester',    icon: TestTube2, color: 'text-amber-400',   bg: 'bg-amber-500/15',   border: 'border-amber-500/30' },
  { key: 'client',    label: 'Client',    icon: Briefcase, color: 'text-signal',     bg: 'bg-signal/15',     border: 'border-signal/30' },
];

export default function AdminSystemUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null); // `${email}:${role}` while toggling
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await runtime.get('/api/admin/system/users');
      setUsers(data.items || []);
    } catch (e) {
      setError(e instanceof ApiError ? (e.hint || e.message) : (e.response?.data?.detail || e.message));
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggle = async (email, role, hasIt) => {
    const key = `${email}:${role}`;
    setBusy(key);
    setError(null);
    try {
      const url = hasIt
        ? '/api/admin/system/roles/remove'
        : '/api/admin/system/roles/assign';
      // Idempotency: dedup double-clicks on the same toggle within ~10s.
      // No `capability: 'payment'` — role assignment is an identity-layer state
      // change, not a money dispatch (backend audits via system_actions_log).
      await runtime.post(url, { email, role }, {
        idempotencyKey: `role-toggle:${hasIt ? 'remove' : 'assign'}:${email}:${role}`,
      });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.hint || e.message) : (e.response?.data?.detail || e.message));
    } finally {
      setBusy(null);
    }
  };

  const filtered = useMemo(() => {
    // The only "filtering" allowed per ARCHITECTURE.md — pure UI search.
    // No aggregation, no derivation, no hiding of business signals.
    if (!q.trim()) return users;
    const needle = q.toLowerCase();
    return users.filter(u =>
      (u.email || '').toLowerCase().includes(needle) ||
      (u.name || '').toLowerCase().includes(needle)
    );
  }, [users, q]);

  const adminCount = users.filter(u => (u.roles || []).includes('admin')).length;

  return (
    <div data-testid="admin-system-users">
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-muted-foreground">Users &amp; Roles</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {users.length} user{users.length === 1 ? '' : 's'} · {adminCount} admin{adminCount === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              data-testid="users-search"
              placeholder="Search email or name"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs rounded bg-muted/40 border border-border focus:outline-none focus:ring-1 focus:ring-emerald-500 w-60"
            />
          </div>
          <button
            data-testid="users-refresh"
            onClick={load}
            className="flex items-center gap-2 px-3 py-1.5 text-xs rounded bg-muted hover:bg-muted/70"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div data-testid="users-error" className="mb-4 px-4 py-2 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      )}

      {loading && users.length === 0 && (
        <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground text-sm">
          Loading…
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground text-sm">
          {users.length === 0 ? 'No users in the system yet.' : 'No users match your search.'}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((u) => (
            <UserRow
              key={u.user_id || u.email}
              user={u}
              busy={busy}
              onToggle={toggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UserRow({ user, busy, onToggle }) {
  const roles = user.roles || [];
  const primary = user.role;

  return (
    <div
      data-testid={`user-row-${user.email}`}
      className="bg-card border border-border rounded-lg px-4 py-3 flex items-center gap-4 flex-wrap"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm truncate">{user.email}</span>
          {user.source === 'core' && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              CORE
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 truncate">
          {user.name || '—'} · primary: <span className="text-foreground font-medium">{primary}</span>
          {user.active_context && <> · active: <span className="text-foreground">{user.active_context}</span></>}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {ROLES.map((r) => {
          const has = roles.includes(r.key);
          const key = `${user.email}:${r.key}`;
          const isBusy = busy === key;
          const Icon = r.icon;
          return (
            <button
              key={r.key}
              data-testid={`role-toggle-${user.email}-${r.key}`}
              disabled={isBusy}
              onClick={() => onToggle(user.email, r.key, has)}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border transition-all ${
                has
                  ? `${r.bg} ${r.color} ${r.border}`
                  : 'bg-muted/20 text-muted-foreground border-border hover:border-muted-foreground/40'
              } ${isBusy ? 'opacity-50 cursor-wait' : ''}`}
              title={has ? `Remove ${r.label}` : `Grant ${r.label}`}
            >
              {has ? <CheckCircle2 className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
              <Icon className="w-3 h-3" />
              {r.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
