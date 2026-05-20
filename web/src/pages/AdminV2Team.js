/**
 * Admin · Team — developer management unified with auto-balancing.
 *
 * Sections:
 *   1. Load Balance band — overloaded devs with [Rebalance] quick action
 *   2. Tabs: Overview (AdminTeamPanel) · Users (AdminUsersPage)
 */
import { useState, useEffect, useCallback } from 'react';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import { Users, Shield, Flame, RotateCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import AdminTeamPanel from './AdminTeamPanel';
import AdminUsersPage from './AdminUsersPage';

export default function AdminV2Team() {
  const [tab, setTab] = useState('overview');
  const [overloaded, setOverloaded] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [runningAll, setRunningAll] = useState(false);

  const loadOverloaded = useCallback(async () => {
    try {
      const { data } = await runtime.get('/api/admin/team/overloaded');
      setOverloaded(data?.items || []);
    } catch {
      // Soft-fail: empty list keeps the "Load is balanced" UX, no toast.
      // Auth-expired path is handled by runtime middleware (P0 #1).
      setOverloaded([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadOverloaded(); }, [loadOverloaded]);

  const rebalanceDev = async (devId, devName) => {
    if (!window.confirm(`Rebalance ${devName}? Will move up to 2 NOT-STARTED modules to other devs.`)) return;
    setBusy(devId);
    try {
      // Idempotency: same dev within ~10s collapses (rebalance-storm guard).
      // No `capability: 'payment'` — moving modules between devs is a state-machine
      // operation; no money is dispatched at this boundary.
      const { data } = await runtime.post(
        `/api/admin/team/rebalance/${devId}`,
        {},
        { idempotencyKey: `rebalance-dev:${devId}` },
      );
      const movesCount = data?.moves_count || 0;
      alert(movesCount > 0
        ? `✅ Moved ${movesCount} module${movesCount > 1 ? 's' : ''} from ${devName}`
        : `No movable (not-started) modules found for ${devName}`);
      await loadOverloaded();
    } catch (e) {
      const msg = e instanceof ApiError ? (e.hint || e.message) : (e?.response?.data?.detail || 'error');
      alert(`Failed: ${msg}`);
    } finally {
      setBusy(null);
    }
  };

  const rebalanceAll = async () => {
    if (!window.confirm('Auto-rebalance all overloaded developers now?')) return;
    setRunningAll(true);
    try {
      const { data } = await runtime.post(
        '/api/admin/team/auto-rebalance',
        {},
        { idempotencyKey: `auto-rebalance:${Math.floor(Date.now() / 10000)}` },
      );
      alert(`✅ Done. Total moves: ${data?.total_moves || 0}`);
      await loadOverloaded();
    } catch (e) {
      const msg = e instanceof ApiError ? (e.hint || e.message) : (e?.response?.data?.detail || 'error');
      alert(`Failed: ${msg}`);
    } finally {
      setRunningAll(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto" data-testid="admin-team">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Team</h1>
          <p className="text-sm text-muted-foreground mt-1">Capacity · performance · auto-balancing</p>
        </div>
      </div>

      {/* Load Balance band */}
      <section className="mb-6" data-testid="team-balance-band">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            Load Balance
          </h2>
          {overloaded.length > 0 && (
            <button
              onClick={rebalanceAll}
              disabled={runningAll}
              data-testid="rebalance-all-btn"
              className="flex items-center gap-2 px-3 py-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-black font-bold rounded disabled:opacity-50"
            >
              <RotateCw className={`w-3 h-3 ${runningAll ? 'animate-spin' : ''}`} />
              Rebalance all
            </button>
          )}
        </div>

        {loading && <div className="bg-card border border-border rounded-xl p-4 text-center text-sm text-muted-foreground">Checking load…</div>}

        {!loading && overloaded.length === 0 && (
          <div className="bg-card border border-emerald-500/30 rounded-xl p-4 flex items-center gap-3" data-testid="load-balanced">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <p className="text-sm">Load is balanced. No overloaded developers.</p>
          </div>
        )}

        {overloaded.length > 0 && (
          <div className="space-y-2">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-center gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <p className="text-xs text-amber-400">
                {overloaded.length} developer{overloaded.length > 1 ? 's' : ''} overloaded.
                Rebalance moves ONLY not-started modules to lower-tier devs with free capacity.
              </p>
            </div>
            {overloaded.map((item) => (
              <div
                key={item.id}
                className="bg-card border border-amber-500/30 rounded-xl p-4 flex items-center gap-4"
                data-testid={`overloaded-${item.id}`}
              >
                <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                  <Flame className="w-5 h-5 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold">{item.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.subtitle}</p>
                  {item.meta?.reasons?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {item.meta.reasons.map((r, i) => (
                        <span key={i} className="px-2 py-0.5 text-[10px] bg-amber-500/20 text-amber-400 rounded">
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => rebalanceDev(item.id, item.title)}
                  disabled={busy === item.id || item.meta?.rebalanceable_count === 0}
                  data-testid={`rebalance-${item.id}`}
                  className="px-4 py-2 text-sm bg-amber-500 hover:bg-amber-400 text-black font-bold rounded disabled:opacity-40 flex items-center gap-2"
                  title={item.meta?.rebalanceable_count === 0 ? 'No movable (not-started) modules' : 'Rebalance'}
                >
                  <RotateCw className={`w-4 h-4 ${busy === item.id ? 'animate-spin' : ''}`} />
                  Rebalance
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Tabs */}
      <div className="flex gap-1 bg-card border border-border rounded-lg p-1 mb-6 w-fit" data-testid="team-tabs">
        <button
          onClick={() => setTab('overview')}
          data-testid="tab-overview"
          className={`flex items-center gap-2 px-4 py-2 text-sm rounded transition-colors ${
            tab === 'overview' ? 'bg-emerald-500 text-black font-bold' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Shield className="w-4 h-4" />
          Overview
        </button>
        <button
          onClick={() => setTab('users')}
          data-testid="tab-users"
          className={`flex items-center gap-2 px-4 py-2 text-sm rounded transition-colors ${
            tab === 'users' ? 'bg-emerald-500 text-black font-bold' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Users className="w-4 h-4" />
          Users
        </button>
      </div>

      {tab === 'overview' && <div data-testid="team-overview-embed"><AdminTeamPanel /></div>}
      {tab === 'users' && <div data-testid="team-users-embed"><AdminUsersPage /></div>}
    </div>
  );
}
