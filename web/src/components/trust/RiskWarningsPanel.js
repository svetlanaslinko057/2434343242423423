import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

export const RiskWarningsPanel = ({ risks }) => {
  const [expandedRisks, setExpandedRisks] = useState({});

  const toggleRisk = (idx) => {
    setExpandedRisks(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const getSeverityColor = (severity) => {
    if (severity === 'high') return 'hsl(var(--destructive))';
    if (severity === 'medium') return 'hsl(var(--risk))';
    return 'hsl(var(--info))';
  };

  if (!risks || risks.length === 0) {
    return (
      <div className="border border-border rounded-lg p-6 text-center" data-testid="risk-warnings-panel">
        <AlertTriangle className="w-8 h-8 text-green-400 mx-auto mb-2 opacity-50" />
        <div className="text-sm text-muted-foreground">No elevated risks detected</div>
        <div className="text-xs text-muted-foreground mt-1">We'll warn you before anything becomes urgent</div>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg p-5" data-testid="risk-warnings-panel">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="w-5 h-5 text-yellow-400" />
        <h3 className="text-sm font-medium text-white font-[var(--font-body)]">Predictive Risks</h3>
        <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full ml-auto">{risks.length}</span>
      </div>

      <div className="space-y-3">
        {risks.map((risk, idx) => (
          <div
            key={idx}
            className="border border-border rounded-lg p-3 hover:bg-muted transition-colors"
            data-testid="risk-item"
          >
            <div className="flex items-start justify-between cursor-pointer" onClick={() => toggleRisk(idx)}>
              <div className="flex items-start gap-2 flex-1">
                <div
                  className="w-2 h-2 rounded-full mt-1.5"
                  style={{ backgroundColor: getSeverityColor(risk.severity) }}
                />
                <div className="flex-1">
                  <div className="text-white text-sm font-medium mb-1">{risk.title}</div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                    <span>{risk.probability}% probability</span>
                    <span>•</span>
                    <span>Impact: {risk.impact_days ? `+${risk.impact_days}d` : 'TBD'}</span>
                    {risk.eta_days !== undefined && (
                      <>
                        <span>•</span>
                        <span>ETA: {risk.eta_days}d</span>
                      </>
                    )}
                  </div>
                  {risk.cause && !expandedRisks[idx] && (
                    <div className="text-xs text-muted-foreground mt-1">{risk.cause}</div>
                  )}
                </div>
              </div>
              {expandedRisks[idx] ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </div>

            {expandedRisks[idx] && (
              <div className="mt-3 pt-3 border-t border-border">
                {risk.cause && (
                  <div className="mb-2">
                    <div className="text-xs text-muted-foreground mb-1">Cause:</div>
                    <div className="text-xs text-muted-foreground">{risk.cause}</div>
                  </div>
                )}
                {risk.evidence && risk.evidence.length > 0 && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-2">Evidence:</div>
                    <ul className="space-y-1">
                      {risk.evidence.map((ev, i) => (
                        <li key={i} className="text-xs text-muted-foreground">• {ev}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
