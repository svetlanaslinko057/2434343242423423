/**
 * HonestState — единый pattern для отображения состояний данных
 * (Этап 4 — Honest Runtime).
 *
 * Replaces:
 *   - hardcoded mock numbers
 *   - "Coming Soon" placeholders
 *   - fake "X% success" labels
 *
 * Usage:
 *   <HonestState
 *     state="empty"
 *     icon={DollarSign}
 *     title="No payout history yet"
 *     hint="First payout unlocks analytics"
 *   />
 *
 * State machine:
 *   loading  — data is being fetched (show skeleton)
 *   empty    — no data and no minimum activity reached
 *   beta     — feature gated until threshold (e.g. "after 3 modules")
 *   live     — real data, render children
 *   degraded — backend returned but with caveat (delays / partial)
 *   error    — fetch failed
 */

import { Loader2, Inbox, Sparkles, AlertTriangle, WifiOff } from 'lucide-react';

const stateConfig = {
  loading: { icon: Loader2, color: 'text-text-muted', label: 'Loading…', spin: true },
  empty:   { icon: Inbox, color: 'text-text-muted' },
  beta:    { icon: Sparkles, color: 'text-primary', badge: 'BETA' },
  degraded:{ icon: AlertTriangle, color: 'text-warning', badge: 'DELAYED' },
  error:   { icon: WifiOff, color: 'text-danger' },
};

export default function HonestState({
  state = 'empty',
  icon: CustomIcon,
  title,
  hint,
  className = '',
  compact = false,
}) {
  if (state === 'live') return null; // caller renders children

  const cfg = stateConfig[state] || stateConfig.empty;
  const Icon = CustomIcon || cfg.icon;

  if (compact) {
    return (
      <div className={`inline-flex items-center gap-2 text-xs ${cfg.color} ${className}`}>
        <Icon className={`w-3.5 h-3.5 ${cfg.spin ? 'animate-spin' : ''}`} />
        <span>{title || cfg.label || '—'}</span>
        {cfg.badge && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-current/10 border border-current/20">
            {cfg.badge}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`p-6 rounded-lg border border-border bg-surface text-center ${className}`}>
      <div className="flex items-center justify-center gap-2 mb-2">
        <Icon className={`w-8 h-8 mx-auto ${cfg.color} ${cfg.spin ? 'animate-spin' : ''}`} />
      </div>
      {cfg.badge && (
        <div className="inline-block px-2 py-0.5 mb-2 rounded text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
          {cfg.badge}
        </div>
      )}
      {title && <p className="text-sm text-text-secondary mb-1">{title}</p>}
      {hint && <p className="text-xs text-text-muted">{hint}</p>}
    </div>
  );
}
