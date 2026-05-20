/**
 * Block 8 — Client Operator Mode  (GET /api/client/operator)
 * Portfolio-level risk view with per-project action bar.
 */
import { useEffect, useState, useCallback } from "react";
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import { Link } from "react-router-dom";
import { API } from "@/App";
import ProfitOpportunities from "@/components/client/ProfitOpportunities";

const RISK = {
  healthy: { label: "Healthy",  dot: "bg-emerald-400", ring: "ring-emerald-500/20" },
  watch:   { label: "Watch",    dot: "bg-signal",     ring: "ring-signal/20"     },
  at_risk: { label: "At risk",  dot: "bg-amber-400",   ring: "ring-amber-500/20"   },
  blocked: { label: "Blocked",  dot: "bg-rose-400",    ring: "ring-rose-500/20"    },
};

const TONE = {
  positive: "text-emerald-300",
  warning:  "text-amber-300",
  neutral:  "text-muted-foreground",
};

export default function ClientOperator() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState({});

  const load = useCallback(async () => {
    try {
      const r = await runtime.get(`/api/client/operator`);
      setData(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const doAction = async (projectId, action) => {
    setBusy((b) => ({ ...b, [projectId]: action }));
    try {
      await runtime.post(`/api/client/operator/${projectId}/action`,
                       { action });
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || "Action failed.");
    } finally {
      setBusy((b) => ({ ...b, [projectId]: null }));
    }
  };

  if (err) return <div className="p-8 text-rose-400">Failed: {String(err)}</div>;
  if (!data) return <div className="p-8 text-muted-foreground">Loading operator…</div>;

  return (
    <div className="min-h-screen bg-[var(--t-bg)] text-white">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">Operator</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Portfolio-level view of project risk.
            </p>
          </div>
          <Link to="/client/costs" className="text-sm text-muted-foreground hover:text-white border border-border rounded-md px-3 py-1.5">
            Costs →
          </Link>
        </div>

        <div className="grid grid-cols-4 gap-3 mb-8">
          {Object.entries(RISK).map(([k, v]) => (
            <div key={k} className="rounded-xl border border-border bg-white/[0.02] p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
                <span className={`w-2 h-2 rounded-full ${v.dot}`} />
                {v.label}
              </div>
              <div className="mt-1 text-2xl font-semibold">{data.summary?.[k] ?? 0}</div>
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {data.projects.length === 0 && <div className="text-muted-foreground">No projects.</div>}

            {data.projects.map((p) => {
              const risk = RISK[p.risk_state] || RISK.healthy;
              return (
                <div key={p.project_id} className={`rounded-xl border border-border bg-white/[0.02] p-5 ring-1 ${risk.ring}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link to={`/client/project/${p.project_id}/workspace`} className="font-semibold hover:underline">
                        {p.project_title}
                      </Link>
                      <div className="text-muted-foreground text-xs mt-0.5">{p.headline}</div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-border">
                      <span className={`w-1.5 h-1.5 rounded-full ${risk.dot}`} />
                      {risk.label}
                    </span>
                  </div>

                  {p.lock_approvals && (
                    <div className="mt-3 text-xs text-rose-300 border border-rose-500/30 bg-rose-500/10 rounded-md px-2 py-1.5">
                      🔒 Payouts locked — {p.lock_reason}
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {p.can.pause_project && (
                      <button
                        disabled={busy[p.project_id] === "pause"}
                        onClick={() => doAction(p.project_id, "pause")}
                        className="text-xs border border-border rounded-md px-2 py-1 text-muted-foreground hover:text-white disabled:opacity-50"
                      >
                        {busy[p.project_id] === "pause" ? "Pausing…" : "Pause project"}
                      </button>
                    )}
                    {p.can.resume_project && (
                      <button
                        disabled={busy[p.project_id] === "resume"}
                        onClick={() => doAction(p.project_id, "resume")}
                        className="text-xs border border-border rounded-md px-2 py-1 text-muted-foreground hover:text-white disabled:opacity-50"
                      >
                        {busy[p.project_id] === "resume" ? "Resuming…" : "Resume"}
                      </button>
                    )}
                    <button
                      disabled={busy[p.project_id] === "request_review"}
                      onClick={() => doAction(p.project_id, "request_review")}
                      className="text-xs border border-border rounded-md px-2 py-1 text-muted-foreground hover:text-white disabled:opacity-50"
                    >
                      {busy[p.project_id] === "request_review" ? "Sent" : "Request review"}
                    </button>
                    <Link
                      to={`/client/project/${p.project_id}/workspace`}
                      className="text-xs border border-emerald-500/30 text-emerald-300 rounded-md px-2 py-1 hover:bg-emerald-500/10"
                    >
                      Open workspace →
                    </Link>
                  </div>

                  {p.actions.length > 0 && (
                    <div className="mt-4 border-t border-border pt-3 space-y-1.5">
                      <div className="text-muted-foreground text-xs uppercase tracking-wider">System activity</div>
                      {p.actions.slice(0, 5).map((a) => (
                        <div key={a.id || `${a.type}-${a.created_at}`} className="text-sm flex gap-2">
                          <span className={TONE[a.tone] || "text-muted-foreground"}>•</span>
                          <span className="text-muted-foreground">{a.reason || a.type}</span>
                          {a.module_title && <span className="text-muted-foreground">· {a.module_title}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="rounded-xl border border-border bg-white/[0.02] p-4">
            <div className="text-muted-foreground text-xs uppercase tracking-wider mb-3">Profit opportunities</div>
            <ProfitOpportunities />
          </div>
        </div>
      </div>
    </div>
  );
}
