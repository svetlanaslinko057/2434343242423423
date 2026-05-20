/**
 * Phase 5 — Admin Withdrawals queue.
 *
 *  requested → approve → paid    (or → rejected)
 *
 * Approving doesn't move money — it just gates payout. Mark-paid is what
 * drains pending → withdrawn_lifetime on the dev's wallet. Reject returns
 * the funds to the developer's available balance.
 */
import { useEffect, useState, useCallback } from "react";
// ─── Runtime-client migration (Batch 1 — Web Admin Finance) ─────────────
// Transport-swap only. Local loading/error/busy state preserved (doctrine).
// Money-MOVING actions tagged `capability: 'payment'`; approve/reject of a
// withdrawal does NOT move money on its own, so it stays soft. `mark-paid`
// IS the out-of-band confirmation step — it mutates the ledger, but the
// money has already left, so still no capability gate here.
import { runtime } from "@/runtime";
import { ApiError } from "@/runtime-client";

const TONE = {
  requested: { label: "Requested", bg: "var(--t-warning)22", color: "var(--t-warning)", border: "var(--t-warning)55" },
  approved:  { label: "Approved",  bg: "var(--t-signal)22", color: "var(--t-signal)", border: "var(--t-signal)55" },
  paid:      { label: "Paid",      bg: "var(--t-signal)22", color: "var(--t-signal)", border: "var(--t-signal)55" },
  rejected:  { label: "Rejected",  bg: "var(--t-danger)22", color: "var(--t-danger)", border: "var(--t-danger)55" },
};

const fmt = (n) => `$${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const dt  = (iso) => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export default function AdminWithdrawalsPage() {
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [filter, setFilter] = useState("requested");
  const [busy, setBusy] = useState({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = filter === "all"
        ? `/api/admin/withdrawals`
        : `/api/admin/withdrawals?status=${filter}`;
      const r = await runtime.get(url);
      setRows(r.data?.withdrawals || []);
      setStats(r.data?.stats || null);
    } catch (e) {
      const msg = e instanceof ApiError ? (e.hint || e.message) : "Could not load withdrawals";
      setToast({ kind: "error", text: msg });
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const act = async (wd, action) => {
    if (action === "reject" && !window.confirm(`Reject ${fmt(wd.amount)} from ${wd.developer_email}?\n\nFunds will be returned to their available balance.`)) return;
    if (action === "mark-paid" && !window.confirm(`Confirm payment of ${fmt(wd.amount)} sent out-of-band to ${wd.developer_email}?`)) return;

    setBusy((b) => ({ ...b, [wd.withdrawal_id]: action }));
    try {
      const url = `/api/admin/withdrawals/${wd.withdrawal_id}/${action}`;
      await runtime.post(
        url,
        action === "reject" ? { reason: "rejected_by_admin" } : {},
        // Idempotency: admin double-click protection. mark-paid is a ledger
        // mutation — runtime sends `idempotency-key` so backend can dedup.
        { idempotencyKey: `${url}:${wd.withdrawal_id}` },
      );
      setToast({ kind: "success", text: `Withdrawal ${action}d.` });
      load();
    } catch (e) {
      const msg = e instanceof ApiError ? (e.hint || e.message) : `${action} failed`;
      setToast({ kind: "error", text: msg });
    } finally {
      setBusy((b) => { const c = { ...b }; delete c[wd.withdrawal_id]; return c; });
    }
  };

  const FILTERS = [
    { k: "requested", l: "Requested" },
    { k: "approved", l: "Approved" },
    { k: "paid", l: "Paid" },
    { k: "rejected", l: "Rejected" },
    { k: "all", l: "All" },
  ];

  return (
    <div style={st.page} data-testid="admin-withdrawals-page">
      <div style={st.header}>
        <div>
          <h1 style={st.h1}>Withdrawals</h1>
          <p style={st.subhead}>Phase 5 — Developer payout queue</p>
        </div>
        <button onClick={load} style={st.refreshBtn} data-testid="admin-withdrawals-refresh">↻ Refresh</button>
      </div>

      {stats ? (
        <div style={st.statRow}>
          <Stat label="Requested" value={stats.requested} accent="var(--t-warning)" sub={fmt(stats.requested_amount)} />
          <Stat label="Approved"  value={stats.approved}  accent="var(--t-signal)" />
          <Stat label="Paid"      value={stats.paid}      accent="var(--t-signal)" />
          <Stat label="Rejected"  value={stats.rejected}  accent="var(--t-danger)" />
        </div>
      ) : null}

      <div style={st.filters}>
        {FILTERS.map((f) => (
          <button
            key={f.k}
            onClick={() => setFilter(f.k)}
            style={{ ...st.chip, ...(filter === f.k ? st.chipActive : {}) }}
            data-testid={`admin-withdrawals-filter-${f.k}`}
          >{f.l}</button>
        ))}
      </div>

      {toast ? (
        <div
          style={{
            ...st.toast,
            background: toast.kind === "error" ? "var(--t-danger)22" : "var(--t-signal)22",
            borderColor: toast.kind === "error" ? "var(--t-danger)55" : "var(--t-signal)55",
            color: toast.kind === "error" ? "var(--t-danger-ink)" : "var(--t-success-ink)",
          }}
          onClick={() => setToast(null)}
          data-testid="admin-withdrawals-toast"
        >{toast.text}</div>
      ) : null}

      <div style={st.tableWrap}>
        {loading ? <div style={st.empty}>Loading…</div> :
         rows.length === 0 ? <div style={st.empty} data-testid="admin-withdrawals-empty">No withdrawals in this filter.</div> :
        <table style={st.table}>
          <thead>
            <tr>
              <th style={st.th}>Developer</th>
              <th style={st.th}>Amount</th>
              <th style={st.th}>Method</th>
              <th style={st.th}>Destination</th>
              <th style={st.th}>Status</th>
              <th style={st.th}>Requested</th>
              <th style={st.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((wd) => {
              const tone = TONE[wd.status] || TONE.requested;
              const b = busy[wd.withdrawal_id];
              return (
                <tr key={wd.withdrawal_id} data-testid={`admin-withdrawals-row-${wd.withdrawal_id}`}>
                  <td style={st.td}>
                    <div style={{ fontWeight: 600 }}>{wd.developer_name || "—"}</div>
                    <div style={st.meta}>{wd.developer_email}</div>
                  </td>
                  <td style={{ ...st.td, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(wd.amount)}</td>
                  <td style={st.td}><span style={st.chipMini}>{(wd.method || "manual").toUpperCase()}</span></td>
                  <td style={{ ...st.td, fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
                    {wd.destination ? (wd.destination.length > 32 ? wd.destination.slice(0, 30) + "…" : wd.destination) : "—"}
                  </td>
                  <td style={st.td}>
                    <span style={{ ...st.statusChip, background: tone.bg, color: tone.color, borderColor: tone.border }}>
                      {tone.label}
                    </span>
                    {wd.paid_at ? <div style={st.meta}>paid {dt(wd.paid_at)}</div> : null}
                  </td>
                  <td style={{ ...st.td, color: "var(--t-text-secondary)", fontSize: 12 }}>{dt(wd.created_at)}</td>
                  <td style={st.td}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {wd.status === "requested" ? (
                        <>
                          <button
                            onClick={() => act(wd, "approve")}
                            disabled={!!b}
                            style={st.btnPrimary}
                            data-testid={`admin-withdrawals-approve-${wd.withdrawal_id}`}
                          >{b === "approve" ? "…" : "Approve"}</button>
                          <button
                            onClick={() => act(wd, "reject")}
                            disabled={!!b}
                            style={st.btnDanger}
                            data-testid={`admin-withdrawals-reject-${wd.withdrawal_id}`}
                          >{b === "reject" ? "…" : "Reject"}</button>
                        </>
                      ) : null}
                      {wd.status === "approved" ? (
                        <button
                          onClick={() => act(wd, "mark-paid")}
                          disabled={!!b}
                          style={st.btnSuccess}
                          data-testid={`admin-withdrawals-mark-paid-${wd.withdrawal_id}`}
                        >{b === "mark-paid" ? "…" : "Mark paid"}</button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        }
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }) {
  return (
    <div style={st.statCard}>
      <div style={st.statLabel}>{label}</div>
      <div style={{ ...st.statValue, color: accent || "var(--t-text-primary)" }}>{value}</div>
      {sub ? <div style={st.statSub}>{sub}</div> : null}
    </div>
  );
}

const st = {
  page: { padding: "24px 32px", color: "var(--t-border-strong)", minHeight: "100vh", background: "var(--t-bg)" },
  header: { display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 24 },
  h1: { fontSize: 28, fontWeight: 800, margin: 0, color: "var(--t-text-primary)" },
  subhead: { color: "var(--t-text-muted)", fontSize: 13, margin: "4px 0 0", letterSpacing: 0.3 },
  refreshBtn: { background: "var(--t-surface-raised)", color: "var(--t-border-strong)", border: "1px solid var(--t-border-default)", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontWeight: 600 },

  statRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 },
  statCard: { background: "var(--t-surface-raised)", border: "1px solid var(--t-surface-raised)", borderRadius: 12, padding: 16 },
  statLabel: { color: "var(--t-text-secondary)", fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase" },
  statValue: { fontSize: 28, fontWeight: 800, marginTop: 6, letterSpacing: -0.5 },
  statSub: { color: "var(--t-text-secondary)", fontSize: 12, marginTop: 4 },

  filters: { display: "flex", gap: 8, marginBottom: 16 },
  chip: { background: "var(--t-surface-raised)", color: "var(--t-text-secondary)", border: "1px solid var(--t-surface-raised)", borderRadius: 999, padding: "6px 14px", fontSize: 13, cursor: "pointer", fontWeight: 600 },
  chipActive: { background: "var(--t-signal)", color: "var(--t-signal-ink)", borderColor: "var(--t-signal)" },
  chipMini: { background: "var(--t-surface-raised)", color: "var(--t-border-strong)", borderRadius: 6, padding: "3px 8px", fontSize: 10, fontWeight: 700, letterSpacing: 0.8 },

  toast: { padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 12, border: "1px solid", cursor: "pointer" },

  tableWrap: { background: "var(--t-surface-raised)", border: "1px solid var(--t-surface-raised)", borderRadius: 12, overflow: "auto" },
  empty: { padding: 40, textAlign: "center", color: "var(--t-text-muted)" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: { textAlign: "left", padding: "10px 14px", color: "var(--t-text-secondary)", fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", borderBottom: "1px solid var(--t-surface-raised)", background: "var(--t-surface-sunken)" },
  td: { padding: "12px 14px", borderBottom: "1px solid var(--t-surface-raised)", verticalAlign: "top" },
  meta: { color: "var(--t-text-muted)", fontSize: 11, marginTop: 2 },

  statusChip: { display: "inline-block", border: "1px solid", borderRadius: 999, padding: "3px 10px", fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase" },

  btnPrimary: { background: "var(--t-signal)", color: "var(--t-signal-ink)", border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" },
  btnDanger:  { background: "var(--t-danger)", color: "var(--t-danger-ink)", border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" },
  btnSuccess: { background: "var(--t-signal)", color: "var(--t-signal-ink)", border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" },
};
