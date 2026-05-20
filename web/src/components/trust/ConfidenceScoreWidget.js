import { ShieldCheck, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { useState } from 'react';

export const ConfidenceScoreWidget = ({ score, riskLevel, lastCalculated, breakdown, trend, delta24h, trendReason, onRecalculate }) => {
  const [loading, setLoading] = useState(false);

  const getStatusConfig = (score) => {
    if (score >= 85) return { label: 'Strong', color: 'hsl(var(--trust))', bgColor: 'hsl(var(--trust) / 0.1)', borderColor: 'hsl(var(--trust) / 0.3)' };
    if (score >= 70) return { label: 'Stable', color: 'hsl(var(--info))', bgColor: 'hsl(var(--info) / 0.1)', borderColor: 'hsl(var(--info) / 0.3)' };
    if (score >= 40) return { label: 'Watch', color: 'hsl(var(--risk))', bgColor: 'hsl(var(--risk) / 0.1)', borderColor: 'hsl(var(--risk) / 0.3)' };
    return { label: 'At Risk', color: 'hsl(var(--destructive))', bgColor: 'hsl(var(--destructive) / 0.1)', borderColor: 'hsl(var(--destructive) / 0.3)' };
  };

  const statusConfig = getStatusConfig(score);

  const handleRecalc = async () => {
    setLoading(true);
    try {
      await onRecalculate();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border rounded-lg p-5 bg-[hsl(var(--card))]" style={{ borderColor: statusConfig.borderColor }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5" style={{ color: statusConfig.color }} />
          <h3 className="text-sm font-medium text-white font-[var(--font-body)]">Project Health</h3>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-xs px-2 py-1 rounded-full font-medium"
            style={{ backgroundColor: statusConfig.bgColor, color: statusConfig.color }}
            data-testid="confidence-score-status-badge"
          >
            {statusConfig.label}
          </span>
          {onRecalculate && (
            <button
              onClick={handleRecalc}
              disabled={loading}
              className="p-1.5 hover:bg-muted rounded-md transition-colors"
              data-testid="confidence-recalculate-button"
              title="Recalculate score"
            >
              <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* Score */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div
              className="text-5xl font-semibold tabular-nums tracking-tight"
              style={{ fontFamily: 'var(--font-display)', color: statusConfig.color }}
              data-testid="confidence-score-value"
            >
              {score}
            </div>
            {trend && delta24h !== undefined && (
              <div className="flex flex-col items-center">
                {trend === 'up' ? (
                  <TrendingUp className="w-5 h-5 text-green-400" />
                ) : trend === 'down' ? (
                  <TrendingDown className="w-5 h-5 text-red-400" />
                ) : null}
                <div className={`text-xs font-medium tabular-nums ${
                  trend === 'up' ? 'text-green-400' : trend === 'down' ? 'text-red-400' : 'text-muted-foreground'
                }`}>
                  {delta24h > 0 ? '+' : ''}{delta24h}
                </div>
              </div>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-1" data-testid="confidence-score-last-updated">
            Last updated: {new Date(lastCalculated).toLocaleTimeString()}
          </div>
          {trendReason && (
            <div className="text-xs text-muted-foreground mt-1" data-testid="confidence-trend-reason">
              {trendReason}
            </div>
          )}
        </div>

        {/* Removed mock trend indicator - using real trend now */}
      </div>

      {/* Breakdown */}
      {breakdown && Object.keys(breakdown).length > 0 && (
        <div className="mt-4 pt-4 border-t border-border">
          <button
            className="text-xs text-muted-foreground hover:text-white transition-colors"
            data-testid="confidence-score-breakdown-button"
          >
            Why this score? →
          </button>
        </div>
      )}
    </div>
  );
};
