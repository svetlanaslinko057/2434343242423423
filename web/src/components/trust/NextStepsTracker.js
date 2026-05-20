import { Clock, User, AlertCircle } from 'lucide-react';

export const NextStepsTracker = ({ steps }) => {
  const getOwnerIcon = (owner) => {
    if (owner === 'Client') return '👤';
    if (owner === 'Developer') return '💻';
    if (owner === 'QA') return '🔍';
    return '⚙️';
  };

  if (!steps || steps.length === 0) {
    return (
      <div className="border border-border rounded-lg p-6 text-center" data-testid="next-steps-tracker">
        <div className="text-sm text-muted-foreground">No next steps available</div>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg p-5" data-testid="next-steps-tracker">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="w-5 h-5 text-signal" />
        <h3 className="text-sm font-medium text-white font-[var(--font-body)]">Next Steps</h3>
      </div>

      <div className="space-y-3">
        {steps.slice(0, 5).map((step, idx) => (
          <div
            key={idx}
            className={`flex items-start gap-3 p-3 rounded-lg ${
              step.blocking ? 'bg-red-500/10 border border-red-500/30' : 'bg-muted'
            }`}
            data-testid="next-step-item"
          >
            <div className="text-lg mt-0.5">{getOwnerIcon(step.owner)}</div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <div className="text-white text-sm font-medium">{step.title}</div>
                {step.blocking && (
                  <AlertCircle className="w-4 h-4 text-red-400" />
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{step.owner}</span>
                {step.eta_days !== undefined && (
                  <>
                    <span>•</span>
                    <span>{step.eta_days === 0 ? 'Now' : `${step.eta_days}d`}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
