import { useState } from 'react';
import { ChevronDown, ChevronRight, Package, Calendar } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const DeveloperRow = ({ developer, onCreateBatch }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border rounded-lg bg-surface-2 overflow-hidden">
      {/* Main Row */}
      <div 
        className="p-4 cursor-pointer hover:bg-surface-hover transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 flex-1">
            {/* Expand Icon */}
            <button className="p-1 hover:bg-surface rounded transition-colors">
              {expanded ? (
                <ChevronDown className="w-4 h-4 text-text-muted" />
              ) : (
                <ChevronRight className="w-4 h-4 text-text-muted" />
              )}
            </button>

            {/* Developer Info */}
            <div className="flex-1 grid grid-cols-5 gap-4 items-center">
              <div>
                <p className="text-sm font-medium text-text-primary">{developer.user_name}</p>
                <p className="text-xs text-text-muted">{developer.tasks_count} task{developer.tasks_count !== 1 ? 's' : ''}</p>
              </div>
              
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-text-muted mb-1">Amount</p>
                <p className="text-lg font-semibold font-mono text-text-primary">
                  ${developer.total_amount?.toLocaleString() || '0'}
                </p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-text-muted mb-1">Confidence</p>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-24 bg-surface rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all ${
                        developer.avg_confidence >= 0.7 ? 'bg-primary' : 
                        developer.avg_confidence >= 0.5 ? 'bg-warning' : 'bg-danger'
                      }`}
                      style={{ width: `${(developer.avg_confidence || 0) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono text-text-secondary">
                    {((developer.avg_confidence || 0) * 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-text-muted mb-1">Projects</p>
                <p className="text-sm text-text-secondary">{developer.projects_count || 0}</p>
              </div>

              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-text-muted mb-1">Approved Since</p>
                <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                  <Calendar className="w-3 h-3" />
                  {developer.earliest_approved_at ? (
                    <span>{formatDistanceToNow(new Date(developer.earliest_approved_at), { addSuffix: true })}</span>
                  ) : (
                    <span>—</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Create Batch Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCreateBatch(developer);
            }}
            className="ml-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm font-medium"
          >
            <Package className="w-4 h-4" />
            Create Batch
          </button>
        </div>
      </div>

      {/* Expanded Earnings List */}
      {expanded && developer.earnings && developer.earnings.length > 0 && (
        <div className="border-t border-border">
          <div className="p-4 bg-surface">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-xs uppercase tracking-[0.14em] text-text-muted font-semibold">Task</th>
                  <th className="text-left py-2 px-3 text-xs uppercase tracking-[0.14em] text-text-muted font-semibold">Project</th>
                  <th className="text-right py-2 px-3 text-xs uppercase tracking-[0.14em] text-text-muted font-semibold">Final</th>
                  <th className="text-center py-2 px-3 text-xs uppercase tracking-[0.14em] text-text-muted font-semibold">Confidence</th>
                  <th className="text-left py-2 px-3 text-xs uppercase tracking-[0.14em] text-text-muted font-semibold">Why</th>
                </tr>
              </thead>
              <tbody>
                {developer.earnings.map((earning) => (
                  <tr key={earning.earning_id} className="border-b border-border/50">
                    <td className="py-2 px-3 text-sm text-text-primary">{earning.task_title}</td>
                    <td className="py-2 px-3 text-xs text-text-muted">{earning.project_name}</td>
                    <td className="py-2 px-3 text-right text-sm font-mono text-text-primary">
                      ${earning.final_earning?.toLocaleString() || '0'}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <span className={`text-xs font-mono ${
                        earning.confidence_score >= 0.7 ? 'text-primary' :
                        earning.confidence_score >= 0.5 ? 'text-warning' : 'text-danger'
                      }`}>
                        {((earning.confidence_score || 0) * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="py-2 px-3 text-xs text-text-secondary">{earning.why || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

const ReadyForBatchQueue = ({ developers = [], onCreateBatch }) => {
  if (developers.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-12 text-center">
        <Package className="w-12 h-12 text-text-muted mx-auto mb-3" />
        <p className="text-text-primary font-medium mb-1">No approved earnings ready for batching</p>
        <p className="text-sm text-text-muted">Earnings will appear here after QA approval</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {developers.map((developer) => (
        <DeveloperRow 
          key={developer.user_id} 
          developer={developer} 
          onCreateBatch={onCreateBatch}
        />
      ))}
    </div>
  );
};

export default ReadyForBatchQueue;