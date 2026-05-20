import React, { useEffect, useState, useCallback, useMemo } from 'react';
import axios from 'axios';

/**
 * Phase 3.E — Admin Contracts.
 *
 * Strict UI rule: render JSON, never recompute. The list comes from a
 * single endpoint; selecting a row hits another single endpoint for the
 * full audit trail (signatures, IPs, billing rules).
 */

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const fmtMoney = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const fmtDate = (iso) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString(); } catch { return iso; } };

const STATUSES = ['all', 'draft', 'signed', 'active', 'cancelled'];

export default function AdminContractsPage() {
  const [status, setStatus] = useState('all');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/admin/contracts${status !== 'all' ? `?status=${status}` : ''}`, { withCredentials: true });
      setRows(Array.isArray(r.data) ? r.data : []);
      setError(null);
    } catch (e) {
      setError(e?.response?.data?.detail || 'Failed to load contracts');
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (id) => {
    setActiveId(id);
    setDetail(null);
    try {
      const r = await axios.get(`${API}/admin/contracts/${id}`, { withCredentials: true });
      setDetail(r.data);
    } catch (e) {
      setDetail({ error: e?.response?.data?.detail || 'Failed' });
    }
  };

  const visible = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      (r.client_name || '').toLowerCase().includes(q) ||
      (r.client_email || '').toLowerCase().includes(q) ||
      (r.project_title || '').toLowerCase().includes(q) ||
      (r.contract_id || '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto" data-testid="admin-contracts-page">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Contracts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Click-wrap agreements that gate project activation. Each row carries
          a signature audit trail (IP + user-agent + timestamp).
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <Field label="Status">
          <select
            data-testid="contracts-status-select"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="bg-background border border-border rounded-md px-3 py-2 text-sm"
          >
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Search">
          <input
            data-testid="contracts-search"
            type="text"
            placeholder="client / project / id"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-background border border-border rounded-md px-3 py-2 text-sm w-64"
          />
        </Field>
        <button
          data-testid="contracts-refresh"
          className="ml-auto text-sm px-3 py-2 border border-border rounded-md hover:bg-muted"
          onClick={load}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="text-sm bg-red-900/20 border border-red-800 text-red-300 rounded-md p-3 mb-4">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          {rows === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contracts in this view.</p>
          ) : (
            <table className="w-full text-sm" data-testid="contracts-table">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2">Project</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Value</th>
                  <th>Signed</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
                  <tr
                    key={c.contract_id}
                    onClick={() => openDetail(c.contract_id)}
                    data-testid={`contract-row-${c.contract_id}`}
                    className={`border-b border-border/40 cursor-pointer hover:bg-muted/30 transition ${activeId === c.contract_id ? 'bg-muted/40' : ''}`}
                  >
                    <td className="py-2">
                      <div className="font-medium">{c.project_title || '—'}</div>
                      <div className="text-xs text-muted-foreground">{c.modules_count} modules · v{c.version}</div>
                    </td>
                    <td>
                      <div className="text-sm">{c.client_name || '—'}</div>
                      <div className="text-xs text-muted-foreground">{c.client_email || '—'}</div>
                    </td>
                    <td>
                      <StatusPill s={c.status} />
                    </td>
                    <td className="font-medium text-emerald-400">{fmtMoney(c.total_value)}</td>
                    <td className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(c.signed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <aside className="border border-border rounded-lg p-4 sticky top-4 self-start">
          {!activeId && <p className="text-sm text-muted-foreground">Select a contract to see audit details.</p>}
          {activeId && !detail && <p className="text-sm text-muted-foreground">Loading…</p>}
          {detail?.error && <p className="text-sm text-red-300">{detail.error}</p>}
          {detail && !detail.error && (
            <div data-testid="contract-detail">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Contract</div>
              <div className="text-lg font-bold mb-1">{detail.project_title}</div>
              <div className="text-xs text-muted-foreground mb-4 break-all">{detail.contract_id}</div>

              <Row label="Status"   value={<StatusPill s={detail.status} />} />
              <Row label="Total"    value={fmtMoney(detail.totals?.total_value)} />
              <Row label="Modules"  value={detail.totals?.modules_count} />
              <Row label="Timeline" value={detail.timeline?.label || '—'} />
              <Row label="Hours"    value={detail.totals?.estimated_hours ?? '—'} />
              <Row label="Created"  value={fmtDate(detail.created_at)} />

              {detail.client && (
                <>
                  <div className="mt-4 text-[10px] tracking-[2px] font-bold text-muted-foreground">CLIENT</div>
                  <Row label="Name"  value={detail.client.name || '—'} />
                  <Row label="Email" value={detail.client.email || '—'} />
                </>
              )}

              <div className="mt-4 text-[10px] tracking-[2px] font-bold text-muted-foreground">SIGNATURES</div>
              {(detail.signatures && detail.signatures.length > 0) ? (
                detail.signatures.map((sig, i) => (
                  <div key={i} className="text-xs border border-border rounded p-2 mt-2 bg-muted/20" data-testid={`signature-${i}`}>
                    <div className="font-mono text-[11px]">{sig.user_id}</div>
                    <div className="text-muted-foreground">{fmtDate(sig.signed_at)}</div>
                    <div className="text-muted-foreground break-all">IP {sig.ip || '—'}</div>
                    <div className="text-muted-foreground break-all">UA {sig.user_agent || '—'}</div>
                  </div>
                ))
              ) : (
                <div className="text-xs text-muted-foreground mt-2">Not signed yet.</div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function StatusPill({ s }) {
  const map = {
    signed:    'bg-emerald-900/30 text-emerald-300',
    active:    'bg-signal/30    text-signal',
    draft:     'bg-amber-900/30   text-amber-300',
    cancelled: 'bg-red-900/30     text-red-300',
  };
  return <span className={`inline-block px-2 py-0.5 rounded text-xs ${map[s] || 'bg-muted text-muted-foreground'}`}>{s || '—'}</span>;
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between items-center py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
