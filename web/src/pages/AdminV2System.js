/**
 * Admin · System — Identity (users/roles), integrations, templates,
 * marketplace quality, audit log.
 *
 * Tabs: Users · Integrations · Templates · Marketplace QA · Audit
 *
 * Audit log: live via GET /api/admin/audit-log (contract v1).
 */
import { useState, useEffect, useCallback } from 'react';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import { Users, Key, FileText, Activity, ShieldAlert, RefreshCw, CreditCard } from 'lucide-react';
import AdminIntegrationsPage from './AdminIntegrationsPage';
import AdminPaymentsPage from './AdminPaymentsPage';
import AdminTemplatesPage from './AdminTemplatesPage';
import AdminSystemUsers from './AdminSystemUsers';
import AdminMarketplaceQuality from './AdminMarketplaceQuality';

const TABS = [
  { k: 'users',        l: 'Users',             icon: <Users className="w-4 h-4" /> },
  { k: 'payments',     l: 'Payments',          icon: <CreditCard className="w-4 h-4" /> },
  { k: 'integrations', l: 'Integrations',      icon: <Key className="w-4 h-4" /> },
  { k: 'templates',    l: 'Templates',         icon: <FileText className="w-4 h-4" /> },
  { k: 'marketplace',  l: 'Marketplace QA',    icon: <ShieldAlert className="w-4 h-4" /> },
  { k: 'audit',        l: 'Audit log',         icon: <Activity className="w-4 h-4" /> },
];

export default function AdminV2System() {
  const [tab, setTab] = useState('users');
  const [audit, setAudit] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const loadAudit = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { data } = await runtime.get(
        '/api/admin/audit-log',
        { params: { limit: 100 } },
      );
      setAudit(data);
    } catch (e) {
      setErr(e instanceof ApiError ? (e.hint || e.message) : (e?.response?.data?.detail || 'Failed to load audit log'));
      setAudit({ items: [], summary: { total: 0, has_more: false } });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'audit') loadAudit();
  }, [tab, loadAudit]);

  return (
    <div className="p-6 max-w-7xl mx-auto" data-testid="admin-system">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">System</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Identity · integrations · templates · marketplace · audit
        </p>
      </div>

      <div className="flex gap-1 bg-card border border-border rounded-lg p-1 mb-6 w-fit flex-wrap" data-testid="system-tabs">
        {TABS.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            data-testid={`tab-${t.k}`}
            className={`flex items-center gap-2 px-4 py-2 text-sm rounded transition-colors ${
              tab === t.k
                ? 'bg-[var(--t-signal)] text-black font-bold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.icon}
            {t.l}
          </button>
        ))}
      </div>

      {tab === 'users' && <AdminSystemUsers />}
      {tab === 'payments' && <div data-testid="system-payments-embed"><AdminPaymentsPage /></div>}
      {tab === 'integrations' && <div data-testid="system-integrations-embed"><AdminIntegrationsPage /></div>}
      {tab === 'templates' && <div data-testid="system-templates-embed"><AdminTemplatesPage /></div>}
      {tab === 'marketplace' && <div data-testid="system-marketplace-embed"><AdminMarketplaceQuality /></div>}

      {tab === 'audit' && (
        <div data-testid="system-audit">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold">Recent admin actions</h2>
              {audit?.summary && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {audit.summary.total} total
                  {audit.summary.has_more && ' · showing last 100'}
                </p>
              )}
            </div>
            <button
              onClick={loadAudit}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded bg-muted hover:bg-muted/70"
              data-testid="audit-refresh"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {err && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4 text-sm text-red-400">
              {err}
            </div>
          )}

          {loading && !audit && (
            <div className="text-center py-12 text-muted-foreground">Loading audit log…</div>
          )}

          {audit && audit.items.length === 0 && !loading && (
            <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground text-sm">
              No audit records yet. System actions are logged here as they happen.
            </div>
          )}

          <div className="space-y-1">
            {audit?.items?.map((row) => (
              <div
                key={row.id}
                data-testid={`audit-row-${row.id}`}
                className="bg-card border border-border rounded-lg px-4 py-2 flex items-center gap-3 text-sm"
              >
                <span className="text-xs text-muted-foreground w-40 shrink-0 font-mono">
                  {row.created_at ? String(row.created_at).slice(0, 19).replace('T', ' ') : '—'}
                </span>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-[var(--t-signal)]/10 text-[var(--t-signal)] shrink-0">
                  {row.action}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">{row.entity?.type || '—'}</span>
                <span className="flex-1 font-mono text-xs truncate">{row.entity?.id || '—'}</span>
                <span className="text-xs text-muted-foreground shrink-0" title={row.actor?.id}>
                  {row.actor?.email || row.actor?.name || (row.actor?.id ? row.actor.id.slice(0, 12) : 'system')}
                </span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider shrink-0">
                  {row.source || '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
