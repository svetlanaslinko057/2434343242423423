import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from '@/components/ui/sheet';
import { Package, AlertTriangle, DollarSign, Calendar, User } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const StatusBadge = ({ status }) => {
  const statusConfig = {
    draft: { label: 'Draft', className: 'bg-surface-2 text-text-secondary border-border' },
    approved: { label: 'Approved', className: 'bg-primary/10 text-primary border-primary/30' },
    paid: { label: 'Paid', className: 'bg-success/10 text-success border-success/30' }
  };

  const config = statusConfig[status] || statusConfig.draft;

  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border ${config.className}`}>
      {config.label}
    </span>
  );
};

const BatchDetailSheet = ({ batch, isOpen, onClose }) => {
  if (!batch) return null;

  const lowConfidenceEarnings = batch.earnings_snapshot?.filter(e => (e.confidence_score || 0) < 0.7) || [];

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="bg-surface border-border w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-text-primary flex items-center gap-2">
            <Package className="w-5 h-5" />
            Batch #{batch.batch_id?.slice(-8)}
          </SheetTitle>
          <SheetDescription className="text-text-secondary">
            Payout batch details and earnings snapshot
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Status & Developer */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="text-xs uppercase tracking-[0.14em] text-text-muted">Status</h4>
              <StatusBadge status={batch.status} />
            </div>
            <div className="space-y-2">
              <h4 className="text-xs uppercase tracking-[0.14em] text-text-muted">Developer</h4>
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-text-muted" />
                <p className="text-sm font-medium text-text-primary">{batch.user_name || 'Unknown'}</p>
              </div>
            </div>
          </div>

          {/* Financial Summary */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-text-primary">Financial Summary</h4>
            <div className="bg-surface-2 rounded-lg border border-border p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Gross Amount</span>
                <span className="font-mono text-text-primary">${batch.gross_amount?.toLocaleString() || '0'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Adjustments</span>
                <span className={`font-mono ${(batch.total_adjustments || 0) >= 0 ? 'text-primary' : 'text-danger'}`}>
                  {(batch.total_adjustments || 0) >= 0 ? '+' : ''}{(batch.total_adjustments || 0).toFixed(2)}
                </span>
              </div>
              <div className="h-px bg-border" />
              <div className="flex justify-between">
                <span className="font-semibold text-text-primary">Final Amount</span>
                <span className="text-xl font-semibold font-mono text-text-primary">
                  ${batch.total_amount?.toLocaleString() || '0'}
                </span>
              </div>
              <div className="flex justify-between text-xs text-text-muted">
                <span>Frozen Snapshot</span>
                <span>{batch.frozen ? 'Yes' : 'No'}</span>
              </div>
            </div>
          </div>

          {/* Low Confidence Warning */}
          {lowConfidenceEarnings.length > 0 && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-warning/10 border border-warning/30">
              <AlertTriangle className="w-5 h-5 text-warning mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-warning mb-1">Low Confidence Earnings</p>
                <p className="text-sm text-text-secondary">
                  {lowConfidenceEarnings.length} earning{lowConfidenceEarnings.length !== 1 ? 's' : ''} 
                  {lowConfidenceEarnings.length === 1 ? ' has' : ' have'} confidence below 70%
                </p>
              </div>
            </div>
          )}

          {/* Earnings Snapshot */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-text-primary">Earnings Snapshot</h4>
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full">
                  <thead className="bg-surface-2 sticky top-0">
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 text-xs uppercase tracking-[0.14em] text-text-muted font-semibold">Task</th>
                      <th className="text-right py-2 px-3 text-xs uppercase tracking-[0.14em] text-text-muted font-semibold">Base</th>
                      <th className="text-right py-2 px-3 text-xs uppercase tracking-[0.14em] text-text-muted font-semibold">Adj</th>
                      <th className="text-right py-2 px-3 text-xs uppercase tracking-[0.14em] text-text-muted font-semibold">Final</th>
                      <th className="text-center py-2 px-3 text-xs uppercase tracking-[0.14em] text-text-muted font-semibold">Conf</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batch.earnings_snapshot?.map((earning) => (
                      <tr key={earning.earning_id} className="border-b border-border/50 hover:bg-surface-hover">
                        <td className="py-2 px-3">
                          <p className="text-sm text-text-primary">{earning.task_title}</p>
                          <p className="text-xs text-text-muted">{earning.project_name}</p>
                        </td>
                        <td className="py-2 px-3 text-right text-sm font-mono text-text-primary">
                          ${earning.base_earning?.toLocaleString() || '0'}
                        </td>
                        <td className="py-2 px-3 text-right text-sm font-mono text-text-secondary">
                          {(earning.adjustments_total || 0) >= 0 ? '+' : ''}{(earning.adjustments_total || 0).toFixed(2)}
                        </td>
                        <td className="py-2 px-3 text-right text-sm font-semibold font-mono text-text-primary">
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Explainability Preview */}
          {batch.earnings_snapshot?.some(e => e.explainability_preview) && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-text-primary">Sample Calculations</h4>
              <div className="space-y-2">
                {batch.earnings_snapshot.slice(0, 3).map((earning) => (
                  earning.explainability_preview && (
                    <div key={earning.earning_id} className="bg-surface-2 rounded-lg border border-border p-3">
                      <p className="text-xs font-medium text-text-primary mb-1">{earning.task_title}</p>
                      <code className="text-xs font-mono text-text-secondary block break-all">
                        {earning.explainability_preview}
                      </code>
                    </div>
                  )
                ))}
              </div>
            </div>
          )}

          {/* Timeline */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-text-primary">Timeline</h4>
            <div className="space-y-2">
              {batch.created_at && (
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="w-4 h-4 text-text-muted" />
                  <span className="text-text-secondary">Created:</span>
                  <span className="text-text-primary">
                    {formatDistanceToNow(new Date(batch.created_at), { addSuffix: true })}
                  </span>
                </div>
              )}
              {batch.approved_at && (
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="w-4 h-4 text-text-muted" />
                  <span className="text-text-secondary">Approved:</span>
                  <span className="text-text-primary">
                    {formatDistanceToNow(new Date(batch.approved_at), { addSuffix: true })}
                  </span>
                </div>
              )}
              {batch.paid_at && (
                <div className="flex items-center gap-2 text-sm">
                  <DollarSign className="w-4 h-4 text-text-muted" />
                  <span className="text-text-secondary">Paid:</span>
                  <span className="text-text-primary">
                    {formatDistanceToNow(new Date(batch.paid_at), { addSuffix: true })}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default BatchDetailSheet;