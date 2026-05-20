import React from 'react';
import { Lightbulb } from 'lucide-react';
import { Card } from '@/components/ui/card';

/**
 * TIME INSIGHTS PANEL
 * Micro insights based on category analysis
 */
export const TimeInsightsPanel = ({ categoryAnalysis, recommendations }) => {
  if (!categoryAnalysis) return null;

  const insights = [];

  // Generate insights from category analysis
  Object.entries(categoryAnalysis).forEach(([category, data]) => {
    if (category === 'debugging' && data.percentage > 25) {
      insights.push({
        type: 'warning',
        message: `You spend ${data.percentage}% time debugging → likely unclear requirements or insufficient planning`,
        action: 'Request clearer specs before starting tasks'
      });
    }
    
    if (category === 'revision' && data.percentage > 15) {
      insights.push({
        type: 'warning',
        message: `Revision ${data.percentage}% → QA cycle inefficiency or scope drift`,
        action: 'Improve initial quality and clarify acceptance criteria'
      });
    }
    
    if (category === 'execution' && data.percentage > 60) {
      insights.push({
        type: 'positive',
        message: `Execution ${data.percentage}% → Strong focus on core development`,
        action: 'Keep maintaining this healthy balance'
      });
    }
  });

  // Add recommendations as insights
  if (recommendations && recommendations.length > 0) {
    recommendations.slice(0, 2).forEach(rec => {
      insights.push({
        type: 'recommendation',
        message: rec,
        action: null
      });
    });
  }

  if (insights.length === 0) {
    return null;
  }

  return (
    <Card className="p-6" data-testid="time-insights-panel">
      <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
        💡 Insights
      </h3>
      
      <div className="space-y-3">
        {insights.map((insight, idx) => (
          <div 
            key={idx}
            className="flex gap-3 p-3 bg-signal dark:bg-signal/20 border border-signal dark:border-signal rounded-lg"
            data-testid={`insight-${idx}`}
          >
            <Lightbulb className="w-5 h-5 text-signal mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="text-sm text-slate-800 dark:text-slate-200 mb-1">
                {insight.message}
              </div>
              {insight.action && (
                <div className="text-xs text-signal dark:text-signal font-medium">
                  → {insight.action}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};
