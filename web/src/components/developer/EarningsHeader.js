import { DollarSign, Clock, Package, CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react';

const KPICard = ({ icon: Icon, label, amount, count, variant = 'default' }) => {
  const variants = {
    default: 'bg-surface-2 border-border',
    primary: 'bg-surface-2 border-primary/30',
    warning: 'bg-surface-2 border-warning/30',
    success: 'bg-surface-2 border-primary/30'
  };

  return (
    <div className={`rounded-xl border ${variants[variant]} p-6 transition-all hover:border-opacity-60`}>
      <div className="flex items-start justify-between mb-3">
        <div className="p-2 rounded-lg bg-surface">
          <Icon className="w-5 h-5 text-text-secondary" />
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-[0.14em] text-text-muted">{label}</p>
        <p className="text-3xl font-semibold tracking-tight text-text-primary">
          ${amount?.toLocaleString() || '0'}
        </p>
        <p className="text-sm text-text-secondary">{count || 0} task{count !== 1 ? 's' : ''}</p>
      </div>
    </div>
  );
};

const EarningsHeader = ({ summary }) => {
  const hasIssues = (summary?.held_count || 0) > 0 || (summary?.flagged_count || 0) > 0;

  return (
    <div className="space-y-4">
      {/* Main KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          icon={Clock}
          label="Pending QA"
          amount={summary?.pending_qa_amount || 0}
          count={summary?.pending_qa_count || 0}
          variant="default"
        />
        <KPICard
          icon={CheckCircle2}
          label="Approved"
          amount={summary?.approved_amount || 0}
          count={summary?.approved_count || 0}
          variant="success"
        />
        <KPICard
          icon={Package}
          label="In Batch"
          amount={summary?.batched_amount || 0}
          count={summary?.batched_count || 0}
          variant="primary"
        />
        <KPICard
          icon={DollarSign}
          label="Paid Total"
          amount={summary?.paid_total || 0}
          count={summary?.paid_count || 0}
          variant="default"
        />
      </div>

      {/* Issues Alert */}
      {hasIssues && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-surface-2 border border-warning/30">
          <AlertTriangle className="w-5 h-5 text-warning mt-0.5" />
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium text-text-primary">Attention Required</p>
            <p className="text-sm text-text-secondary">
              {summary?.held_count > 0 && (
                <span>{summary.held_count} earning{summary.held_count !== 1 ? 's' : ''} held due to QA revisions</span>
              )}
              {summary?.held_count > 0 && summary?.flagged_count > 0 && ', '}
              {summary?.flagged_count > 0 && (
                <span>{summary.flagged_count} earning{summary.flagged_count !== 1 ? 's' : ''} flagged for low confidence</span>
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default EarningsHeader;