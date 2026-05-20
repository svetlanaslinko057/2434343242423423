import { Package, CheckCircle2, DollarSign, Clock, AlertTriangle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const BatchCard = ({ batch, onApprove, onMarkPaid, onClick }) => {
  const statusConfig = {
    draft: { 
      label: 'Draft', 
      className: 'bg-surface-2 text-text-secondary border-border', 
      icon: Clock,
      canApprove: true,
      canMarkPaid: false
    },
    approved: { 
      label: 'Approved', 
      className: 'bg-primary/10 text-primary border-primary/30', 
      icon: CheckCircle2,
      canApprove: false,
      canMarkPaid: true
    },
    paid: { 
      label: 'Paid', 
      className: 'bg-success/10 text-success border-success/30', 
      icon: DollarSign,
      canApprove: false,
      canMarkPaid: false
    }
  };

  const config = statusConfig[batch.status] || statusConfig.draft;
  const StatusIcon = config.icon;

  return (
    <div 
      className="p-4 rounded-lg bg-surface-2 border border-border hover:border-primary/30 transition-colors cursor-pointer"
      onClick={() => onClick && onClick(batch)}
    >
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

      <div className="space-y-2 mb-3">
        <p className="text-sm font-medium text-text-primary">{batch.user_name || 'Unknown'}</p>
        <p className="text-2xl font-semibold font-mono text-text-primary">
          ${batch.total_amount?.toLocaleString() || '0'}
        </p>
        <div className="flex items-center justify-between text-xs text-text-secondary">
          <span>{batch.earnings_count || 0} earning{batch.earnings_count !== 1 ? 's' : ''}</span>
          {batch.period_start && (
            <span>{new Date(batch.period_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          )}
        </div>
      </div>

      {/* Low Confidence Warning */}
      {batch.low_confidence_count > 0 && (
        <div className="flex items-center gap-2 p-2 rounded bg-warning/10 border border-warning/30 mb-3">
          <AlertTriangle className="w-3 h-3 text-warning" />
          <span className="text-xs text-warning">
            {batch.low_confidence_count} low-confidence earning{batch.low_confidence_count !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {config.canApprove && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onApprove(batch);
            }}
            className="flex-1 px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-xs font-medium"
          >
            Approve Batch
          </button>
        )}
        {config.canMarkPaid && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMarkPaid(batch);
            }}
            className="flex-1 px-3 py-2 rounded-lg bg-success text-success-foreground hover:bg-success/90 transition-colors text-xs font-medium"
          >
            Mark Paid
          </button>
        )}
        {batch.approved_at && (
          <p className="text-xs text-text-muted">
            Approved {formatDistanceToNow(new Date(batch.approved_at), { addSuffix: true })}
          </p>
        )}
        {batch.paid_at && (
          <p className="text-xs text-text-muted">
            Paid {formatDistanceToNow(new Date(batch.paid_at), { addSuffix: true })}
          </p>
        )}
      </div>
    </div>
  );
};

const BatchSection = ({ title, batches, emptyMessage, onApprove, onMarkPaid, onBatchClick }) => {
  return (
    <div className="space-y-3">
      <h4 className="text-xs uppercase tracking-[0.14em] text-text-muted font-semibold">{title}</h4>
      {batches.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-sm text-text-muted">{emptyMessage}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {batches.map((batch) => (
            <BatchCard 
              key={batch.batch_id} 
              batch={batch} 
              onApprove={onApprove}
              onMarkPaid={onMarkPaid}
              onClick={onBatchClick}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const BatchManager = ({ batches = [], onApprove, onMarkPaid, onBatchClick }) => {
  const draftBatches = batches.filter(b => b.status === 'draft');
  const approvedBatches = batches.filter(b => b.status === 'approved');
  const paidBatches = batches.filter(b => b.status === 'paid');

  return (
    <div className="space-y-6">
      <BatchSection 
        title="Draft Batches"
        batches={draftBatches}
        emptyMessage="No draft batches yet"
        onApprove={onApprove}
        onBatchClick={onBatchClick}
      />
      
      <BatchSection 
        title="Approved Batches"
        batches={approvedBatches}
        emptyMessage="No approved batches awaiting payment"
        onMarkPaid={onMarkPaid}
        onBatchClick={onBatchClick}
      />
      
      <BatchSection 
        title="Paid Batches"
        batches={paidBatches}
        emptyMessage="No paid batches this period"
        onBatchClick={onBatchClick}
      />
    </div>
  );
};

export default BatchManager;