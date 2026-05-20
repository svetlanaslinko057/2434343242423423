import React, { useEffect, useState, useCallback, useMemo } from 'react';
import axios from 'axios';

/**
 * Phase 2.C — Admin Growth Panel.
 *
 * Strict UI rule (see web/ARCHITECTURE.md): UI renders JSON, never aggregates.
 * Each tab has ONE endpoint. Approve/Cancel POSTs trigger a refetch — we never
 * mutate cached state in place.
 *
 * Endpoints:
 *   GET  /api/admin/growth/overview
 *   GET  /api/admin/growth/payouts?status=accrued|approved|paid|cancelled|all
 *   POST /api/admin/growth/payouts/:id/approve
 *   POST /api/admin/growth/payouts/:id/cancel
 */

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const fmtMoney = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
};

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'payouts',  label: 'Payouts'  },
  { id: 'tiers',    label: 'Tiers'    },
];

const PAYOUT_STATUSES = ['accrued', 'approved', 'paid', 'cancelled', 'all'];

export default function AdminGrowthPage() {
  const [tab, setTab] = useState('overview');

  return (
    <div className="p-6 max-w-[1400px] mx-auto" data-testid="admin-growth-page">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Growth</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Referrals, payouts, and tier configuration.
        </p>
      </header>

      <nav className="flex gap-1 border-b border-border mb-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            data-testid={`growth-tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition ${
              tab === t.id
                ? 'text-foreground border-b-2 border-primary -mb-px'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'payouts'  && <PayoutsTab  />}
      {tab === 'tiers'    && <TiersTab    />}
    </div>
  );
}

/* ─────────────── OVERVIEW ─────────────── */

function OverviewTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/admin/growth/overview`, { withCredentials: true });
      setData(r.data);
      setError(null);
    } catch (e) {
      setError(e?.response?.data?.detail || 'Failed to load overview');
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  if (error) return <ErrorBanner msg={error} />;
  if (!data) return <Skeleton />;

  const refs    = data.referrals || {};
  const pay     = data.payouts   || {};
  const links   = data.links     || {};
  const top     = data.top_referrers || [];

  return (
    <div data-testid="growth-overview">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KpiCard label="Total referrals"  value={refs.total  ?? 0} testId="kpi-total" />
        <KpiCard label="Active referrals" value={refs.active ?? 0} testId="kpi-active" />
        <KpiCard label="Total payouts"    value={pay.total   ?? 0} testId="kpi-payouts" />
        <KpiCard label="Conversion"
                 value={`${links.conversion_rate ?? 0}%`}
                 testId="kpi-conversion" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <MoneyCard label="Accrued"  value={fmtMoney(pay.total_accrued_amount)}  accent="amber"   testId="money-accrued" />
        <MoneyCard label="Approved" value={fmtMoney(pay.total_approved_amount)} accent="emerald" testId="money-approved" />
        <MoneyCard label="Paid"     value={fmtMoney(pay.total_paid_amount)}     accent="primary" testId="money-paid" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KpiCard label="Total links"        value={links.total ?? 0}            testId="kpi-links" />
        <KpiCard label="Total clicks"       value={links.total_clicks ?? 0}     testId="kpi-clicks" />
        <KpiCard label="Total conversions"  value={links.total_conversions ?? 0} testId="kpi-conversions" />
        <KpiCard label="Accrued payouts"    value={pay.accrued ?? 0}            testId="kpi-accrued-count" />
      </div>

      <h2 className="text-lg font-semibold mb-3">Top referrers</h2>
      {top.length === 0 ? (
        <p className="text-sm text-muted-foreground">No referrers yet.</p>
      ) : (
        <table className="w-full text-sm" data-testid="top-referrers-table">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="py-2">Name</th>
              <th>Email</th>
              <th>Referrals</th>
              <th>Lifetime earned</th>
            </tr>
          </thead>
          <tbody>
            {top.map((r, i) => (
              <tr key={r.user_id || i} className="border-b border-border/40">
                <td className="py-2">{r.name || '—'}</td>
                <td className="text-muted-foreground">{r.email || '—'}</td>
                <td>{r.referrals_count ?? '—'}</td>
                <td className="text-emerald-400 font-medium">{fmtMoney(r.lifetime_earned)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ─────────────── PAYOUTS ─────────────── */

function PayoutsTab() {
  const [status, setStatus] = useState('accrued');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [bump, setBump] = useState(0);

  // Filters (client-side filtering on PRE-FETCHED rows is allowed — these
  // are operator filters, not data derivation. The dataset comes from one
  // backend call.)
  const [userFilter, setUserFilter] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [sortBy, setSortBy] = useState('created_desc');

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/admin/growth/payouts?status=${status}`, { withCredentials: true });
      setRows(Array.isArray(r.data) ? r.data : []);
      setError(null);
    } catch (e) {
      setError(e?.response?.data?.detail || 'Failed to load payouts');
    }
  }, [status]);

  useEffect(() => { load(); }, [load, bump]);

  const visible = useMemo(() => {
    if (!rows) return [];
    let out = rows;
    if (userFilter.trim()) {
      const q = userFilter.trim().toLowerCase();
      out = out.filter(
        (p) =>
          (p.referrer_name  || '').toLowerCase().includes(q) ||
          (p.referred_name  || '').toLowerCase().includes(q) ||
          (p.referrer_user_id || '').toLowerCase().includes(q),
      );
    }
    if (minAmount) {
      const min = Number(minAmount);
      if (!Number.isNaN(min)) out = out.filter((p) => Number(p.amount || 0) >= min);
    }
    out = [...out].sort((a, b) => {
      if (sortBy === 'amount_desc') return Number(b.amount || 0) - Number(a.amount || 0);
      if (sortBy === 'amount_asc')  return Number(a.amount || 0) - Number(b.amount || 0);
      // default: created_desc
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
    return out;
  }, [rows, userFilter, minAmount, sortBy]);

  const approve = async (id) => {
    setBusyId(id);
    try {
      await axios.post(`${API}/admin/growth/payouts/${id}/approve`, {}, { withCredentials: true });
      setBump((b) => b + 1);
    } catch (e) {
      alert(e?.response?.data?.detail || 'Approve failed');
    } finally { setBusyId(null); }
  };

  const cancel = async (id) => {
    if (!window.confirm('Cancel this payout? Balance will be reversed.')) return;
    setBusyId(id);
    try {
      await axios.post(`${API}/admin/growth/payouts/${id}/cancel`, {}, { withCredentials: true });
      setBump((b) => b + 1);
    } catch (e) {
      alert(e?.response?.data?.detail || 'Cancel failed');
    } finally { setBusyId(null); }
  };

  return (
    <div data-testid="growth-payouts">
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <Field label="Status">
          <select
            data-testid="payouts-status-select"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="bg-background border border-border rounded-md px-3 py-2 text-sm"
          >
            {PAYOUT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="User">
          <input
            data-testid="payouts-user-filter"
            type="text"
            placeholder="name / email / id"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className="bg-background border border-border rounded-md px-3 py-2 text-sm w-56"
          />
        </Field>
        <Field label="Min amount">
          <input
            data-testid="payouts-amount-filter"
            type="number"
            placeholder="0"
            value={minAmount}
            onChange={(e) => setMinAmount(e.target.value)}
            className="bg-background border border-border rounded-md px-3 py-2 text-sm w-28"
          />
        </Field>
        <Field label="Sort">
          <select
            data-testid="payouts-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="bg-background border border-border rounded-md px-3 py-2 text-sm"
          >
            <option value="created_desc">Newest first</option>
            <option value="amount_desc">Amount: high → low</option>
            <option value="amount_asc">Amount: low → high</option>
          </select>
        </Field>
        <button
          data-testid="payouts-refresh"
          className="ml-auto text-sm px-3 py-2 border border-border rounded-md hover:bg-muted"
          onClick={() => setBump((b) => b + 1)}
        >
          Refresh
        </button>
      </div>

      {error && <ErrorBanner msg={error} />}
      {rows === null ? <Skeleton /> : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payouts in this view.</p>
      ) : (
        <table className="w-full text-sm" data-testid="payouts-table">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="py-2">Created</th>
              <th>Referrer</th>
              <th>Referred</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p.payout_id} className="border-b border-border/40" data-testid={`payout-row-${p.payout_id}`}>
                <td className="py-2 whitespace-nowrap">{fmtDate(p.created_at)}</td>
                <td>{p.referrer_name || '—'}</td>
                <td>{p.referred_name || '—'}</td>
                <td className="font-medium text-emerald-400">{fmtMoney(p.amount)}</td>
                <td>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                    p.status === 'approved'  ? 'bg-emerald-900/30 text-emerald-300' :
                    p.status === 'paid'      ? 'bg-signal/30    text-signal'    :
                    p.status === 'cancelled' ? 'bg-red-900/30     text-red-300'     :
                                               'bg-amber-900/30   text-amber-300'
                  }`}>
                    {p.status}
                  </span>
                </td>
                <td>
                  <div className="flex gap-2">
                    {p.status === 'accrued' && (
                      <button
                        data-testid={`approve-${p.payout_id}`}
                        disabled={busyId === p.payout_id}
                        onClick={() => approve(p.payout_id)}
                        className="px-3 py-1 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded disabled:opacity-50"
                      >Approve</button>
                    )}
                    {(p.status === 'accrued' || p.status === 'approved') && (
                      <button
                        data-testid={`cancel-${p.payout_id}`}
                        disabled={busyId === p.payout_id}
                        onClick={() => cancel(p.payout_id)}
                        className="px-3 py-1 text-xs bg-red-600 hover:bg-red-500 text-white rounded disabled:opacity-50"
                      >Cancel</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ─────────────── TIERS ─────────────── */

function TiersTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      // Tier config lives on the user-side dashboard (CLIENT_REFERRAL_TIERS).
      // Admin is just another authed user — call it with their cookie.
      const r = await axios.get(`${API}/referral/dashboard`, { withCredentials: true });
      setData(r.data);
      setError(null);
    } catch (e) {
      setError(e?.response?.data?.detail || 'Failed to load tiers');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorBanner msg={error} />;
  if (!data) return <Skeleton />;

  const tiers = data.tier_info ? Object.entries(data.tier_info) : [];

  return (
    <div data-testid="growth-tiers">
      <p className="text-sm text-muted-foreground mb-4">
        Commission tiers used by the referral engine. Read-only here — to change
        rates, edit <code>CLIENT_REFERRAL_TIERS</code> in <code>backend/server.py</code>.
      </p>
      {tiers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tier data exposed by backend.</p>
      ) : (
        <table className="w-full text-sm" data-testid="tiers-table">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="py-2">Source role</th>
              <th>Tier label</th>
              <th>Commission</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map(([roleKey, t]) => (
              <tr key={roleKey} className="border-b border-border/40">
                <td className="py-2 font-medium">{roleKey}</td>
                <td>{t.tier}</td>
                <td className="text-emerald-400">{(t.rate * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ─────────────── small primitives ─────────────── */

function KpiCard({ label, value, testId }) {
  return (
    <div className="border border-border rounded-lg p-4" data-testid={testId}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold mt-2">{value ?? '—'}</div>
    </div>
  );
}

function MoneyCard({ label, value, accent, testId }) {
  const cls =
    accent === 'amber'   ? 'text-amber-400'   :
    accent === 'emerald' ? 'text-emerald-400' :
                           'text-primary';
  return (
    <div className="border border-border rounded-lg p-4" data-testid={testId}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-2 ${cls}`}>{value}</div>
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

function ErrorBanner({ msg }) {
  return (
    <div className="text-sm bg-red-900/20 border border-red-800 text-red-300 rounded-md p-3 mb-4">{msg}</div>
  );
}

function Skeleton() {
  return <div className="text-sm text-muted-foreground">Loading…</div>;
}
