import { DollarSign, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';

const KPICard = ({ label, value, subtitle, icon: Icon, variant = 'default' }) => {
  const variants = {
    default: 'bg-[var(--surface-admin-2)] border-[var(--border-admin)]',
    success: 'bg-[var(--success-surface)] border-[var(--success-border)]',
    warning: 'bg-[var(--warning-surface)] border-[var(--warning-border)]',
    danger: 'bg-[var(--danger-surface)] border-[var(--danger-border)]',
    info: 'bg-[var(--info-surface)] border-[var(--info-border)]'
  };

  return (
    <div className={`rounded-xl border ${variants[variant]} p-6 transition-all hover:border-opacity-70`}>
      <div className="flex items-center justify-between mb-3">
        <div className="p-2 rounded-lg bg-[var(--surface-admin-1)]">
          <Icon className="w-5 h-5 text-[var(--text-admin-secondary)]" />
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-admin-muted)]">{label}</p>
        <p className="text-3xl font-semibold tracking-tight text-[var(--text-admin)] font-mono">
          {value}
        </p>
        <p className="text-sm text-[var(--text-admin-secondary)]">{subtitle}</p>
      </div>
    </div>
  );
};

const ProfitHeader = ({ overview }) => {
  const revenue = overview?.total_revenue || 0;
  const devCost = overview?.total_dev_cost || 0;
  const revisionCost = overview?.total_revision_cost || 0;
  const marginAbsolute = overview?.total_margin_absolute || 0;
  const marginPercent = overview?.total_margin_percent || 0;
  
  const atRiskCount = (overview?.project_risk_distribution?.warning || 0) + 
                      (overview?.project_risk_distribution?.danger || 0) + 
                      (overview?.project_risk_distribution?.critical || 0);

  // Margin variant based on percentage
  let marginVariant = 'success';
  if (marginPercent < 5) marginVariant = 'danger';
  else if (marginPercent < 20) marginVariant = 'warning';
  else if (marginPercent < 40) marginVariant = 'info';

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
      <KPICard
        icon={DollarSign}
        label="Revenue"
        value={`$${revenue.toLocaleString()}`}
        subtitle="Client payments received"
        variant="info"
      />
      <KPICard
        icon={TrendingDown}
        label="Dev Cost"
        value={`$${devCost.toLocaleString()}`}
        subtitle="Labor cost"
        variant="default"
      />
      <KPICard
        icon={AlertTriangle}
        label="Revision Cost"
        value={`$${revisionCost.toLocaleString()}`}
        subtitle="Quality overhead"
        variant="warning"
      />
      <KPICard
        icon={TrendingUp}
        label="Margin"
        value={`$${marginAbsolute.toLocaleString()} (${marginPercent.toFixed(1)}%)`}
        subtitle={marginPercent >= 40 ? 'Healthy' : marginPercent >= 20 ? 'Acceptable' : marginPercent >= 5 ? 'Low' : 'Critical'}
        variant={marginVariant}
      />
      <KPICard
        icon={AlertTriangle}
        label="At Risk Projects"
        value={atRiskCount}
        subtitle="Margin < 20%"
        variant={atRiskCount > 0 ? 'danger' : 'success'}
      />
    </div>
  );
};

export default ProfitHeader;