/**
 * Admin · Workflow — aggregate modules feed (web).
 *
 * Source: GET /api/admin/mobile/workflow?filter=…&q=…&limit=…
 * One request, no N+1. Item contract v1.
 *
 * QA actions reuse the mobile contract:
 *   POST /api/admin/mobile/qa/{id}/{approve|revision|reject}
 */
import { useEffect, useState, useCallback } from 'react';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import {
  RefreshCw, CheckCircle2, RotateCw, XCircle,
  AlertTriangle, FolderKanban, ExternalLink, Inbox,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/Toast';
import { DataTable } from '@/components/ui/DataTable';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SearchInput } from '@/components/ui/FormControls';

// QA-relevant statuses get amber/info badges — everything else is neutral or success/danger.
const STATUS_TONE = {
  in_progress: 'info',
  pending:     'neutral',
  submitted:   'info',
  review:      'warning',
  qa_pending:  'warning',
  completed:   'success',
  rejected:    'danger',
  blocked:     'danger',
};

const QA_STATUSES = new Set(['review', 'qa_pending', 'submitted']);

const FILTERS = [
  { k: 'all',     l: 'All' },
  { k: 'qa',      l: 'QA queue' },
  { k: 'active',  l: 'Active' },
  { k: 'blocked', l: 'Blocked' },
  { k: 'done',    l: 'Done' },
];

export default function AdminV2Workflow() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      setErr(null);
      const { data } = await runtime.get(
        '/api/admin/mobile/workflow',
        { params: { filter, q: search, limit: 100 } },
      );
      setData(data);
    } catch (e) {
      setErr(e instanceof ApiError ? (e.hint || e.message) : (e?.response?.data?.detail || 'Failed to load workflow'));
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const items = data?.items || [];
  const summary = data?.summary || {};
  const [pending, setPending] = useState(null);
  const { push } = useToast();

  const callQA = async (action, m, payload = {}) => {
    setBusy(m.id);
    try {
      // Idempotency: same module + same action collapses double-clicks (~10s window).
      // No `capability: 'payment'` — QA decision is a state-machine transition, not
      // a money dispatch. Reward payout happens on the backend AFTER approve;
      // see AdminEarningsControl for the actual payment-gated boundary.
      const idempotencyKey = `qa-decision:${m.id}:${action}`;
      await runtime.post(`/api/admin/mobile/qa/${m.id}/${action}`, payload, { idempotencyKey });
      push({ tone: 'success', text: `Module ${action}d.` });
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? (e.hint || e.message) : (e?.response?.data?.detail || `${action} failed`);
      push({ tone: 'error', text: msg });
    } finally {
      setBusy(null);
      setPending(null);
    }
  };
  const onApprove   = (m) => setPending({ action: 'approve',  m, dialogTitle: 'Approve module?',  description: 'This marks QA as passed.', confirmLabel: 'Approve' });
  const askRevision = (m) => setPending({ action: 'revision', m, dialogTitle: 'Send to revision', description: 'Module returns to the developer.', confirmLabel: 'Send back', variant: 'default' });
  const askReject   = (m) => setPending({ action: 'reject',   m, dialogTitle: 'Reject module?',   description: 'This is a hard reject.', confirmLabel: 'Reject', variant: 'destructive' });

  const runPending = () => {
    if (pending) callQA(pending.action, pending.m);
  };

  // Build DataTable columns — single source for header + cell rendering.
  const columns = [
    {
      key: 'title',
      label: 'Module',
      render: (m) => {
        const meta = m.meta || {};
        return (
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-token-primary truncate">{m.title}</span>
              {meta.revision_count > 0 && (
                <StatusBadge tone="warning">R{meta.revision_count}</StatusBadge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-small-token">
              <span className="flex items-center gap-1">
                <FolderKanban className="w-3 h-3" /> {meta.project_title || '—'}
              </span>
              {m.created_at && (
                <span>{String(m.created_at).slice(0, 10)}</span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: 'developer',
      label: 'Developer',
      width: '200px',
      render: (m) => <span className="text-token-secondary">{m.meta?.developer_name || '—'}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      width: '140px',
      render: (m) => <StatusBadge tone={STATUS_TONE[m.status] || 'neutral'}>{m.status}</StatusBadge>,
    },
    {
      key: 'price',
      label: 'Price',
      width: '120px',
      align: 'right',
      render: (m) => {
        const p = m.meta?.client_price || 0;
        return p > 0
          ? <span className="font-semibold text-token-brand">${Math.round(p)}</span>
          : <span className="text-token-muted">—</span>;
      },
    },
    {
      key: 'actions',
      label: '',
      width: '320px',
      align: 'right',
      render: (m) => {
        const isQA = QA_STATUSES.has(m.status) && m.actions?.includes('approve');
        return (
          <div className="flex justify-end gap-2 items-center">
            {isQA && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); onApprove(m); }}
                  disabled={busy !== null}
                  data-testid={`approve-${m.id}`}
                  className="btn-token-primary text-xs flex items-center gap-1 disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3 h-3" /> Approve
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); askRevision(m); }}
                  disabled={busy !== null}
                  data-testid={`revision-${m.id}`}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1 disabled:opacity-50"
                  style={{
                    background: 'var(--token-warning-tint)',
                    color: 'var(--token-warning)',
                    border: '1px solid var(--token-warning-border)',
                  }}
                >
                  <RotateCw className="w-3 h-3" /> Revision
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); askReject(m); }}
                  disabled={busy !== null}
                  data-testid={`reject-${m.id}`}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1 disabled:opacity-50"
                  style={{
                    background: 'var(--token-danger-tint)',
                    color: 'var(--token-danger)',
                    border: '1px solid var(--token-danger-border)',
                  }}
                >
                  <XCircle className="w-3 h-3" /> Reject
                </button>
              </>
            )}
            {m.web_url && (
              <a
                href={m.web_url}
                onClick={(e) => e.stopPropagation()}
                data-testid={`open-${m.id}`}
                className="text-token-brand text-xs inline-flex items-center gap-1"
                style={{ textDecoration: 'none' }}
              >
                <ExternalLink className="w-3 h-3" /> Details
              </a>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto" data-testid="admin-workflow">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-h1">Workflow</h1>
          <p className="text-small-token mt-1">Aggregated module pipeline · live QA queue</p>
        </div>
        <button
          onClick={load}
          className="btn-token-ghost flex items-center gap-2"
          data-testid="workflow-refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filter + search */}
      <div className="flex gap-3 mb-4" data-testid="workflow-filters">
        <div
          className="flex gap-1 p-1 rounded-lg"
          style={{ background: 'var(--token-surface)', border: '1px solid var(--token-border)' }}
        >
          {FILTERS.map((f) => {
            const count = summary[f.k];
            const showBadge = typeof count === 'number' && f.k !== 'all';
            const active = filter === f.k;
            return (
              <button
                key={f.k}
                onClick={() => setFilter(f.k)}
                data-testid={`filter-${f.k}`}
                className="px-3 py-1.5 text-xs rounded transition-ui flex items-center gap-2 font-medium"
                style={active
                  ? { background: 'var(--token-primary)', color: 'var(--token-primary-ink)' }
                  : { background: 'transparent', color: 'var(--token-text-secondary)' }}
              >
                {f.l}
                {showBadge && (
                  <span
                    className="px-1.5 py-0.5 text-[10px] rounded"
                    style={{
                      background: active ? 'rgba(0,0,0,0.18)' : 'var(--token-border)',
                      color: active ? 'var(--token-primary-ink)' : 'var(--token-text-secondary)',
                    }}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex-1">
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, dev, project, module_id…"
            testId="workflow-search"
          />
        </div>
      </div>

      {err && (
        <div
          className="app-card p-4 mb-4 flex gap-3"
          style={{ background: 'var(--token-danger-tint)', borderColor: 'var(--token-danger-border)' }}
          data-testid="workflow-error"
        >
          <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: 'var(--token-danger)' }} />
          <p className="text-sm" style={{ color: 'var(--token-danger)' }}>{err}</p>
        </div>
      )}

      {loading && !data && (
        <div className="app-card p-0 overflow-hidden" data-testid="workflow-skeleton">
          <Skeleton.Row count={6} />
        </div>
      )}

      {!loading && (
        <DataTable
          columns={columns}
          data={items}
          rowKey={(m) => m.id}
          testId="workflow-table"
          empty={
            <EmptyState
              icon={<Inbox className="w-6 h-6" />}
              title={search || filter !== 'all' ? 'No modules match' : 'Workflow is clear'}
              description={
                search || filter !== 'all'
                  ? 'Try another filter or clear the search.'
                  : 'No modules currently flow through the pipeline.'
              }
              tone={search || filter !== 'all' ? 'neutral' : 'success'}
              testId="workflow-empty"
            />
          }
        />
      )}

      {data?.summary?.has_more && (
        <p className="text-center text-small-token mt-4">
          Showing first {items.length} · refine search to narrow results.
        </p>
      )}

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(v) => { if (!v) setPending(null); }}
        title={pending?.dialogTitle || ''}
        description={pending?.description || ''}
        confirmLabel={pending?.confirmLabel || 'Confirm'}
        variant={pending?.variant || 'default'}
        onConfirm={runPending}
      />
    </div>
  );
}
