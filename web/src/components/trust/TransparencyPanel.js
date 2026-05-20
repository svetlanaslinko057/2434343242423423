import { Activity, CircleDot, DollarSign } from 'lucide-react';

export const TransparencyPanel = ({ transparency, devSession }) => {
  if (!transparency) {
    return (
      <div className="border border-border rounded-lg p-6 text-center" data-testid="transparency-panel">
        <div className="text-sm text-muted-foreground">No transparency data available</div>
      </div>
    );
  }

  const { developer_activity, qa_load, next_invoice } = transparency;

  return (
    <div className="border border-border rounded-lg p-5" data-testid="transparency-panel">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-5 h-5 text-signal" />
        <h3 className="text-sm font-medium text-white font-[var(--font-body)]">Transparency</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Developer Activity */}
        <div className="bg-muted rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <CircleDot className={`w-4 h-4 ${
              developer_activity.status === 'active' ? 'text-green-400 animate-pulse' : 'text-gray-400'
            }`} />
            <div className="text-xs text-muted-foreground">Dev Activity</div>
          </div>
          <div className="text-white text-sm font-medium mb-1">
            {developer_activity.status === 'active' ? 'Active' : 'Idle'}
          </div>
          <div className="text-xs text-muted-foreground">
            {developer_activity.current_task}
          </div>
          
          {/* Enhanced: Dev Session Info */}
          {devSession && devSession.status === 'active' && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="text-xs text-muted-foreground space-y-1">
                {devSession.active_time_minutes > 0 && (
                  <div>Active: {Math.floor(devSession.active_time_minutes / 60)}h {devSession.active_time_minutes % 60}m</div>
                )}
                {devSession.commits_count > 0 && (
                  <div>Commits: {devSession.commits_count}</div>
                )}
                {devSession.current_module && (
                  <div className="text-muted-foreground font-medium">Working on: {devSession.current_module}</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* QA Load */}
        <div className="bg-muted rounded-lg p-4">
          <div className="text-xs text-muted-foreground mb-2">QA Queue</div>
          <div className="text-white text-2xl font-semibold tabular-nums mb-1">{qa_load || 0}</div>
          <div className="text-xs text-muted-foreground">modules pending</div>
          {devSession && devSession.qa_queued > 0 && (
            <div className="text-xs text-muted-foreground mt-2">({devSession.qa_queued} for this project)</div>
          )}
        </div>

        {/* Next Invoice */}
        <div className="bg-muted rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-green-400" />
            <div className="text-xs text-muted-foreground">Next Invoice</div>
          </div>
          {next_invoice ? (
            <>
              <div className="text-white text-lg font-semibold tabular-nums mb-1">
                ${next_invoice.amount.toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground">
                ~{next_invoice.eta_days} days
              </div>
            </>
          ) : (
            <div className="text-muted-foreground text-sm">None pending</div>
          )}
        </div>
      </div>
    </div>
  );
};
