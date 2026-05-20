/**
 * Block 10.0 — Developer Work Hub  (GET /api/dev/work)
 *
 * Single pane a developer opens to answer:
 *   - what do I do RIGHT NOW?
 *   - what's blocked?
 *   - what's in QA?
 *   - how much am I earning?
 *
 * No extra trips. 1 API call → everything.
 */
import { useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { API } from "@/App";

const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const RANK_STYLE = {
  A: { ring: "ring-emerald-500/40", text: "text-emerald-300" },
  B: { ring: "ring-signal/40",     text: "text-signal"     },
  C: { ring: "ring-amber-500/40",   text: "text-amber-300"   },
  D: { ring: "ring-rose-500/40",    text: "text-rose-300"    },
};

export default function DevWork() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let active = true;
    axios
      .get(`${API}/dev/work`, { withCredentials: true })
      .then((r) => active && setData(r.data))
      .catch((e) => active && setErr(e?.response?.data?.detail || e.message));
    return () => { active = false; };
  }, []);

  if (err)   return <div className="min-h-screen bg-[var(--t-bg)] text-rose-400 p-8">Failed: {String(err)}</div>;
  if (!data) return <div className="min-h-screen bg-[var(--t-bg)] text-muted-foreground p-8">Loading work hub…</div>;

  const rs = RANK_STYLE[data.developer.rank] || RANK_STYLE.C;

  return (
    <div className="min-h-screen bg-[var(--t-bg)] text-white">
      <div className="max-w-5xl mx-auto px-6 py-10">

        {/* HEADER */}
        <div className="flex items-start justify-between mb-8 gap-4">
          <div className="min-w-0">
            <div className="text-muted-foreground text-xs uppercase tracking-wider">Workspace</div>
            <h1 className="text-2xl font-bold mt-1">
              {data.developer.name}
            </h1>
            <div className="mt-1 text-muted-foreground text-sm">{data.headline}</div>
          </div>
          <div className={`flex items-center gap-3 rounded-xl border border-border bg-white/[0.03] px-3 py-2 ring-1 ${rs.ring}`}>
            <div className="text-center">
              <div className={`text-2xl font-bold tabular-nums ${rs.text}`}>{data.developer.rank}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Rank</div>
            </div>
            <div className="text-center">
              <div className="text-sm font-medium tabular-nums">
                {Math.round((data.developer.quality_score || 0) * 100)}%
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Quality</div>
            </div>
            <div className="text-center">
              <div className="text-sm font-medium tabular-nums">
                {Math.round((data.developer.reliability_score || 0) * 100)}%
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Reliability</div>
            </div>
          </div>
        </div>

        {/* EARNINGS STRIP */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <Kpi label="Paid"    value={money(data.summary.paid)}    tone="white"  />
          <Kpi label="Earned"  value={money(data.summary.earned)}  tone="emerald"
               hint="paid + approved" />
          <Kpi label="Pending" value={money(data.summary.pending)} tone="amber"
               hint="awaiting approval" />
          <Kpi label="Active"  value={`${data.summary.active_count}`} tone="white"
               hint={`${data.summary.qa_count} in QA · ${data.summary.blocked_count} blocked`} />
        </div>

        {/* TWO COLS: main buckets + available */}
        <div className="grid lg:grid-cols-3 gap-6">

          <div className="lg:col-span-2 space-y-6">
            <Bucket
              title="Do now"
              count={data.active.length}
              accent="emerald"
              emptyText="No active tasks. Pick one from Available."
              rows={data.active}
              showProgress
            />
            <Bucket
              title="In QA"
              count={data.qa.length}
              accent="sky"
              emptyText="Nothing in review."
              rows={data.qa}
            />
            <Bucket
              title="Blocked"
              count={data.blocked.length}
              accent="rose"
              emptyText="Nothing blocked. 🎯"
              rows={data.blocked}
              showPauseCause
            />
          </div>

          {/* SIDE: available marketplace */}
          <div className="space-y-5">
            <div>
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-muted-foreground text-xs uppercase tracking-wider">Available</div>
                <div className="text-muted-foreground text-xs">{data.summary.available_count} open</div>
              </div>
              {data.available.length === 0 ? (
                <div className="text-muted-foreground text-sm">Marketplace empty right now.</div>
              ) : (
                <div className="space-y-2">
                  {data.available.map((m) => (
                    <div key={m.module_id}
                         className="rounded-lg border border-border bg-white/[0.02] p-3">
                      <div className="text-sm font-medium truncate">{m.module_title}</div>
                      <div className="text-muted-foreground text-xs mt-0.5 truncate">
                        {m.project_title || "—"}
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-emerald-300 text-sm font-semibold tabular-nums">
                          up to {money(m.budget)}
                        </span>
                        <Link
                          to={`/developer/marketplace`}
                          className="text-xs border border-emerald-500/40 text-emerald-300 rounded-md px-2 py-1 hover:bg-emerald-500/10"
                        >
                          Claim
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* subdued deep links */}
            <div className="pt-2 text-xs space-y-1 text-muted-foreground border-t border-border">
              <div className="uppercase tracking-wider text-muted-foreground mb-1">Go deeper</div>
              <Link to="/developer/earnings" className="block hover:text-muted-foreground">Earnings history</Link>
              <Link to="/developer/performance" className="block hover:text-muted-foreground">Performance</Link>
              <Link to="/developer/marketplace" className="block hover:text-muted-foreground">Full marketplace</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone, hint }) {
  const color =
    tone === "emerald" ? "text-emerald-400" :
    tone === "amber"   ? "text-amber-400"   :
    tone === "rose"    ? "text-rose-400"    : "text-white";
  return (
    <div className="rounded-xl border border-border bg-white/[0.02] p-4">
      <div className="text-muted-foreground text-xs uppercase tracking-wider">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint && <div className="text-muted-foreground text-[11px] mt-0.5">{hint}</div>}
    </div>
  );
}

function Bucket({ title, count, accent, emptyText, rows, showProgress, showPauseCause }) {
  const dot =
    accent === "emerald" ? "bg-emerald-400" :
    accent === "sky"     ? "bg-signal"     :
    accent === "rose"    ? "bg-rose-400"    : "bg-muted";
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <div className="text-muted-foreground text-xs uppercase tracking-wider">{title}</div>
        <div className="text-muted-foreground text-xs tabular-nums">· {count}</div>
      </div>
      {rows.length === 0 ? (
        <div className="text-muted-foreground text-sm italic">{emptyText}</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Link
              key={r.module_id}
              to={`/developer/work/${r.module_id}`}
              className="block rounded-lg border border-border bg-white/[0.02] p-3 hover:bg-white/[0.04]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{r.module_title}</div>
                  <div className="text-muted-foreground text-xs mt-0.5 truncate">
                    {r.project_title || "—"}
                    {showPauseCause && r.paused_by_system && (
                      <span className="ml-2 text-amber-400">paused by system</span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-emerald-300 text-sm font-semibold tabular-nums">
                    {money(r.budget)}
                  </div>
                  {r.pending > 0 && (
                    <div className="text-amber-400 text-xs tabular-nums">
                      +{money(r.pending)} pending
                    </div>
                  )}
                </div>
              </div>
              {showProgress && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-400" style={{ width: `${r.progress_pct}%` }} />
                  </div>
                  <div className="text-xs text-muted-foreground w-10 text-right tabular-nums">
                    {r.progress_pct}%
                  </div>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
