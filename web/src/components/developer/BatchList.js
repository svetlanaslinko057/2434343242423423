import { Package, CheckCircle2, Clock, DollarSign } from 'lucide-react';

const BatchCard = ({ batch }) => {
  const statusConfig = {
    draft: { label: 'Draft', className: 'bg-surface-2 text-text-secondary border-border', icon: Clock },
    approved: { label: 'Approved', className: 'bg-primary/10 text-primary border-primary/30', icon: CheckCircle2 },
    paid: { label: 'Paid', className: 'bg-success/10 text-success border-success/30', icon: DollarSign }
  };

  const config = statusConfig[batch.status] || statusConfig.draft;
  const StatusIcon = config.icon;

  return (
    <div className="p-4 rounded-lg bg-surface-2 border border-border hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-text-muted" />
          <span className="text-xs font-mono text-text-muted">#{batch.batch_id?.slice(-8)}</span>
        </div>
        <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border ${config.className}`}>
          <StatusIcon className="w-3 h-3" />
          {config.label}
        </div>
      </div>
      <p className="text-2xl font-semibold font-mono text-text-primary mb-2">
        ${batch.total_amount?.toLocaleString() || '0'}
      </p>
      <div className="flex items-center justify-between text-xs text-text-secondary">
        <span>{batch.earnings_count || 0} task{batch.earnings_count !== 1 ? 's' : ''}</span>
        {batch.period_start && (
          <span>{new Date(batch.period_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        )}
      </div>
    </div>
  );
};

const BatchList = ({ batches = [] }) => {
  if (batches.length === 0) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <Package className="w-8 h-8 text-text-muted mx-auto mb-2" />
        <p className="text-sm text-text-muted">No payout batches yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold tracking-tight text-text-primary">Payout Batches</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {batches.map((batch) => (
          <BatchCard key={batch.batch_id} batch={batch} />
        ))}
      </div>
    </div>
  );
};

export default BatchList;