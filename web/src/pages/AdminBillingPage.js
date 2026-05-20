/**
 * Phase 4 — Admin Billing Panel.
 *
 * Renders /api/admin/billing/invoices as-is (no client-side aggregation).
 * Filter chips drive the `?status=` query. Two row-level actions:
 *   - Resend payment link (calls POST /admin/billing/invoices/{id}/resend)
 *   - Mark paid manually (calls POST /admin/billing/invoices/{id}/mark-paid)
 */
import { useEffect, useState, useCallback } from "react";
// ─── Runtime-client migration (Batch 1 — Web Admin Finance) ─────────────
// Transport-swap only. Local loading/error/busy state preserved (doctrine).
// `mark-paid` is a real ledger mutation but funds have already moved
// out-of-band, so we do NOT gate with `capability: 'payment'`.
// `resend` only regenerates the payment URL — no money movement.
import { runtime } from "@/runtime";
import { ApiError } from "@/runtime-client";

const STATUS_TONE = {
  pending_payment: { label: "Pending", bg: "var(--t-warning)22", color: "var(--t-warning)", border: "var(--t-warning)55" },
  paid:            { label: "Paid",    bg: "var(--t-signal)22", color: "var(--t-signal)", border: "var(--t-signal)55" },
  failed:          { label: "Failed",  bg: "var(--t-danger)22", color: "var(--t-danger)", border: "var(--t-danger)55" },
  cancelled:       { label: "Cancelled", bg: "var(--t-text-muted)22", color: "var(--t-text-secondary)", border: "var(--t-text-muted)55" },
  draft:           { label: "Draft",   bg: "var(--t-signal)22", color: "var(--t-signal)", border: "var(--t-signal)55" },
};

function fmtMoney(n, ccy = "USD") {
  const v = Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
  return ccy === "USD" ? `$${v}` : `${v} ${ccy}`;
}
function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AdminBillingPage() {
  const [invoices, setInvoices] = useState([]);
  const [stats, setStats] = useState(null);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState({});
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = filter === "all"
        ? `/api/admin/billing/invoices`
        : `/api/admin/billing/invoices?status=${filter}`;
      const r = await runtime.get(url);
      setInvoices(r.data?.invoices || []);
      setStats(r.data?.stats || null);
    } catch (e) {
      const msg = e instanceof ApiError ? (e.hint || e.message) : "Could not load invoices";
      setToast({ kind: "error", text: msg });
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const resend = async (inv) => {
    setBusy((b) => ({ ...b, [inv.invoice_id]: "resend" }));
    try {
      const url = `/api/admin/billing/invoices/${inv.invoice_id}/resend`;
      const r = await runtime.post(
        url,
        {},
        // Resending a payment link is logically idempotent on the same
        // invoice — repeat clicks should not generate fresh provider refs.
        { idempotencyKey: `resend:${inv.invoice_id}` },
      );
      setToast({
        kind: "success",
        text: `Payment link regenerated (${r.data?.provider}).`,
        link: r.data?.payment_url,
      });
      load();
    } catch (e) {
      const msg = e instanceof ApiError ? (e.hint || e.message) : "Resend failed";
      setToast({ kind: "error", text: msg });
    } finally {
      setBusy((b) => { const c = { ...b }; delete c[inv.invoice_id]; return c; });
    }
  };

  const markPaid = async (inv) => {
    if (!window.confirm(`Mark "${inv.title}" (${fmtMoney(inv.amount, inv.currency)}) as paid?\n\nThis will activate the project and trigger referral payout.`)) return;
    setBusy((b) => ({ ...b, [inv.invoice_id]: "mark" }));
    try {
      const url = `/api/admin/billing/invoices/${inv.invoice_id}/mark-paid`;
      await runtime.post(
        url,
        {},
        { idempotencyKey: `markpaid:${inv.invoice_id}` },
      );
      setToast({ kind: "success", text: "Invoice marked as paid. Project unlocked." });
      load();
    } catch (e) {
      const msg = e instanceof ApiError ? (e.hint || e.message) : "Mark-paid failed";
      setToast({ kind: "error", text: msg });
    } finally {
      setBusy((b) => { const c = { ...b }; delete c[inv.invoice_id]; return c; });
    }
  };

  const FILTERS = [
    { key: "all", label: "All" },
    { key: "pending_payment", label: "Pending" },
    { key: "paid", label: "Paid" },
    { key: "failed", label: "Failed" },
  ];

  return (
    <div style={st.page} data-testid="admin-billing-page">
      <div style={st.header}>
        <div>
          <h1 style={st.h1}>Billing</h1>
          <p style={st.subhead}>Phase 4 — Payment Lock · WayForPay</p>
        </div>
        <button
          onClick={load}
          style={st.refreshBtn}
          data-testid="admin-billing-refresh"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Stats strip */}
      {stats ? (
        <div style={st.statRow}>
          <Stat label="Total" value={stats.total} />
          <Stat label="Pending" value={stats.pending_payment_count} accent="var(--t-warning)"
                sub={fmtMoney(stats.pending_payment_amount)} />
          <Stat label="Paid" value={stats.paid_count} accent="var(--t-signal)"
                sub={fmtMoney(stats.paid_amount)} />
          <Stat label="Failed" value={stats.failed_count} accent="var(--t-danger)" />
        </div>
      ) : null}

      {/* Filter chips */}
      <div style={st.filters}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{ ...st.filterChip, ...(filter === f.key ? st.filterChipActive : {}) }}
            data-testid={`admin-billing-filter-${f.key}`}
          >
            {f.label}
          </button>
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
          data-testid="admin-billing-toast"
        >
          {toast.text}
          {toast.link ? (
            <a href={toast.link} target="_blank" rel="noreferrer" style={st.toastLink}>
              {" "}→ open
            </a>
          ) : null}
        </div>
      ) : null}

      {/* Table */}
      <div style={st.tableWrap}>
        {loading ? (
          <div style={st.empty}>Loading…</div>
        ) : invoices.length === 0 ? (
          <div style={st.empty} data-testid="admin-billing-empty">
            No invoices in this filter.
          </div>
        ) : (
          <table style={st.table}>
            <thead>
              <tr>
                <th style={st.th}>Invoice</th>
                <th style={st.th}>Project</th>
                <th style={st.th}>Client</th>
                <th style={st.th}>Amount</th>
                <th style={st.th}>Provider</th>
                <th style={st.th}>Status</th>
                <th style={st.th}>Created</th>
                <th style={st.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const tone = STATUS_TONE[inv.status] || STATUS_TONE.draft;
                const b = busy[inv.invoice_id];
                const canPay = inv.status === "pending_payment" || inv.status === "failed";
                return (
                  <tr key={inv.invoice_id} data-testid={`admin-billing-row-${inv.invoice_id}`}>
                    <td style={st.td}>
                      <div style={st.invTitle}>{inv.title || "Invoice"}</div>
                      <div style={st.invMeta}>
                        {inv.kind ? `${inv.kind} · ` : ""}
                        <code style={st.code}>{inv.invoice_id}</code>
                      </div>
                    </td>
                    <td style={st.td}>
                      <div>{inv.project_title || "—"}</div>
                      <div style={st.invMeta}>{inv.project_status || ""}</div>
                    </td>
                    <td style={st.td}>
                      <div>{inv.client_name || "—"}</div>
                      <div style={st.invMeta}>{inv.client_email || ""}</div>
                    </td>
                    <td style={{ ...st.td, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                      {fmtMoney(inv.amount, inv.currency)}
                    </td>
                    <td style={st.td}>
                      <span style={st.providerChip}>{inv.provider || "—"}</span>
                    </td>
                    <td style={st.td}>
                      <span
                        style={{
                          ...st.statusChip,
                          background: tone.bg,
                          color: tone.color,
                          borderColor: tone.border,
                        }}
                      >
                        {tone.label}
                      </span>
                    </td>
                    <td style={{ ...st.td, color: "var(--t-text-secondary)", fontSize: 12 }}>
                      {fmtDate(inv.created_at)}
                      {inv.paid_at ? <div style={st.invMeta}>paid {fmtDate(inv.paid_at)}</div> : null}
                    </td>
                    <td style={st.td}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {inv.payment_url ? (
                          <a
                            href={inv.payment_url}
                            target="_blank"
                            rel="noreferrer"
                            style={st.btnGhost}
                            data-testid={`admin-billing-open-${inv.invoice_id}`}
                          >
                            Open
                          </a>
                        ) : null}
                        {canPay ? (
                          <button
                            onClick={() => resend(inv)}
                            disabled={!!b}
                            style={st.btnPrimary}
                            data-testid={`admin-billing-resend-${inv.invoice_id}`}
                          >
                            {b === "resend" ? "…" : "Resend link"}
                          </button>
                        ) : null}
                        {canPay ? (
                          <button
                            onClick={() => markPaid(inv)}
                            disabled={!!b}
                            style={st.btnSuccess}
                            data-testid={`admin-billing-mark-paid-${inv.invoice_id}`}
                          >
                            {b === "mark" ? "…" : "Mark paid"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
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
  refreshBtn: {
    background: "var(--t-surface-raised)", color: "var(--t-border-strong)", border: "1px solid var(--t-border-default)",
    borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontWeight: 600,
  },

  statRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 },
  statCard: {
    background: "var(--t-surface-raised)", border: "1px solid var(--t-surface-raised)", borderRadius: 12, padding: 16,
  },
  statLabel: { color: "var(--t-text-secondary)", fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase" },
  statValue: { fontSize: 28, fontWeight: 800, marginTop: 6, letterSpacing: -0.5 },
  statSub: { color: "var(--t-text-secondary)", fontSize: 12, marginTop: 4 },

  filters: { display: "flex", gap: 8, marginBottom: 16 },
  filterChip: {
    background: "var(--t-surface-raised)", color: "var(--t-text-secondary)", border: "1px solid var(--t-surface-raised)",
    borderRadius: 999, padding: "6px 14px", fontSize: 13, cursor: "pointer", fontWeight: 600,
  },
  filterChipActive: { background: "var(--t-signal)", color: "var(--t-signal-ink)", borderColor: "var(--t-signal)" },

  toast: {
    padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 12,
    border: "1px solid", cursor: "pointer",
  },
  toastLink: { color: "var(--t-text-primary)", textDecoration: "underline", fontWeight: 700 },

  tableWrap: { background: "var(--t-surface-raised)", border: "1px solid var(--t-surface-raised)", borderRadius: 12, overflow: "auto" },
  empty: { padding: 40, textAlign: "center", color: "var(--t-text-muted)" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: {
    textAlign: "left", padding: "10px 14px", color: "var(--t-text-secondary)", fontSize: 11,
    fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase",
    borderBottom: "1px solid var(--t-surface-raised)", background: "var(--t-surface-sunken)",
  },
  td: { padding: "12px 14px", borderBottom: "1px solid var(--t-surface-raised)", verticalAlign: "top" },
  invTitle: { fontWeight: 600, color: "var(--t-border-strong)" },
  invMeta: { color: "var(--t-text-muted)", fontSize: 11, marginTop: 2 },
  code: { fontFamily: "ui-monospace, monospace", fontSize: 11, color: "var(--t-text-secondary)" },

  providerChip: {
    background: "var(--t-surface-raised)", color: "var(--t-border-strong)", borderRadius: 6,
    padding: "3px 8px", fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  statusChip: {
    display: "inline-block",
    border: "1px solid", borderRadius: 999,
    padding: "3px 10px", fontSize: 11, fontWeight: 800, letterSpacing: 0.8,
    textTransform: "uppercase",
  },

  btnPrimary: {
    background: "var(--t-signal)", color: "var(--t-signal-ink)", border: "none",
    borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer",
  },
  btnSuccess: {
    background: "var(--t-signal)", color: "var(--t-signal-ink)", border: "none",
    borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer",
  },
  btnGhost: {
    background: "transparent", color: "var(--t-border-strong)",
    border: "1px solid var(--t-border-default)", borderRadius: 6,
    padding: "4px 9px", fontSize: 12, fontWeight: 700, cursor: "pointer",
    textDecoration: "none",
  },
};
