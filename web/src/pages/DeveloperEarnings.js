import { useState, useEffect } from 'react';
import { useAuth } from '@/App';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import { DollarSign, RefreshCw, Clock, CheckCircle2, Package, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

/**
 * DEVELOPER EARNINGS
 * Темная тема, behavioral economy: lost earnings, bonuses, penalties
 *
 * Step 6.2 Stage 2 — uses runtime-client. Reads only — no payment capability
 * tag (developers viewing their own earnings is honest empty-state friendly).
 */

const DeveloperEarnings = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  const [summary, setSummary] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [held, setHeld] = useState([]);
  const [flagged, setFlagged] = useState([]);
  const [batches, setBatches] = useState([]);

  const fetchEarningsData = async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      // 5 parallel reads — runtime-client dedup middleware will collapse
      // any duplicate in-flight calls (e.g. fast double-refresh).
      const [summaryRes, tasksRes, heldRes, flaggedRes, batchesRes] = await Promise.all([
        runtime.get('/api/developer/earnings/summary'),
        runtime.get('/api/developer/earnings/tasks'),
        runtime.get('/api/developer/earnings/held'),
        runtime.get('/api/developer/earnings/flagged'),
        runtime.get('/api/developer/payout/batches'),
      ]);

      setSummary(summaryRes.data);
      setTasks(summaryRes.data ? (tasksRes.data?.tasks || []) : []);
      setHeld(heldRes.data?.held_earnings || []);
      setFlagged(flaggedRes.data?.flagged_earnings || []);
      setBatches(batchesRes.data?.batches || []);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'unauthorized' || error.code === 'forbidden') {
          toast.error('Session expired', { description: 'Please sign in again.' });
        } else {
          toast.error('Failed to load earnings', {
            description: `${error.message} (req: ${error.requestId})`,
          });
        }
      } else {
        console.error('Error fetching earnings data:', error);
        toast.error('Failed to load earnings');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (user && user.role === 'developer') {
      fetchEarningsData();
    }
  }, [user]);

  const handleRefresh = () => {
    fetchEarningsData(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  const hasIssues = (held?.length || 0) > 0 || (flagged?.length || 0) > 0;

  return (
    <div className="min-h-screen bg-background text-foreground p-6" data-testid="developer-earnings">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-card">
              <DollarSign className="w-6 h-6 text-[color:var(--success)]" />
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                Earnings
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Track your task earnings and payout status
              </p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-card border border-border hover:border-muted-foreground transition-colors text-sm font-medium text-foreground disabled:opacity-50"
            data-testid="refresh-btn"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Main KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-card border border-border shadow-[var(--shadow-elev-1)]">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-3">
                <div className="p-2 rounded-lg bg-muted">
                  <Clock className="w-5 h-5 text-muted-foreground" />
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Pending QA</p>
                <p className="text-3xl font-semibold font-mono text-foreground" data-testid="pending-qa-amount">
                  ${summary?.pending_qa_amount?.toLocaleString() || '0'}
                </p>
                <p className="text-sm text-muted-foreground">{summary?.pending_qa_count || 0} task{summary?.pending_qa_count !== 1 ? 's' : ''}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-2 border-[color:var(--success-border)] shadow-[var(--shadow-elev-1)]">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-3">
                <div className="p-2 rounded-lg bg-[color:var(--success-surface)]">
                  <CheckCircle2 className="w-5 h-5 text-[color:var(--success)]" />
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Approved</p>
                <p className="text-3xl font-semibold font-mono text-[color:var(--success)]" data-testid="approved-amount">
                  ${summary?.approved_amount?.toLocaleString() || '0'}
                </p>
                <p className="text-sm text-muted-foreground">{summary?.approved_count || 0} task{summary?.approved_count !== 1 ? 's' : ''}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border border-[color:var(--info-border)] shadow-[var(--shadow-elev-1)]">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-3">
                <div className="p-2 rounded-lg bg-[color:var(--info-surface)]">
                  <Package className="w-5 h-5 text-[color:var(--info)]" />
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">In Batch</p>
                <p className="text-3xl font-semibold font-mono text-foreground" data-testid="batched-amount">
                  ${summary?.batched_amount?.toLocaleString() || '0'}
                </p>
                <p className="text-sm text-muted-foreground">{summary?.batched_count || 0} task{summary?.batched_count !== 1 ? 's' : ''}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border border-border shadow-[var(--shadow-elev-1)]">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-3">
                <div className="p-2 rounded-lg bg-muted">
                  <DollarSign className="w-5 h-5 text-muted-foreground" />
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Paid Total</p>
                <p className="text-3xl font-semibold font-mono text-foreground" data-testid="paid-total">
                  ${summary?.paid_total?.toLocaleString() || '0'}
                </p>
                <p className="text-sm text-muted-foreground">{summary?.paid_count || 0} task{summary?.paid_count !== 1 ? 's' : ''}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Issues Alert */}
        {hasIssues && (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-[color:var(--warning-surface)] border border-[color:var(--warning-border)]" role="alert">
            <AlertTriangle className="w-5 h-5 text-[color:var(--warning)] mt-0.5 flex-shrink-0" />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium text-[color:var(--warning)]">Attention Required</p>
              <p className="text-sm text-foreground">
                {held.length > 0 && (
                  <span>{held.length} earning{held.length !== 1 ? 's' : ''} held due to QA revisions</span>
                )}
                {held.length > 0 && flagged.length > 0 && ', '}
                {flagged.length > 0 && (
                  <span>{flagged.length} earning{flagged.length !== 1 ? 's' : ''} flagged for low confidence</span>
                )}
              </p>
            </div>
          </div>
        )}

        {/* Held & Flagged */}
        {(held.length > 0 || flagged.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {held.length > 0 && (
              <Card className="bg-card border-l-4 border-l-[color:var(--danger)] border-t border-r border-b border-border shadow-[var(--shadow-elev-1)]">
                <CardHeader>
                  <CardTitle className="text-[color:var(--danger)] flex items-center gap-2">
                    <TrendingDown className="w-5 h-5" />
                    Held Earnings ({held.length})
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">Blocked by QA revisions</p>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {held.slice(0, 3).map((item, idx) => (
                      <div key={idx} className="p-3 rounded-lg bg-muted border border-border">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <p className="text-sm text-foreground font-medium">{item.task_title || 'Task'}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {item.reason || item.hold_reason || 'QA revision required'}
                            </p>
                          </div>
                          <p className="text-sm font-mono text-[color:var(--danger)]">-${item.amount}</p>
                        </div>
                      </div>
                    ))}
                    {held.length > 3 && (
                      <p className="text-sm text-muted-foreground text-center pt-2">+{held.length - 3} more</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {flagged.length > 0 && (
              <Card className="bg-card border-l-4 border-l-[color:var(--warning)] border-t border-r border-b border-border shadow-[var(--shadow-elev-1)]">
                <CardHeader>
                  <CardTitle className="text-[color:var(--warning)] flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5" />
                    Flagged Earnings ({flagged.length})
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">Low confidence</p>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {flagged.slice(0, 3).map((item, idx) => (
                      <div key={idx} className="p-3 rounded-lg bg-muted border border-border">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <p className="text-sm text-foreground font-medium">{item.task_title || 'Task'}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {item.reason || item.flag_reason || 'Admin decision required'}
                            </p>
                          </div>
                          <p className="text-sm font-mono text-[color:var(--warning)]">${item.amount}</p>
                        </div>
                      </div>
                    ))}
                    {flagged.length > 3 && (
                      <p className="text-sm text-muted-foreground text-center pt-2">+{flagged.length - 3} more</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Recent Tasks */}
        <Card className="bg-card border border-border shadow-[var(--shadow-elev-1)]">
          <CardHeader>
            <CardTitle className="text-foreground">Recent Task Earnings</CardTitle>
          </CardHeader>
          <CardContent>
            {tasks.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No earnings yet</p>
            ) : (
              <div className="space-y-2">
                {tasks.slice(0, 10).map((task, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-muted border border-border hover:border-border transition-colors">
                    <div className="flex-1">
                      <p className="text-sm text-foreground font-medium">{task.task_title}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <Badge className={`text-xs ${
                          task.status === 'approved' ? 'bg-[color:var(--success-surface)] border-[color:var(--success-border)] text-[color:var(--success)]' :
                          task.status === 'pending_qa' ? 'bg-muted border-border text-muted-foreground' :
                          task.status === 'batched' ? 'bg-[color:var(--info-surface)] border-[color:var(--info-border)] text-[color:var(--info)]' :
                          'bg-muted border-border text-muted-foreground'
                        }`}>
                          {task.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{task.completed_date || 'Recently'}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold font-mono text-foreground">${task.amount}</p>
                      {task.bonus && (
                        <p className="text-xs text-[color:var(--success)]">+{task.bonus}% bonus</p>
                      )}
                      {task.penalty && (
                        <p className="text-xs text-[color:var(--danger)]">-{task.penalty}% penalty</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Batches */}
        {batches.length > 0 && (
          <Card className="bg-card border border-border shadow-[var(--shadow-elev-1)]">
            <CardHeader>
              <CardTitle className="text-foreground">Payout Batches</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {batches.map((batch, idx) => (
                  <div key={idx} className="p-4 rounded-lg bg-muted border border-border">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">Batch #{batch.batch_id?.slice(-8) || idx}</p>
                        <p className="text-xs text-muted-foreground">{batch.created_date || 'Recent'}</p>
                      </div>
                      <Badge className={`${
                        batch.status === 'paid' ? 'bg-[color:var(--success-surface)] border-[color:var(--success-border)] text-[color:var(--success)]' :
                        batch.status === 'approved' ? 'bg-[color:var(--info-surface)] border-[color:var(--info-border)] text-[color:var(--info)]' :
                        'bg-muted border-border text-muted-foreground'
                      }`}>
                        {batch.status}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">{batch.earnings_count || 0} earnings</p>
                      <p className="text-xl font-bold font-mono text-foreground">${batch.total_amount?.toLocaleString() || '0'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default DeveloperEarnings;
