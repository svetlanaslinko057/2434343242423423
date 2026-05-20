import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, TrendingUp, Award, AlertCircle, Zap, Trophy, DollarSign, Target } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/**
 * DEVELOPER DASHBOARD (HOME)
 * Темная тема: "RPG/Trading Terminal" с акцентом на earnings, strikes, Elite status
 */

export default function DeveloperDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({
    earnings: {
      this_week: 0,
      this_month: 0,
      avg_per_module: 0
    },
    active_modules: [],
    rating: {
      level: 'Junior',
      rating: 50,
      quality: 50,
      speed: 50,
      trust: 50
    },
    growth: [],
    elite_status: null
  });

  useEffect(() => {
    fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    try {
      const backendUrl = process.env.REACT_APP_BACKEND_URL || '';
      
      // Use new dashboard summary endpoint
      const summaryRes = await fetch(`${backendUrl}/api/developer/dashboard/summary`, { 
        credentials: 'include' 
      });

      if (summaryRes.ok) {
        const summary = await summaryRes.json();
        
        setData({
          earnings: summary.earnings || { this_week: 0, this_month: 0, avg_per_module: 0 },
          active_modules: [],
          rating: summary.rating ? {
            level: summary.rating.level_label || summary.rating.level,
            rating: summary.rating.rating,
            quality: summary.rating.components?.quality || 50,
            speed: summary.rating.components?.speed || 50,
            trust: summary.rating.components?.trust || 50
          } : data.rating,
          growth: summary.rating?.growth_opportunities || [],
          elite_status: summary.elite_status || null
        });
      }

      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch dashboard:', err);
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8" data-testid="developer-dashboard">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/4"></div>
          <div className="h-32 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-6" data-testid="developer-dashboard">
      <div className="max-w-7xl mx-auto w-full space-y-6">
        
        {/* Header */}
        <div>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
              <p className="text-muted-foreground mt-1">Your performance at a glance</p>
            </div>
            
            {/* Elite Badge */}
            {data.elite_status?.is_elite && (
              <Badge className="bg-signal/15 text-foreground px-6 py-3 text-lg border-0" data-testid="elite-badge">
                <Trophy className="w-5 h-5 mr-2" />
                ELITE #{data.elite_status.rank}
              </Badge>
            )}
            
            {/* Distance to Elite */}
            {!data.elite_status?.is_elite && data.elite_status?.distance && (
              <div className="text-right px-6 py-4 rounded-xl bg-card border border-border" data-testid="distance-to-elite">
                <p className="text-sm text-muted-foreground">You are rank</p>
                <p className="text-2xl font-bold text-foreground">#{data.elite_status.distance.current_rank}</p>
                <p className="text-xs text-warning">+{data.elite_status.distance.points_needed} to Elite</p>
              </div>
            )}
          </div>
          
          {/* Risk of Drop Warning */}
          {data.elite_status?.risk_of_drop && (
            <div className="mt-4 p-4 rounded-xl border border-[color:var(--danger-border)] bg-[color:var(--danger-surface)] flex items-start gap-3" role="alert">
              <AlertCircle className="w-5 h-5 text-[color:var(--danger)] flex-shrink-0 mt-0.5" />
              <p className="text-sm text-[color:var(--danger)]">
                ⚠️ You're at risk of losing Elite status. Maintain your performance to stay in Top 10.
              </p>
            </div>
          )}
        </div>

        {/* БЛОК 1: MONEY FIRST */}
        <Card className="border-2 border-[color:var(--success-border)] bg-card shadow-[var(--shadow-elev-1)]" data-testid="money-block">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[color:var(--success)]">
              <TrendingUp className="w-5 h-5" />
              Your Earnings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground font-medium uppercase tracking-wide">This Week</p>
                <p className="text-4xl font-bold font-mono text-[color:var(--success)]" data-testid="earnings-week">
                  ${data.earnings.this_week}
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground font-medium uppercase tracking-wide">This Month</p>
                <p className="text-4xl font-bold font-mono text-[color:var(--success)]" data-testid="earnings-month">
                  ${data.earnings.this_month}
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground font-medium uppercase tracking-wide">Avg per Module</p>
                <p className="text-4xl font-bold font-mono text-foreground" data-testid="earnings-avg">
                  ${data.earnings.avg_per_module}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* БЛОК 2: CURRENT MODULES */}
          <Card className="bg-card border border-border shadow-[var(--shadow-elev-1)]" data-testid="active-modules-block">
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-foreground">
                <span>Active Modules</span>
                <Badge variant="outline" className="border-border text-foreground" data-testid="active-modules-count">
                  {data.active_modules.length}/2
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.active_modules.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No active modules</p>
                  <Button 
                    onClick={() => navigate('/developer/marketplace')}
                    className="mt-4 bg-foreground text-background hover:bg-foreground/90"
                    data-testid="browse-marketplace-btn"
                  >
                    Browse Marketplace
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {data.active_modules.map(module => (
                    <div 
                      key={module.module_id}
                      className="p-4 border border-border rounded-lg hover:border-muted-foreground transition-colors cursor-pointer bg-muted"
                      onClick={() => navigate(`/modules/${module.module_id}`)}
                      data-testid={`module-card-${module.module_id}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="font-semibold text-foreground">{module.title}</h4>
                          <Badge 
                            variant={module.status === 'in_progress' ? 'default' : 'secondary'}
                            className="mt-2"
                          >
                            {module.status === 'in_progress' ? 'In Progress' : 
                             module.status === 'review' ? 'In Review' : module.status}
                          </Badge>
                        </div>
                        <p className="text-lg font-bold font-mono text-[color:var(--success)]">
                          ${module.price}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* БЛОК 3: RATING SNAPSHOT */}
          <Card className="bg-card border-l-4 border-l-[color:var(--info)] border-t border-r border-b border-border shadow-[var(--shadow-elev-1)]" data-testid="rating-snapshot">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-foreground">
                <Award className="w-5 h-5 text-[color:var(--info)]" />
                Your Rating
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Level</p>
                    <p className="text-2xl font-bold text-foreground" data-testid="rating-level">
                      {data.rating.level}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Rating</p>
                    <p className="text-3xl font-bold text-[color:var(--info)]" data-testid="rating-score">
                      {data.rating.rating}
                      <span className="text-lg text-muted-foreground">/100</span>
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center p-3 bg-muted rounded-lg border border-border">
                    <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">Quality</p>
                    <p className="text-xl font-bold text-foreground" data-testid="rating-quality">
                      {data.rating.quality}
                    </p>
                  </div>
                  <div className="text-center p-3 bg-muted rounded-lg border border-border">
                    <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">Speed</p>
                    <p className="text-xl font-bold text-foreground" data-testid="rating-speed">
                      {data.rating.speed}
                    </p>
                  </div>
                  <div className="text-center p-3 bg-muted rounded-lg border border-border">
                    <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">Trust</p>
                    <p className="text-xl font-bold text-foreground" data-testid="rating-trust">
                      {data.rating.trust}
                    </p>
                  </div>
                </div>

                <Button 
                  variant="outline" 
                  className="w-full border-border text-foreground hover:bg-muted hover:border-muted-foreground"
                  onClick={() => navigate('/developer/profile')}
                  data-testid="view-profile-btn"
                >
                  View Full Profile
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* БЛОК 4: GROWTH CTA */}
        {data.growth.length > 0 && (
          <Card className="border-2 border-[color:var(--warning-border)] bg-[color:var(--warning-surface)] shadow-[var(--shadow-elev-1)]" data-testid="growth-cta">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[color:var(--warning)]">
                <Zap className="w-5 h-5" />
                Earn More Money
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-semibold text-foreground mb-4">
                To earn +${data.growth[0]?.monthly_impact || 600}/month:
              </p>
              
              <div className="space-y-3">
                {data.growth.slice(0, 3).map((opp, idx) => (
                  <div 
                    key={idx}
                    className="flex items-center justify-between p-4 bg-card border border-border rounded-lg hover:border-[color:var(--warning-border)] transition-colors"
                    data-testid={`growth-opportunity-${idx}`}
                  >
                    <div className="flex-1">
                      <p className="font-medium text-foreground">{opp.action}</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {opp.current} → {opp.target}
                      </p>
                    </div>
                    <p className="text-lg font-bold font-mono text-[color:var(--success)]">
                      +${opp.monthly_impact}
                    </p>
                  </div>
                ))}
              </div>

              <Button 
                className="w-full mt-4 bg-[color:var(--warning)] text-warning-ink hover:bg-[color:var(--warning)]/90"
                onClick={() => navigate('/developer/profile')}
                data-testid="view-growth-plan-btn"
              >
                View Full Growth Plan
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Button
            variant="outline"
            className="h-20 border-border text-foreground hover:bg-muted hover:border-muted-foreground"
            onClick={() => navigate('/developer/marketplace')}
            data-testid="marketplace-quick-btn"
          >
            <div className="text-center">
              <p className="font-semibold">Browse Marketplace</p>
              <p className="text-xs text-muted-foreground">Find new modules</p>
            </div>
          </Button>

          <Button
            variant="outline"
            className="h-20 border-border text-foreground hover:bg-muted hover:border-muted-foreground"
            onClick={() => navigate('/developer/leaderboard')}
            data-testid="leaderboard-quick-btn"
          >
            <div className="text-center">
              <p className="font-semibold">Leaderboard</p>
              <p className="text-xs text-muted-foreground">See top developers</p>
            </div>
          </Button>

          <Button
            variant="outline"
            className="h-20 border-border text-foreground hover:bg-muted hover:border-muted-foreground"
            onClick={() => navigate('/developer/profile')}
            data-testid="profile-quick-btn"
          >
            <div className="text-center">
              <p className="font-semibold">My Profile</p>
              <p className="text-xs text-muted-foreground">View full stats</p>
            </div>
          </Button>
        </div>
      </div>
    </div>
  );
}
