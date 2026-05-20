import { AlertCircle, Shield } from 'lucide-react';

const ConfidenceBadge = ({ score }) => {
  let config;
  if (score >= 0.7) {
    config = { className: 'bg-primary/20 text-primary border-primary/50', label: 'ACCEPTABLE' };
  } else if (score >= 0.5) {
    config = { className: 'bg-warning/20 text-warning border-warning/50', label: 'LOW TRUST' };
  } else {
    config = { className: 'bg-danger/20 text-danger border-danger/50', label: 'VERY LOW' };
  }

  return (
    <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-semibold uppercase tracking-wider border ${config.className}`}>
      {config.label}
    </span>
  );
};

const FlaggedEarningCard = ({ earning, onReview }) => {
  const confidenceScore = earning.confidence_score || 0;
  const manualRatio = earning.manual_ratio || 0;

  return (
    <div className="p-4 rounded-lg bg-surface-2 border-l-4 border-warning hover:bg-surface-hover transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-warning" />
            <ConfidenceBadge score={confidenceScore} />
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
          <span className="text-text-secondary">Confidence:</span>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-24 bg-surface rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all ${
                  confidenceScore >= 0.7 ? 'bg-primary' : 
                  confidenceScore >= 0.5 ? 'bg-warning' : 'bg-danger'
                }`}
                style={{ width: `${confidenceScore * 100}%` }}
              />
            </div>
            <span className={`text-xs font-mono font-semibold ${
              confidenceScore >= 0.7 ? 'text-primary' :
              confidenceScore >= 0.5 ? 'text-warning' : 'text-danger'
            }`}>
              {(confidenceScore * 100).toFixed(0)}%
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-secondary">Issue:</span>
          <span className="text-text-primary font-medium">{earning.confidence_issue || 'manual_heavy'}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-secondary">Manual ratio:</span>
          <span className="text-text-primary">{(manualRatio * 100).toFixed(0)}%</span>
        </div>
        <div className="flex items-start justify-between text-sm pt-2 border-t border-border">
          <span className="text-text-secondary">Risk:</span>
          <span className="text-warning text-right font-medium text-xs leading-tight">
            Payout requires manual verification
          </span>
        </div>
      </div>

      <button
        onClick={() => onReview && onReview(earning)}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-warning/20 border border-warning/30 hover:bg-warning/30 transition-colors text-sm font-medium text-warning"
      >
        <Shield className="w-4 h-4" />
        Review
      </button>
    </div>
  );
};

const FlaggedQueue = ({ flaggedEarnings = [], onReview }) => {
  const totalFlagged = flaggedEarnings.reduce((sum, e) => sum + (e.final_earning || 0), 0);
  const avgConfidence = flaggedEarnings.length > 0
    ? flaggedEarnings.reduce((sum, e) => sum + (e.confidence_score || 0), 0) / flaggedEarnings.length
    : 0;

  if (flaggedEarnings.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-12 text-center">
        <Shield className="w-12 h-12 text-text-muted mx-auto mb-3" />
        <p className="text-text-primary font-medium mb-1">No low-confidence earnings requiring review</p>
        <p className="text-sm text-text-muted">Flagged earnings will appear here when trust issues are detected</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Bar */}
      <div className="flex items-center gap-4 p-4 rounded-lg bg-warning/10 border border-warning/30">
        <AlertCircle className="w-5 h-5 text-warning" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-warning">
            {flaggedEarnings.length} low-confidence earning{flaggedEarnings.length !== 1 ? 's' : ''} flagged
          </p>
          <p className="text-xs text-text-secondary mt-1">
            Total flagged: ${totalFlagged.toLocaleString()} · Avg confidence: {(avgConfidence * 100).toFixed(0)}%
          </p>
        </div>
      </div>

      {/* Flagged Earnings Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {flaggedEarnings.map((earning) => (
          <FlaggedEarningCard key={earning.earning_id} earning={earning} onReview={onReview} />
        ))}
      </div>
    </div>
  );
};

export default FlaggedQueue;