import React from 'react';
import { Timer, AlertTriangle, CheckCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

/**
 * MANUAL CONTROL CARD
 * Shows manual ratio with progress and CTA
 */
export const ManualControlCard = ({ summary, onStartTimer }) => {
  if (!summary) return null;

  const manualRatio = summary.manual_ratio || 0;
  const manualPct = (manualRatio * 100).toFixed(1);
  const target = 30; // Target < 30%
  
  const isGood = manualRatio < 0.3;
  const isWarning = manualRatio >= 0.3 && manualRatio < 0.5;
  const isCritical = manualRatio >= 0.5;

  const getStatusColor = () => {
    if (isGood) return 'text-green-600';
    if (isWarning) return 'text-orange-600';
    return 'text-red-600';
  };

  const getStatusLabel = () => {
    if (isGood) return '✅ Good';
    if (isWarning) return '⚠️ Elevated';
    return '❌ HIGH';
  };

  const getProgressColor = () => {
    if (isGood) return 'bg-green-600';
    if (isWarning) return 'bg-orange-600';
    return 'bg-red-600';
  };

  return (
    <Card className="p-6" data-testid="manual-control-card">
      <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
        Manual Time Control
      </h3>
      
      {/* Manual Ratio */}
      <div className="mb-4">
        <div className="flex items-baseline justify-between mb-2">
          <div>
            <span className="text-sm text-slate-600 dark:text-slate-400">Manual Usage:</span>
            <span className={`ml-2 text-2xl font-bold ${getStatusColor()}`}>
              {manualPct}%
            </span>
            <span className={`ml-2 text-sm font-semibold ${getStatusColor()}`}>
              {getStatusLabel()}
            </span>
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-400">
            Target: &lt;{target}%
          </div>
        </div>
        
        {/* Progress bar */}
        <div className="relative">
          <Progress 
            value={Math.min(manualPct, 100)} 
            className="h-3"
          />
          <div 
            className="absolute top-0 h-3 border-r-2 border-signal"
            style={{ left: `${target}%` }}
          />
        </div>
      </div>

      {/* Timer Usage */}
      <div className="mb-4 p-3 bg-slate-100 dark:bg-slate-800 rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Timer className="w-4 h-4 text-signal" />
            <span className="text-sm text-slate-700 dark:text-slate-300">Timer Usage</span>
          </div>
          <span className="text-lg font-semibold text-slate-900 dark:text-white">
            {((1 - manualRatio) * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Action */}
      {!isGood && (
        <div className="space-y-3">
          <div className="flex items-start gap-2 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-orange-600 mt-0.5" />
            <div className="text-sm text-orange-800 dark:text-orange-200">
              {isCritical 
                ? 'CRITICAL: Manual entries exceed 50%. Start using timer for all work sessions.'
                : 'Manual usage is elevated. Increase timer usage to improve trust score.'
              }
            </div>
          </div>
          
          <Button 
            onClick={onStartTimer}
            className="w-full bg-signal hover:bg-signal text-white"
            data-testid="start-timer-cta"
          >
            <Timer className="w-4 h-4 mr-2" />
            Start Timer Now
          </Button>
        </div>
      )}
      
      {isGood && (
        <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <CheckCircle className="w-4 h-4 text-green-600" />
          <div className="text-sm text-green-800 dark:text-green-200">
            Great! Your timer usage is healthy. Keep it up.
          </div>
        </div>
      )}
    </Card>
  );
};
