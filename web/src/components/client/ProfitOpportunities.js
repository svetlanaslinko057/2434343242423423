/**
 * Block 8.2 / 8.2.1 — Profit Opportunities panel (safety-aware).
 *
 * Reads   GET /api/client/operator/opportunities
 * Renders compact cards ranked by weighted_score (impact × confidence)
 * and annotated with safety_level badge (safe / caution / risky).
 *
 * READ-ONLY — no buttons fire anything on the server.
 */
import { useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";

const TYPE_LABELS = {
  overpaying:    { icon: "💸", label: "Overpaying"      },
  underutilized: { icon: "⚡", label: "Underutilized"   },
  slow_delivery: { icon: "🐢", label: "Slow delivery"   },
  bottleneck:    { icon: "🚧", label: "Bottleneck"      },
};

const SAFETY_STYLES = {
  safe:    { dot: "bg-emerald-400", text: "text-emerald-300", border: "border-emerald-500/30" },
  caution: { dot: "bg-amber-400",   text: "text-amber-300",   border: "border-amber-500/30"   },
  risky:   { dot: "bg-rose-400",    text: "text-rose-300",    border: "border-rose-500/30"    },
};

export default function ProfitOpportunities({ compact = false, limit }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let active = true;
    axios
      .get(`${API}/client/operator/opportunities`, { withCredentials: true })
      .then((r) => active && setData(r.data))
      .catch((e) => active && setErr(e?.response?.data?.detail || e.message));
    return () => { active = false; };
  }, []);

  if (err)   return <div className="text-rose-400 text-sm">Failed: {String(err)}</div>;
  if (!data) return <div className="text-muted-foreground text-sm">Loading opportunities…</div>;

  const rows = limit ? data.opportunities.slice(0, limit) : data.opportunities;
  if (!rows.length) {
    return (
      <div className="text-muted-foreground text-sm">
        No profit opportunities detected. System will keep watching.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {!compact && (
        <div className="flex items-baseline justify-between">
          <div className="text-muted-foreground text-xs uppercase tracking-wider">
            Profit opportunities · {data.summary.total}
          </div>
          {data.summary.total_potential_profit > 0 && (
            <div className="text-emerald-400 text-sm font-semibold">
              +${data.summary.total_potential_profit} potential
            </div>
          )}
        </div>
      )}

      {rows.map((o, i) => {
        const t = TYPE_LABELS[o.type] || { icon: "💡", label: o.type };
        const s = SAFETY_STYLES[o.safety_level] || SAFETY_STYLES.risky;
        return (
          <div
            key={`${o.type}-${i}`}
            className={`rounded-lg border ${s.border} bg-white/[0.03] p-3
                        flex items-start gap-3`}
          >
            <div className="text-xl leading-none">{t.icon}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-semibold text-white">{t.label}</span>
                {o.module_title && (
                  <span className="text-muted-foreground truncate">· {o.module_title}</span>
                )}
              </div>
              <div className="text-emerald-400 text-sm font-medium mt-0.5">
                {o.impact}
              </div>
              {o.reason && (
                <div className="text-muted-foreground text-xs mt-1 leading-snug">{o.reason}</div>
              )}
              <div className="flex items-center gap-3 mt-2 text-xs">
                <span className={`inline-flex items-center gap-1.5 ${s.text}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                  {o.safety_level}
                </span>
                <span className="text-muted-foreground">
                  confidence {Math.round((o.confidence || 0) * 100)}%
                </span>
                {o.auto_applicable && (
                  <span className="text-emerald-400/80">auto-applicable</span>
                )}
              </div>
              {o.suggested_action && !compact && (
                <div className="text-muted-foreground text-xs mt-1 italic">
                  → {o.suggested_action}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
