import { AlertTriangle, AlertCircle, TrendingDown, ChevronRight } from 'lucide-react';

const SignalCard = ({ severity, title, message, metric, onAction, actionLabel }) => {
  const severityConfig = {
    critical: {
      bgColor: 'bg-[var(--danger-surface)]',
      borderColor: 'border-[var(--danger-border)]',
      iconColor: 'text-[var(--danger)]',
      textColor: 'text-[var(--danger-ink)]',
      icon: AlertTriangle
    },
    warning: {
      bgColor: 'bg-[var(--warning-surface)]',
      borderColor: 'border-[var(--warning-border)]',
      iconColor: 'text-[var(--warning)]',
      textColor: 'text-[var(--warning-ink)]',
      icon: AlertCircle
    },
    info: {
      bgColor: 'bg-[var(--info-surface)]',
      borderColor: 'border-[var(--info-border)]',
      iconColor: 'text-[var(--info)]',
      textColor: 'text-[var(--info-ink)]',
      icon: TrendingDown
    }
  };

  const config = severityConfig[severity] || severityConfig.info;
  const Icon = config.icon;

  return (
    <div className={`p-4 rounded-lg border ${config.bgColor} ${config.borderColor} border-l-[3px]`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 ${config.iconColor} mt-0.5 flex-shrink-0`} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${config.textColor} mb-1`}>{title}</p>
          <p className="text-sm text-[var(--text-admin-secondary)] mb-2">{message}</p>
          {metric !== undefined && (
            <p className="text-xs text-[var(--text-admin-muted)] font-mono mb-3">
              Metric: {metric}
            </p>
          )}
          {actionLabel && onAction && (
            <button 
              onClick={onAction}
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--info)] hover:underline"
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

const ProfitSignalsPanel = ({ signals = [], onNavigate }) => {
  if (signals.length === 0) {
    return (
      <div className="p-8 rounded-lg border border-[var(--border-admin)] bg-[var(--surface-admin-1)] text-center">
        <p className="text-sm text-[var(--text-admin-muted)]">No profit risk signals detected</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold tracking-tight text-[var(--text-admin)]">Profit Risk Signals</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {signals.slice(0, 6).map((signal, idx) => (
          <SignalCard 
            key={idx}
            severity={signal.severity}
            title={signal.message}
            message={signal.type.replace(/_/g, ' ')}
            metric={signal.metric_value ? `${signal.metric_value.toFixed(1)}${signal.type.includes('margin') || signal.type.includes('revision') ? '%' : ''}` : undefined}
            actionLabel={signal.action === 'inspect_project' ? 'Inspect Project' : signal.action === 'inspect_qa' ? 'Inspect QA' : 'View Details'}
            onAction={() => onNavigate && onNavigate(signal.project_id)}
          />
        ))}
      </div>
    </div>
  );
};

export default ProfitSignalsPanel;