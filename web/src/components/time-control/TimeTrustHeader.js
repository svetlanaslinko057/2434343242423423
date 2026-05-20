import React from 'react';
import { AlertTriangle, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

/**
 * TRUST HEADER - Most important block
 * Shows: confidence + label + primary issue + trend
 */
export const TimeTrustHeader = ({ trustData, onImprove }) => {
  if (!trustData) return null;

  const { trust_metrics, primary_issue } = trustData;
  const { confidence_score, confidence_label, impact_level, trend } = trust_metrics;

  // Label color
  const getLabelColor = (label) => {
    if (label === 'HIGH TRUST') return 'bg-green-500/10 text-green-600 border-green-500/20';
    if (label === 'STABLE') return 'bg-signal/10 text-signal border-signal/20';
    if (label === 'WARNING') return 'bg-orange-500/10 text-orange-600 border-orange-500/20';
    return 'bg-red-500/10 text-red-600 border-red-500/20';
  };

  // Impact color
  const getImpactColor = (level) => {
    if (level === 'critical') return 'text-red-600';
    if (level === 'high') return 'text-orange-600';
    if (level === 'medium') return 'text-yellow-600';
    return 'text-gray-600';
  };

  // Trend icon
  const TrendIcon = trend === 'improving' ? TrendingUp : trend === 'degrading' ? TrendingDown : Minus;
  const trendColor = trend === 'improving' ? 'text-green-600' : trend === 'degrading' ? 'text-red-600' : 'text-gray-600';

  return (
    <Card className="p-6 bg-signal/15 border-slate-700" data-testid="time-trust-header">
      <div className="flex items-start justify-between">
        <div className="space-y-4 flex-1">
          {/* Confidence Score */}
          <div className="flex items-center gap-4">
            <div>
              <div className="text-sm text-slate-400 mb-1">Time Confidence</div>
              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-bold text-white">{confidence_score.toFixed(2)}</span>
                <Badge className={`${getLabelColor(confidence_label)} border`}>
                  {confidence_label}
                </Badge>
              </div>
            </div>
            <div className={`ml-4 flex items-center gap-2 ${trendColor}`}>
              <TrendIcon className="w-5 h-5" />
              <span className="text-sm font-medium capitalize">{trend}</span>
            </div>
          </div>

          {/* Primary Issue */}
          {primary_issue && (
            <div className="border-t border-slate-700 pt-4">
              <div className="text-sm text-slate-400 mb-2">Primary Issue</div>
              <div className="flex items-start gap-3">
                <AlertTriangle className={`w-5 h-5 mt-0.5 ${getImpactColor(impact_level)}`} />
                <div className="flex-1">
                  <div className="font-semibold text-white mb-1">
                    {primary_issue.type.replace(/_/g, ' ').toUpperCase()}
                  </div>
                  <div className="text-sm text-slate-300">{primary_issue.message}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Action Button */}
        <Button 
          onClick={onImprove}
          className="bg-signal hover:bg-signal text-white"
          data-testid="improve-tracking-btn"
        >
          Improve Tracking
        </Button>
      </div>
    </Card>
  );
};
