import { ArrowRight, AlertCircle, CheckCircle2, FileEdit } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const RecommendedActionsPanel = ({ actions }) => {
  const navigate = useNavigate();

  const getUrgencyConfig = (urgency) => {
    if (urgency === 'critical') return { color: 'hsl(var(--destructive))', bgColor: 'hsl(var(--destructive) / 0.1)', icon: AlertCircle };
    if (urgency === 'high') return { color: 'hsl(var(--risk))', bgColor: 'hsl(var(--risk) / 0.1)', icon: AlertCircle };
    return { color: 'hsl(var(--info))', bgColor: 'hsl(var(--info) / 0.1)', icon: CheckCircle2 };
  };

  const getActionIcon = (type) => {
    if (type === 'pay_now') return '💳';
    if (type === 'approve_deliverable') return '✅';
    if (type === 'resolve_cr') return '📝';
    if (type === 'sign_contract') return '🔏';
    return '⚡';
  };

  if (!actions || actions.length === 0) {
    return (
      <div className="border border-border rounded-lg p-6 text-center" data-testid="recommended-actions-panel">
        <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto mb-2 opacity-50" />
        <div className="text-sm text-muted-foreground">No urgent actions required</div>
        <div className="text-xs text-muted-foreground mt-1">All clear! Project running smoothly</div>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg p-5" data-testid="recommended-actions-panel">
      <div className="flex items-center gap-2 mb-4">
        <AlertCircle className="w-5 h-5 text-yellow-400" />
        <h3 className="text-sm font-medium text-white font-[var(--font-body)]">Recommended Actions</h3>
        <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full ml-auto">{actions.length}</span>
      </div>

      <div className="space-y-3">
        {actions.map((action, idx) => {
          const urgencyConfig = getUrgencyConfig(action.urgency);
          const Icon = urgencyConfig.icon;

          return (
            <div
              key={idx}
              className="border rounded-lg p-4 hover:bg-muted transition-all cursor-pointer group"
              style={{ borderColor: urgencyConfig.color }}
              onClick={() => action.cta_url && navigate(action.cta_url)}
              data-testid="recommended-action-item"
            >
              <div className="flex items-start gap-3">
                <div className="text-2xl mt-0.5">{getActionIcon(action.type)}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="text-white font-medium text-sm">{action.action}</div>
                    <Icon className="w-4 h-4" style={{ color: urgencyConfig.color }} />
                  </div>
                  <div className="text-xs text-muted-foreground mb-2">{action.impact}</div>
                  <div className="flex items-center gap-2 text-xs">
                    <span
                      className="px-2 py-1 rounded-full font-medium"
                      style={{ backgroundColor: urgencyConfig.bgColor, color: urgencyConfig.color }}
                    >
                      {action.urgency}
                    </span>
                    {action.amount !== undefined && (
                      <span className="text-muted-foreground">Amount: ${action.amount.toLocaleString()}</span>
                    )}
                    {action.count !== undefined && (
                      <span className="text-muted-foreground">{action.count} item(s)</span>
                    )}
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-muted-foreground transition-colors mt-1" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
