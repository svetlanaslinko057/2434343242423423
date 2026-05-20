import React from 'react';
import { AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

/**
 * SIGNALS PANEL - Action block
 * Shows patterns with severity, evidence, and recommended actions
 */
export const TimeSignalsPanel = ({ patterns }) => {
  if (!patterns || patterns.length === 0) {
    return (
      <Card className="p-6" data-testid="time-signals-panel">
        <div className="text-center py-8">
          <Info className="w-12 h-12 text-green-500 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
            All Clear
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            No suspicious patterns detected. Keep up consistent timer usage.
          </p>
        </div>
      </Card>
    );
  }

  const getSeverityColor = (severity) => {
    if (severity >= 0.7) return 'border-red-500 bg-red-500/5';
    if (severity >= 0.5) return 'border-orange-500 bg-orange-500/5';
    return 'border-yellow-500 bg-yellow-500/5';
  };

  const getSeverityIcon = (severity) => {
    if (severity >= 0.7) return <AlertTriangle className="w-5 h-5 text-red-600" />;
    if (severity >= 0.5) return <AlertTriangle className="w-5 h-5 text-orange-600" />;
    return <AlertCircle className="w-5 h-5 text-yellow-600" />;
  };

  const getSeverityLabel = (severity) => {
    if (severity >= 0.7) return 'Critical';
    if (severity >= 0.5) return 'Warning';
    return 'Minor';
  };

  return (
    <Card className="p-6" data-testid="time-signals-panel">
      <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
        Signals & Alerts
      </h3>
      
      <ScrollArea className="h-[400px]">
        <div className="space-y-3">
          {patterns.map((pattern, idx) => (
            <div 
              key={idx}
              className={`border-l-4 p-4 rounded-r-lg ${getSeverityColor(pattern.severity)}`}
              data-testid={`signal-${pattern.type}`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{getSeverityIcon(pattern.severity)}</div>
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-slate-900 dark:text-white">
                      {pattern.type.replace(/_/g, ' ').toUpperCase()}
                    </div>
                    <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                      {getSeverityLabel(pattern.severity)}
                    </div>
                  </div>
                  
                  <div className="text-sm text-slate-700 dark:text-slate-300">
                    {pattern.evidence}
                  </div>
                  
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                    <div className="text-xs text-slate-600 dark:text-slate-400 mb-2">
                      Recommended Action:
                    </div>
                    <div className="text-sm text-slate-800 dark:text-slate-200 font-medium">
                      {pattern.recommended_action}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </Card>
  );
};
