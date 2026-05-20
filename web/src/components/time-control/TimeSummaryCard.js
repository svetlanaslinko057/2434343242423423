import React from 'react';
import { Clock, TrendingUp, AlertCircle, CheckCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';

/**
 * TIME SUMMARY CARD
 * Shows today/week summary with category statuses
 */
export const TimeSummaryCard = ({ summary, categoryAnalysis }) => {
  if (!summary) return null;

  const getStatusIcon = (status) => {
    if (status === 'good') return <CheckCircle className="w-4 h-4 text-green-600" />;
    if (status === 'warning') return <AlertCircle className="w-4 h-4 text-orange-600" />;
    if (status === 'bad') return <AlertCircle className="w-4 h-4 text-red-600" />;
    return <Clock className="w-4 h-4 text-gray-600" />;
  };

  const getStatusColor = (status) => {
    if (status === 'good') return 'text-green-600';
    if (status === 'warning') return 'text-orange-600';
    if (status === 'bad') return 'text-red-600';
    return 'text-gray-600';
  };

  return (
    <Card className="p-6" data-testid="time-summary-card">
      <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
        Week Summary
      </h3>
      
      {/* Total Hours */}
      <div className="mb-6">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-3xl font-bold text-slate-900 dark:text-white">
            {summary.total_hours}h
          </span>
          <span className="text-sm text-slate-600 dark:text-slate-400">total</span>
        </div>
        <div className="flex gap-4 text-sm text-slate-600 dark:text-slate-400">
          <span>Timer: {summary.timer_hours}h</span>
          <span>Manual: {summary.manual_hours}h</span>
        </div>
      </div>

      {/* Category Breakdown with Status */}
      <div className="space-y-3">
        <div className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          Category Breakdown
        </div>
        {categoryAnalysis && Object.entries(categoryAnalysis).map(([category, data]) => (
          <div 
            key={category}
            className="flex items-center justify-between py-2 border-b border-slate-200 dark:border-slate-700 last:border-0"
            data-testid={`category-${category}`}
          >
            <div className="flex items-center gap-2">
              {getStatusIcon(data.status)}
              <span className="text-sm capitalize text-slate-700 dark:text-slate-300">
                {category.replace(/_/g, ' ')}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-600 dark:text-slate-400">
                {data.hours}h
              </span>
              <span className={`text-sm font-semibold ${getStatusColor(data.status)}`}>
                {data.percentage}%
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Avg per day */}
      <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
        <div className="text-sm text-slate-600 dark:text-slate-400">
          Avg per day: <span className="font-semibold text-slate-900 dark:text-white">{(summary.total_hours / 7).toFixed(1)}h</span>
        </div>
      </div>
    </Card>
  );
};
