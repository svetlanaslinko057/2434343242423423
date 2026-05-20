import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TimeTrustHeader } from '@/components/time-control/TimeTrustHeader';
import { TimeSignalsPanel } from '@/components/time-control/TimeSignalsPanel';
import { TimeSummaryCard } from '@/components/time-control/TimeSummaryCard';
import { TimeDistributionChart } from '@/components/time-control/TimeDistributionChart';
import { ManualControlCard } from '@/components/time-control/ManualControlCard';
import { TimeInsightsPanel } from '@/components/time-control/TimeInsightsPanel';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

/**
 * DEVELOPER TIME CONTROL PANEL
 * 
 * NOT a dashboard - a CONTROL PANEL
 * Every block gives SIGNALS → ACTIONS
 */
export default function DeveloperTimeControl() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [trustData, setTrustData] = useState(null);
  const [period, setPeriod] = useState('week');
  const [error, setError] = useState(null);

  const fetchTimeTrust = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const res = await fetch(`${BACKEND_URL}/api/developer/time-trust?period=${period}`, {
        credentials: 'include'
      });
      
      if (!res.ok) {
        throw new Error('Failed to fetch time trust data');
      }
      
      const data = await res.json();
      setTrustData(data);
    } catch (err) {
      console.error('Error fetching time trust:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTimeTrust();
  }, [period]);

  const handleImproveTracking = () => {
    // Navigate to workspace or show improvement modal
    navigate('/developer/workspace');
  };

  const handleStartTimer = () => {
    // Navigate to workspace to start timer
    navigate('/developer/workspace');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-20">
            <RefreshCw className="w-8 h-8 text-signal animate-spin mx-auto mb-4" />
            <div className="text-slate-400">Loading time trust data...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-20">
            <div className="text-red-500 mb-4">{error}</div>
            <Button onClick={fetchTimeTrust}>
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-8" data-testid="developer-time-control">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              onClick={() => navigate('/developer/workspace')}
              className="text-slate-400 hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Workspace
            </Button>
            <h1 className="text-3xl font-bold text-white">
              Time Control Panel
            </h1>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Period selector */}
            <div className="flex gap-2">
              {['today', 'week', 'month'].map(p => (
                <Button
                  key={p}
                  variant={period === p ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPeriod(p)}
                  className={period === p ? 'bg-signal' : ''}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </Button>
              ))}
            </div>
            
            <Button 
              variant="outline" 
              size="sm"
              onClick={fetchTimeTrust}
              data-testid="refresh-btn"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* BLOCK 1: Trust Header (MOST IMPORTANT) */}
        <TimeTrustHeader 
          trustData={trustData}
          onImprove={handleImproveTracking}
        />

        {/* Two columns layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column - Signals and Insights */}
          <div className="lg:col-span-2 space-y-6">
            {/* BLOCK 2: Signals Panel */}
            <TimeSignalsPanel patterns={trustData?.patterns} />
            
            {/* BLOCK 4: Time Distribution Chart */}
            <TimeDistributionChart categoryBreakdown={trustData?.category_breakdown} />
            
            {/* BLOCK 7: Insights */}
            <TimeInsightsPanel 
              categoryAnalysis={trustData?.category_analysis}
              recommendations={trustData?.recommendations}
            />
          </div>

          {/* Right column - Summary and Control */}
          <div className="space-y-6">
            {/* BLOCK 3: Week Summary */}
            <TimeSummaryCard 
              summary={trustData?.summary}
              categoryAnalysis={trustData?.category_analysis}
            />
            
            {/* BLOCK 6: Manual Control */}
            <ManualControlCard 
              summary={trustData?.summary}
              onStartTimer={handleStartTimer}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
