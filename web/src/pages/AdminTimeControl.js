import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, AlertTriangle, TrendingDown, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

/**
 * ADMIN TIME CONTROL PANEL
 * 
 * Answers 3 questions:
 * 1. Who's weak?
 * 2. Where's money leaking?
 * 3. Where's bottleneck?
 */
export default function AdminTimeControl() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [trustData, setTrustData] = useState(null);
  const [period, setPeriod] = useState('week');
  const [sortBy, setSortBy] = useState('suspicious_score');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDev, setSelectedDev] = useState(null);
  const [error, setError] = useState(null);

  const fetchTrustData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const res = await fetch(
        `${BACKEND_URL}/api/admin/time/trust/developers?period=${period}&sort_by=${sortBy}`,
        { credentials: 'include' }
      );
      
      if (!res.ok) throw new Error('Failed to fetch trust data');
      
      const data = await res.json();
      setTrustData(data);
    } catch (err) {
      console.error('Error fetching trust data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrustData();
  }, [period, sortBy]);

  // Filter developers
  const filteredDevs = trustData?.developers.filter(dev =>
    dev.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    dev.email.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const getConfidenceColor = (score) => {
    if (score >= 0.9) return 'text-green-600';
    if (score >= 0.7) return 'text-signal';
    if (score >= 0.5) return 'text-orange-600';
    return 'text-red-600';
  };

  const getConfidenceBadge = (score) => {
    if (score >= 0.9) return 'bg-green-500/10 text-green-600 border-green-500/20';
    if (score >= 0.7) return 'bg-signal/10 text-signal border-signal/20';
    if (score >= 0.5) return 'bg-orange-500/10 text-orange-600 border-orange-500/20';
    return 'bg-red-500/10 text-red-600 border-red-500/20';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 p-8">
        <div className="text-center py-20">
          <RefreshCw className="w-8 h-8 text-signal animate-spin mx-auto mb-4" />
          <div className="text-slate-400">Loading team trust data...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 p-8">
        <div className="text-center py-20">
          <div className="text-red-500 mb-4">{error}</div>
          <Button onClick={fetchTrustData}>Retry</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-8" data-testid="admin-time-control">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              onClick={() => navigate('/admin/dashboard')}
              className="text-slate-400 hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <h1 className="text-3xl font-bold text-white">
              Team Time Control
            </h1>
          </div>
          
          <div className="flex items-center gap-3">
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
            
            <Button variant="outline" size="sm" onClick={fetchTrustData}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Team Health Cards */}
        {trustData?.team_stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="p-4 bg-slate-900 border-slate-700">
              <div className="text-sm text-slate-400 mb-1">Total Hours</div>
              <div className="text-2xl font-bold text-white">
                {trustData.team_stats.total_hours.toFixed(1)}h
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {trustData.team_stats.total_developers} developers
              </div>
            </Card>
            
            <Card className="p-4 bg-slate-900 border-slate-700">
              <div className="text-sm text-slate-400 mb-1">Avg Confidence</div>
              <div className={`text-2xl font-bold ${getConfidenceColor(trustData.team_stats.avg_confidence)}`}>
                {trustData.team_stats.avg_confidence.toFixed(2)}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Team average
              </div>
            </Card>
            
            <Card className="p-4 bg-slate-900 border-slate-700">
              <div className="text-sm text-slate-400 mb-1">Manual Ratio</div>
              <div className={`text-2xl font-bold ${trustData.team_stats.avg_manual_ratio > 0.5 ? 'text-red-600' : trustData.team_stats.avg_manual_ratio > 0.35 ? 'text-orange-600' : 'text-green-600'}`}>
                {(trustData.team_stats.avg_manual_ratio * 100).toFixed(1)}%
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Avg across team
              </div>
            </Card>
            
            <Card className="p-4 bg-slate-900 border-slate-700">
              <div className="text-sm text-slate-400 mb-1">Flagged</div>
              <div className={`text-2xl font-bold ${trustData.team_stats.flagged_count > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {trustData.team_stats.flagged_count}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Developers at risk
              </div>
            </Card>
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search developers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
          >
            <option value="suspicious_score">Sort by Suspicious</option>
            <option value="confidence_score">Sort by Confidence</option>
            <option value="manual_ratio">Sort by Manual Ratio</option>
            <option value="hours">Sort by Hours</option>
          </select>
        </div>

        {/* Developer Table */}
        <Card className="p-6 bg-slate-900 border-slate-700">
          <h3 className="text-lg font-semibold text-white mb-4">Developer Ranking</h3>
          
          <div className="overflow-x-auto">
            <table className="w-full" data-testid="developer-trust-table">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-3 px-4 text-sm font-medium text-slate-400">Developer</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Hours</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Confidence</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Manual</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Patterns</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Status</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-slate-400">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredDevs.map((dev, idx) => (
                  <tr 
                    key={dev.user_id}
                    className="border-b border-slate-800 hover:bg-slate-800/50 cursor-pointer"
                    onClick={() => setSelectedDev(dev)}
                    data-testid={`dev-row-${idx}`}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        {dev.flagged && <AlertTriangle className="w-4 h-4 text-red-600" />}
                        <div>
                          <div className="text-white font-medium">{dev.name}</div>
                          <div className="text-xs text-slate-500">{dev.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right text-white">{dev.total_hours.toFixed(1)}h</td>
                    <td className="py-3 px-4 text-right">
                      <span className={`font-semibold ${getConfidenceColor(dev.confidence_score)}`}>
                        {dev.confidence_score.toFixed(2)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className={dev.manual_ratio > 0.5 ? 'text-red-600 font-semibold' : dev.manual_ratio > 0.35 ? 'text-orange-600' : 'text-green-600'}>
                        {(dev.manual_ratio * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-slate-400">
                      {dev.pattern_count}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Badge className={`${getConfidenceBadge(dev.confidence_score)} border text-xs`}>
                        {dev.confidence_score >= 0.9 ? 'HIGH TRUST' : dev.confidence_score >= 0.7 ? 'STABLE' : dev.confidence_score >= 0.5 ? 'WARNING' : 'LOW TRUST'}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={(e) => { e.stopPropagation(); setSelectedDev(dev); }}
                        data-testid={`investigate-btn-${idx}`}
                      >
                        Investigate
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Investigate Sheet */}
      <Sheet open={!!selectedDev} onOpenChange={(open) => !open && setSelectedDev(null)}>
        <SheetContent className="w-[600px] sm:max-w-[600px] bg-slate-900 border-slate-700">
          {selectedDev && (
            <>
              <SheetHeader>
                <SheetTitle className="text-white">
                  {selectedDev.name}
                </SheetTitle>
                <SheetDescription className="text-slate-400">
                  {selectedDev.email}
                </SheetDescription>
              </SheetHeader>
              
              <div className="mt-6 space-y-4">
                {/* Trust Metrics */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-800 rounded-lg">
                    <div className="text-xs text-slate-400 mb-1">Confidence</div>
                    <div className={`text-2xl font-bold ${getConfidenceColor(selectedDev.confidence_score)}`}>
                      {selectedDev.confidence_score.toFixed(2)}
                    </div>
                  </div>
                  <div className="p-4 bg-slate-800 rounded-lg">
                    <div className="text-xs text-slate-400 mb-1">Manual Ratio</div>
                    <div className={`text-2xl font-bold ${selectedDev.manual_ratio > 0.5 ? 'text-red-600' : 'text-orange-600'}`}>
                      {(selectedDev.manual_ratio * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="p-4 bg-slate-800 rounded-lg">
                    <div className="text-xs text-slate-400 mb-1">Suspicious Score</div>
                    <div className="text-2xl font-bold text-orange-600">
                      {selectedDev.suspicious_score.toFixed(2)}
                    </div>
                  </div>
                  <div className="p-4 bg-slate-800 rounded-lg">
                    <div className="text-xs text-slate-400 mb-1">Total Hours</div>
                    <div className="text-2xl font-bold text-white">
                      {selectedDev.total_hours.toFixed(1)}h
                    </div>
                  </div>
                </div>

                {/* Primary Issue */}
                {selectedDev.top_pattern && (
                  <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <div className="text-sm font-semibold text-red-600 mb-2">
                      PRIMARY ISSUE: {selectedDev.top_pattern.toUpperCase()}
                    </div>
                    <div className="text-sm text-slate-300">
                      This developer shows signs of {selectedDev.top_pattern.replace(/_/g, ' ')}.
                    </div>
                  </div>
                )}

                {/* Category Breakdown */}
                <div>
                  <div className="text-sm font-semibold text-white mb-2">Category Breakdown</div>
                  <div className="space-y-2">
                    {selectedDev.category_breakdown && Object.entries(selectedDev.category_breakdown).map(([cat, hours]) => {
                      const total = Object.values(selectedDev.category_breakdown).reduce((sum, h) => sum + h, 0);
                      const pct = total > 0 ? ((hours / total) * 100).toFixed(1) : 0;
                      return (
                        <div key={cat} className="flex items-center justify-between text-sm">
                          <span className="text-slate-400 capitalize">{cat.replace(/_/g, ' ')}</span>
                          <span className="text-white font-medium">{hours}h ({pct}%)</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Recommended Actions */}
                <div>
                  <div className="text-sm font-semibold text-white mb-2">Recommended Actions</div>
                  <div className="space-y-2">
                    {selectedDev.flagged && (
                      <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg text-sm text-orange-200">
                        → Review manual entry patterns and enforce timer usage
                      </div>
                    )}
                    {selectedDev.manual_ratio > 0.5 && (
                      <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-200">
                        → CRITICAL: Mandate timer usage for all sessions
                      </div>
                    )}
                    {selectedDev.pattern_count > 2 && (
                      <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-sm text-yellow-200">
                        → Conduct 1-on-1 to address time tracking habits
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
