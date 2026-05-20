import { AlertTriangle, AlertCircle, TrendingUp, Package, DollarSign, ChevronRight } from 'lucide-react';

const SignalCard = ({ severity, icon: Icon, title, explanation, actionLabel, onAction }) => {
  const severityConfig = {
    high: {
      bgColor: 'bg-danger/10',
      borderColor: 'border-danger/30',
      iconColor: 'text-danger',
      textColor: 'text-danger'
    },
    medium: {
      bgColor: 'bg-warning/10',
      borderColor: 'border-warning/30',
      iconColor: 'text-warning',
      textColor: 'text-warning'
    },
    low: {
      bgColor: 'bg-primary/10',
      borderColor: 'border-primary/30',
      iconColor: 'text-primary',
      textColor: 'text-primary'
    },
    info: {
      bgColor: 'bg-surface-2',
      borderColor: 'border-border',
      iconColor: 'text-text-muted',
      textColor: 'text-text-secondary'
    }
  };

  const config = severityConfig[severity] || severityConfig.info;

  return (
    <div className={`p-4 rounded-lg border ${config.bgColor} ${config.borderColor}`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 ${config.iconColor} mt-0.5 flex-shrink-0`} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${config.textColor} mb-1`}>{title}</p>
          <p className="text-xs text-text-secondary mb-2">{explanation}</p>
          {actionLabel && onAction && (
            <button 
              onClick={onAction}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {actionLabel}
              <ChevronRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const RiskSignalsPanel = ({
  overview,
  heldCount,
  flaggedCount,
  flaggedEarnings = [],
  approvedBatchesNotPaid,
  onNavigate
}) => {
  const signals = [];

  // Generate signals from data
  const totalHeld = overview?.held_amount || 0;
  const totalFlagged = overview?.flagged_amount || 0;

  // Signal 1: Held earnings
  if (heldCount > 0 && totalHeld > 0) {
    signals.push({
      severity: 'high',
      icon: AlertTriangle,
      title: `${heldCount} earning${heldCount !== 1 ? 's' : ''} blocked by QA (total $${totalHeld.toLocaleString()})`,
      explanation: 'QA issues preventing payout approval',
      actionLabel: 'Open Held Queue',
      onAction: () => onNavigate('held')
    });
  }

  // Signal 2: Flagged earnings — derive avgConfidence from actual data
  // (Этап 4 — was hardcoded `const avgConfidence = 0.48`)
  if (flaggedCount > 0 && totalFlagged > 0) {
    const scores = flaggedEarnings
      .map(e => Number(e?.confidence_score))
      .filter(n => !Number.isNaN(n));
    const avgConfidence = scores.length > 0
      ? scores.reduce((s, n) => s + n, 0) / scores.length
      : null;
    signals.push({
      severity: 'high',
      icon: AlertCircle,
      title: avgConfidence !== null
        ? `${flaggedCount} low-confidence earning${flaggedCount !== 1 ? 's' : ''} (avg ${(avgConfidence * 100).toFixed(0)}%)`
        : `${flaggedCount} flagged earning${flaggedCount !== 1 ? 's' : ''} — confidence not yet computed`,
      explanation: 'Trust issues require manual review',
      actionLabel: 'Review Flagged',
      onAction: () => onNavigate('flagged')
    });
  }

  // Signal 3: Approved but not paid batches
  if (approvedBatchesNotPaid > 0) {
    signals.push({
      severity: 'medium',
      icon: Package,
      title: `${approvedBatchesNotPaid} batch${approvedBatchesNotPaid !== 1 ? 'es' : ''} approved but not paid`,
      explanation: 'Pending payment execution',
      actionLabel: 'Open Batch Manager',
      onAction: () => onNavigate('batches')
    });
  }

  // Signal 4: Revision cost — only show when backend exposes real numbers.
  // (Этап 4 — was hardcoded `revisionCostPct = 18, revisionCostChange = 6`).
  // overview.revision_cost_pct and overview.revision_cost_change come from
  // /api/admin/earnings/overview when enough delivery history exists.
  const revPct = Number(overview?.revision_cost_pct);
  const revDelta = Number(overview?.revision_cost_change);
  if (!Number.isNaN(revPct) && revPct > 10) {
    const deltaLabel = !Number.isNaN(revDelta)
      ? ` (${revDelta >= 0 ? '+' : ''}${revDelta}%)`
      : '';
    signals.push({
      severity: 'medium',
      icon: TrendingUp,
      title: `Revision cost increased to ${revPct}%${deltaLabel}`,
      explanation: 'Quality issues impacting development costs',
      actionLabel: null,
      onAction: null
    });
  }

  // Signal 5: High approved amount ready
  const approvedAmount = overview?.approved_amount || 0;
  if (approvedAmount > 1000 && heldCount === 0 && flaggedCount === 0) {
    signals.push({
      severity: 'low',
      icon: DollarSign,
      title: `$${approvedAmount.toLocaleString()} ready for batching`,
      explanation: 'No blockers, ready to create payout batches',
      actionLabel: 'Open Ready Queue',
      onAction: () => onNavigate('ready')
    });
  }

  // If no signals, show all clear
  if (signals.length === 0) {
    signals.push({
      severity: 'info',
      icon: DollarSign,
      title: 'All earnings on track',
      explanation: 'No critical issues detected in payout pipeline',
      actionLabel: null,
      onAction: null
    });
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold tracking-tight text-text-primary">Risk Signals</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {signals.slice(0, 6).map((signal, idx) => (
          <SignalCard key={idx} {...signal} />
        ))}
      </div>
    </div>
  );
};

export default RiskSignalsPanel;