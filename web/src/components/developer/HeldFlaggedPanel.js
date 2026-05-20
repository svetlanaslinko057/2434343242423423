import { AlertTriangle, AlertCircle } from 'lucide-react';

const HeldCard = ({ earning }) => {
  return (
    <div className="p-4 rounded-lg bg-surface-2 border border-danger/30 hover:border-danger/50 transition-colors">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <p className="text-sm font-medium text-text-primary mb-1">{earning.task_title}</p>
          <p className="text-xs text-text-muted">{earning.project_name}</p>
        </div>
        <span className="text-lg font-semibold font-mono text-text-primary">
          ${earning.final_earning?.toLocaleString() || '0'}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <AlertTriangle className="w-4 h-4 text-danger" />
        <p className="text-xs text-text-secondary">
          {earning.qa_severity ? `QA: ${earning.qa_severity} severity` : 'QA revision required'}
        </p>
      </div>
      {earning.qa_issue && (
        <p className="text-xs text-text-muted mt-2">{earning.qa_issue}</p>
      )}
    </div>
  );
};

const FlaggedCard = ({ earning }) => {
  return (
    <div className="p-4 rounded-lg bg-surface-2 border border-warning/30 hover:border-warning/50 transition-colors">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <p className="text-sm font-medium text-text-primary mb-1">{earning.task_title}</p>
          <p className="text-xs text-text-muted">{earning.project_name}</p>
        </div>
        <span className="text-lg font-semibold font-mono text-text-primary">
          ${earning.final_earning?.toLocaleString() || '0'}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <AlertCircle className="w-4 h-4 text-warning" />
        <p className="text-xs text-text-secondary">
          Confidence: {((earning.confidence_score || 0) * 100).toFixed(0)}%
        </p>
      </div>
      {earning.confidence_issue && (
        <p className="text-xs text-text-muted mt-2">{earning.confidence_issue}</p>
      )}
    </div>
  );
};

const HeldFlaggedPanel = ({ held = [], flagged = [] }) => {
  const hasIssues = held.length > 0 || flagged.length > 0;

  if (!hasIssues) {
    return null;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold tracking-tight text-text-primary">Issues Requiring Attention</h3>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Held by QA */}
        {held.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-danger" />
              <h4 className="text-xs uppercase tracking-[0.14em] text-text-muted font-semibold">
                Held by QA ({held.length})
              </h4>
            </div>
            <div className="space-y-2">
              {held.map((earning) => (
                <HeldCard key={earning.earning_id} earning={earning} />
              ))}
            </div>
          </div>
        )}

        {/* Flagged by Trust */}
        {flagged.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-warning" />
              <h4 className="text-xs uppercase tracking-[0.14em] text-text-muted font-semibold">
                Flagged by Trust ({flagged.length})
              </h4>
            </div>
            <div className="space-y-2">
              {flagged.map((earning) => (
                <FlaggedCard key={earning.earning_id} earning={earning} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default HeldFlaggedPanel;