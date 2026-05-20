import { AlertTriangle, ExternalLink, Clock } from 'lucide-react';

const SeverityBadge = ({ severity }) => {
  const config = {
    high: { label: 'HIGH SEVERITY', className: 'bg-danger/20 text-danger border-danger/50' },
    medium: { label: 'MEDIUM', className: 'bg-warning/20 text-warning border-warning/50' },
    low: { label: 'LOW', className: 'bg-surface-2 text-text-secondary border-border' }
  };

  const severityConfig = config[severity] || config.medium;

  return (
    <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-semibold uppercase tracking-wider border ${severityConfig.className}`}>
      {severityConfig.label}
    </span>
  );
};

const HeldEarningCard = ({ earning, onOpenQA }) => {
  const revisionCost = (earning.revision_hours || 0) * 20; // Assuming $20/hr avg
  const estimatedLoss = revisionCost;

  return (
    <div className="p-4 rounded-lg bg-surface-2 border-l-4 border-danger hover:bg-surface-hover transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-danger" />
            <SeverityBadge severity={earning.qa_severity || 'medium'} />
          </div>
          <p className="text-base font-semibold text-text-primary mb-1">{earning.user_name}</p>
          <p className="text-sm text-text-primary mb-1">{earning.task_title}</p>
          <p className="text-xs text-text-muted">{earning.project_name}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold font-mono text-text-primary">
            ${earning.final_earning?.toLocaleString() || '0'}
          </p>
        </div>
      </div>

      <div className="space-y-2 mb-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-secondary">Reason:</span>
          <span className="text-text-primary font-medium">{earning.qa_issue || 'QA revision required'}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-secondary">Revision:</span>
          <span className="text-text-primary">{(earning.revision_hours || 0).toFixed(1)}h</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-secondary">Iteration:</span>
          <span className="text-text-primary">{earning.iteration || 1}</span>
        </div>
        {estimatedLoss > 0 && (
          <div className="flex items-center justify-between text-sm pt-2 border-t border-border">
            <span className="text-text-secondary">Estimated loss:</span>
            <span className="text-danger font-semibold">${estimatedLoss.toFixed(0)}</span>
          </div>
        )}
      </div>

      <button
        onClick={() => onOpenQA && onOpenQA(earning)}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-surface border border-border hover:border-primary/30 transition-colors text-sm font-medium text-text-primary"
      >
        <ExternalLink className="w-4 h-4" />
        Open QA History
      </button>
    </div>
  );
};

const HeldQueue = ({ heldEarnings = [], onOpenQA }) => {
  const totalHeld = heldEarnings.reduce((sum, e) => sum + (e.final_earning || 0), 0);
  const totalRevisionCost = heldEarnings.reduce((sum, e) => ((e.revision_hours || 0) * 20), 0);

  if (heldEarnings.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-12 text-center">
        <AlertTriangle className="w-12 h-12 text-text-muted mx-auto mb-3" />
        <p className="text-text-primary font-medium mb-1">No earnings blocked by QA</p>
        <p className="text-sm text-text-muted">Held earnings will appear here when QA issues are detected</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Bar */}
      <div className="flex items-center gap-4 p-4 rounded-lg bg-danger/10 border border-danger/30">
        <AlertTriangle className="w-5 h-5 text-danger" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-danger">
            {heldEarnings.length} earning{heldEarnings.length !== 1 ? 's' : ''} blocked by QA
          </p>
          <p className="text-xs text-text-secondary mt-1">
            Total held: ${totalHeld.toLocaleString()} · Est. revision cost: ${totalRevisionCost.toFixed(0)}
          </p>
        </div>
      </div>

      {/* Held Earnings Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {heldEarnings.map((earning) => (
          <HeldEarningCard key={earning.earning_id} earning={earning} onOpenQA={onOpenQA} />
        ))}
      </div>
    </div>
  );
};

export default HeldQueue;