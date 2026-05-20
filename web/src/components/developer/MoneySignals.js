import { AlertTriangle, AlertCircle, Info } from 'lucide-react';

const SignalCard = ({ severity, title, description, action }) => {
  const severityConfig = {
    high: {
      icon: AlertTriangle,
      bgColor: 'bg-danger/10',
      borderColor: 'border-danger/30',
      iconColor: 'text-danger',
      textColor: 'text-danger'
    },
    medium: {
      icon: AlertCircle,
      bgColor: 'bg-warning/10',
      borderColor: 'border-warning/30',
      iconColor: 'text-warning',
      textColor: 'text-warning'
    },
    low: {
      icon: Info,
      bgColor: 'bg-primary/10',
      borderColor: 'border-primary/30',
      iconColor: 'text-primary',
      textColor: 'text-primary'
    }
  };

  const config = severityConfig[severity] || severityConfig.low;
  const Icon = config.icon;

  return (
    <div className={`p-4 rounded-lg border ${config.bgColor} ${config.borderColor}`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 ${config.iconColor} mt-0.5 flex-shrink-0`} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${config.textColor} mb-1`}>{title}</p>
          <p className="text-sm text-text-secondary mb-2">{description}</p>
          {action && (
            <button className="text-xs font-medium text-primary hover:underline">
              {action}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const MoneySignals = ({ held, flagged, batches }) => {
  const signals = [];

  // Generate signals from data
  if (held && held.length > 0) {
    signals.push({
      severity: 'high',
      title: `${held.length} earning${held.length !== 1 ? 's' : ''} held due to QA revisions`,
      description: 'Complete QA fixes to release these earnings for approval',
      action: 'View held earnings →'
    });
  }

  if (flagged && flagged.length > 0) {
    signals.push({
      severity: 'medium',
      title: `${flagged.length} earning${flagged.length !== 1 ? 's' : ''} flagged due to low confidence`,
      description: 'Improve time tracking confidence to speed up approval',
      action: 'View flagged earnings →'
    });
  }

  if (batches && batches.length > 0) {
    const approvedBatch = batches.find(b => b.status === 'approved');
    if (approvedBatch) {
      signals.push({
        severity: 'low',
        title: `Batch #${approvedBatch.batch_id.slice(-4)} approved — payment expected soon`,
        description: `$${approvedBatch.total_amount.toLocaleString()} for ${approvedBatch.earnings_count} tasks`,
        action: null
      });
    }
  }

  if (signals.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold tracking-tight text-text-primary">Money Signals</h3>
      <div className="space-y-2">
        {signals.map((signal, idx) => (
          <SignalCard key={idx} {...signal} />
        ))}
      </div>
    </div>
  );
};

export default MoneySignals;