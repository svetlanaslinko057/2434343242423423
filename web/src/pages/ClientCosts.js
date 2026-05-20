/**
 * Block 6 — Client Cost Control page  (GET /api/client/costs)
 * Shows profit/cost KPIs and per-module breakdown with pending-payout approvals.
 */
import { useEffect, useState, useCallback } from "react";
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import { Link } from "react-router-dom";
import { API } from "@/App";

const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const COST_BADGE = {
  under_control: { label: "Under control", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  warning:       { label: "Near limit",    cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  over_budget:   { label: "Over budget",   cls: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
};

const SUGGEST_TONE = {
  positive: "text-emerald-300 border-emerald-500/30 bg-emerald-500/5",
  warning:  "text-amber-300 border-amber-500/30 bg-amber-500/5",
};

export default function ClientCosts() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState({});

  const load = useCallback(async () => {
    try {
      const r = await runtime.get(`/api/client/costs`);
      setData(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const approvePayout = async (payoutId) => {
    setBusy((b) => ({ ...b, [payoutId]: true }));
    try {
      await runtime.post(`/api/admin/payouts/${payoutId}/approve`, {});
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || "Approval failed (project may be locked).");
    } finally {
      setBusy((b) => ({ ...b, [payoutId]: false }));
    }
  };

  const pauseModule = async (moduleId) => {
    setBusy((b) => ({ ...b, [moduleId]: true }));
    try {
      await runtime.post(`/api/modules/${moduleId}/pause`, {});
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || "Pause failed.");
    } finally {
      setBusy((b) => ({ ...b, [moduleId]: false }));
    }
  };

  if (err) return <div className="p-8 text-rose-400">Failed to load: {String(err)}</div>;
  if (!data) return <div className="p-8 text-muted-foreground">Loading costs…</div>;

  const { summary, projects } = data;

  return (
    <div className="min-h-screen bg-[var(--t-bg)] text-white">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">Cost Control</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Real-time view of what you're spending and earning.
            </p>
          </div>
          <div className="flex gap-2">
            <Link to="/client/operator" className="text-sm text-muted-foreground hover:text-white border border-border rounded-md px-3 py-1.5">
              Operator →
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <Kpi label="Revenue"  value={money(summary.revenue)} />
          <Kpi label="Committed cost" value={money(summary.committed_cost)} />
          <Kpi label="Paid out" value={money(summary.paid_out)} />
          <Kpi label="Profit"   value={money(summary.profit)} accent={summary.profit >= 0 ? "emerald" : "rose"} />
        </div>

        {projects.length === 0 && (
          <div className="text-muted-foreground">No projects yet.</div>
        )}

        <div className="space-y-6">
          {projects.map((p) => (
            <div key={p.project_id} className="rounded-xl border border-border bg-white/[0.02] p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-lg font-semibold">{p.project_title}</h2>
                  <div className="text-muted-foreground text-xs mt-0.5">
                    Revenue {money(p.revenue)} · Cost {money(p.cost)} · Paid {money(p.paid)}
                  </div>
                </div>
                <Link
                  to={`/client/project/${p.project_id}/workspace`}
                  className="text-xs border border-border rounded-md px-3 py-1.5 text-muted-foreground hover:text-white"
                >
                  Open workspace →
                </Link>
              </div>

              <div className="space-y-2">
                {p.modules.map((m) => {
                  const badge = COST_BADGE[m.cost_status] || COST_BADGE.under_control;
                  return (
                    <div key={m.module_id} className="rounded-lg border border-border bg-white/[0.02] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{m.module_title}</div>
                          <div className="text-muted-foreground text-xs mt-0.5">
                            Cost {money(m.cost)} · Earned {money(m.earned)} · Paid {money(m.paid)}
                          </div>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-md border ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </div>

                      <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full ${m.cost_status === "over_budget" ? "bg-rose-400" : m.cost_status === "warning" ? "bg-amber-400" : "bg-emerald-400"}`}
                          style={{ width: `${Math.min(100, Math.round((m.progress || 0) * 100))}%` }}
                        />
                      </div>

                      {m.system_suggestions?.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {m.system_suggestions.map((s) => (
                            <div key={s.action_id || s.type} className={`text-xs rounded-md border px-2 py-1 ${SUGGEST_TONE[s.tone] || "text-muted-foreground border-border"}`}>
                              {s.text}
                            </div>
                          ))}
                        </div>
                      )}

                      {(m.pending_payouts?.length > 0 || m.approved_payouts?.length > 0) && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {m.pending_payouts.map((po) => (
                            <button
                              key={po.payout_id}
                              disabled={!!busy[po.payout_id]}
                              onClick={() => approvePayout(po.payout_id)}
                              className="text-xs border border-emerald-500/40 text-emerald-300 rounded-md px-2 py-1 hover:bg-emerald-500/10 disabled:opacity-50"
                            >
                              Approve {money(po.amount)}
                            </button>
                          ))}
                          {m.approved_payouts.map((po) => (
                            <span key={po.payout_id} className="text-xs border border-border text-muted-foreground rounded-md px-2 py-1">
                              Approved {money(po.amount)}
                            </span>
                          ))}
                        </div>
                      )}

                      {m.status !== "paused" && m.cost_status !== "under_control" && (
                        <button
                          disabled={!!busy[m.module_id]}
                          onClick={() => pauseModule(m.module_id)}
                          className="mt-3 text-xs border border-rose-500/40 text-rose-300 rounded-md px-2 py-1 hover:bg-rose-500/10 disabled:opacity-50"
                        >
                          Pause module
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, accent }) {
  const color =
    accent === "emerald" ? "text-emerald-400" :
    accent === "rose"    ? "text-rose-400"    : "text-white";
  return (
    <div className="rounded-xl border border-border bg-white/[0.02] p-4">
      <div className="text-muted-foreground text-xs uppercase tracking-wider">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}
