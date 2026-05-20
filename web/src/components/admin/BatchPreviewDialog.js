import { X, Package, AlertTriangle, DollarSign } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';

const BatchPreviewDialog = ({ isOpen, onClose, developer, onConfirm, isCreating }) => {
  if (!developer) return null;

  const totalGross = developer.earnings?.reduce((sum, e) => sum + (e.base_earning || 0), 0) || 0;
  const totalAdjustments = developer.earnings?.reduce((sum, e) => sum + (e.adjustments_total || 0), 0) || 0;
  const totalFinal = developer.total_amount || 0;
  const lowConfidenceCount = developer.earnings?.filter(e => (e.confidence_score || 0) < 0.7).length || 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-surface border-border max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-text-primary flex items-center gap-2">
            <Package className="w-5 h-5" />
            Create Payout Batch
          </DialogTitle>
          <DialogDescription className="text-text-secondary">
            Review batch details before creation
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Developer Info */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-text-primary">Developer</h4>
            <div className="p-4 rounded-lg bg-surface-2 border border-border">
              <p className="text-base font-medium text-text-primary">{developer.user_name}</p>
              <p className="text-sm text-text-secondary mt-1">
                {developer.tasks_count} task{developer.tasks_count !== 1 ? 's' : ''} · 
                {developer.projects_count} project{developer.projects_count !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          {/* Financial Breakdown */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-text-primary">Financial Summary</h4>
            <div className="bg-surface-2 rounded-lg border border-border p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Gross Earnings</span>
                <span className="font-mono text-text-primary">${totalGross.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Adjustments</span>
                <span className={`font-mono ${totalAdjustments >= 0 ? 'text-primary' : 'text-danger'}`}>
                  {totalAdjustments >= 0 ? '+' : ''}{totalAdjustments.toFixed(2)}
                </span>
              </div>
              <div className="h-px bg-border" />
              <div className="flex justify-between">
                <span className="font-semibold text-text-primary">Final Amount</span>
                <span className="text-xl font-semibold font-mono text-text-primary">
                  ${totalFinal.toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* Quality Metrics */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-text-primary">Quality Metrics</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-surface-2 border border-border">
                <p className="text-xs uppercase tracking-[0.14em] text-text-muted mb-1">Avg Confidence</p>
                <p className={`text-lg font-semibold ${
                  developer.avg_confidence >= 0.7 ? 'text-primary' :
                  developer.avg_confidence >= 0.5 ? 'text-warning' : 'text-danger'
                }`}>
                  {((developer.avg_confidence || 0) * 100).toFixed(0)}%
                </p>
              </div>
              <div className="p-3 rounded-lg bg-surface-2 border border-border">
                <p className="text-xs uppercase tracking-[0.14em] text-text-muted mb-1">Low Confidence</p>
                <p className="text-lg font-semibold text-text-primary">
                  {lowConfidenceCount} / {developer.tasks_count}
                </p>
              </div>
            </div>
          </div>

          {/* Low Confidence Warning */}
          {lowConfidenceCount > 0 && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-warning/10 border border-warning/30">
              <AlertTriangle className="w-5 h-5 text-warning mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-warning mb-1">Low Confidence Warning</p>
                <p className="text-sm text-text-secondary">
                  {lowConfidenceCount} earning{lowConfidenceCount !== 1 ? 's' : ''} in this batch 
                  {lowConfidenceCount === 1 ? ' has' : ' have'} confidence below 70%. 
                  Review time tracking data before approval.
                </p>
              </div>
            </div>
          )}

          {/* Earnings List */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-text-primary">Included Earnings</h4>
            <div className="max-h-48 overflow-y-auto border border-border rounded-lg">
              <table className="w-full">
                <thead className="bg-surface-2 sticky top-0">
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 text-xs uppercase tracking-[0.14em] text-text-muted font-semibold">Task</th>
                    <th className="text-right py-2 px-3 text-xs uppercase tracking-[0.14em] text-text-muted font-semibold">Amount</th>
                    <th className="text-center py-2 px-3 text-xs uppercase tracking-[0.14em] text-text-muted font-semibold">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {developer.earnings?.map((earning) => (
                    <tr key={earning.earning_id} className="border-b border-border/50">
                      <td className="py-2 px-3 text-sm text-text-primary">{earning.task_title}</td>
                      <td className="py-2 px-3 text-right text-sm font-mono text-text-primary">
                        ${earning.final_earning?.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className={`text-xs font-mono ${
                          earning.confidence_score >= 0.7 ? 'text-primary' :
                          earning.confidence_score >= 0.5 ? 'text-warning' : 'text-danger'
                        }`}>
                          {((earning.confidence_score || 0) * 100).toFixed(0)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <DialogFooter>
          <button
            onClick={onClose}
            disabled={isCreating}
            className="px-4 py-2 rounded-lg border border-border bg-surface hover:bg-surface-hover transition-colors text-sm font-medium text-text-primary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isCreating}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm font-medium disabled:opacity-50 flex items-center gap-2"
          >
            {isCreating ? (
              <>
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <DollarSign className="w-4 h-4" />
                Create Batch
              </>
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BatchPreviewDialog;