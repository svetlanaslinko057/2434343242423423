import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import {
  CheckCircle2, Circle, Clock, Lock, Unlock, DollarSign,
  ArrowRight, FileText, CreditCard, Package, ChevronRight,
  Loader2, AlertCircle, Sparkles, BarChart3
} from 'lucide-react';

/**
 * ClientCabinet — slice #3 (ClientCabinet) governance notes:
 *   - Single canonical aggregator: /api/client/projects/{id}/full
 *     owns ALL derivation, ALL chronology, ALL counts.
 *   - Slice #3 D-5 fix: payment-failure path replaced alert() with
 *     inline `actionError` state — no browser modal, no I-10 collapse.
 *   - Slice #3 D-1 (BD-15) does NOT touch this surface: web cabinet
 *     already consumes server-computed counters via `/full`. The promotion
 *     was for the parallel `/workspace` endpoint consumed by mobile.
 *   - BD-14 ("one open invoice per module") is NOT present on this surface:
 *     web cabinet renders deliverable.locked / unpaid_deliverable from
 *     backend directly, no client-side per-module invoice synthesis.
 *   - No optimistic mutations: action POST → refetch pattern.
 */
const ClientCabinet = () => {
  const { projectId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [payingDeliverable, setPayingDeliverable] = useState(null);
  const [paymentSuccess, setPaymentSuccess] = useState(null);
  const [actionError, setActionError] = useState(null);

  const fetchProject = useCallback(async () => {
    setError(null);
    try {
      const res = await runtime.get(`/api/client/projects/${projectId}/full`);
      setData(res.data);
    } catch (err) {
      setError(err?.response?.data?.message || err?.response?.data?.detail || 'Failed to load project');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchProject(); }, [fetchProject]);

  const handlePayDeliverable = async (deliverableId) => {
    setActionError(null);
    setPayingDeliverable(deliverableId);
    try {
      await runtime.post(`/api/client/deliverables/${deliverableId}/simulate-payment`, {});
      setPaymentSuccess(deliverableId);
      setTimeout(() => setPaymentSuccess(null), 3000);
      await fetchProject(); // Refresh data
    } catch (err) {
      // Slice #3 D-5: inline error, not alert().
      setActionError(
        err?.response?.data?.message ||
        err?.response?.data?.detail ||
        'Payment failed. Please try again.'
      );
    } finally {
      setPayingDeliverable(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 text-signal animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-screen text-center p-8">
        <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
        <h2 className="text-lg font-semibold text-white mb-2">Project Not Found</h2>
        <p className="text-zinc-500 text-sm mb-6">{error}</p>
        <button 
          onClick={() => navigate('/client/dashboard')}
          className="px-4 py-2 bg-muted hover:bg-muted border border-border rounded-lg text-sm text-white transition-colors"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  const { project, timeline, workspace, deliverables, invoices, next_action } = data;

  return (
    <div className="min-h-screen p-6 lg:p-8 max-w-5xl mx-auto" data-testid="client-cabinet">

      {/* Slice #3 D-5: inline action error (replaces alert()) */}
      {actionError && (
        <div
          className="mb-4 flex items-start gap-3 p-4 border border-red-500/30 bg-red-500/10 rounded-xl"
          data-testid="cabinet-action-error"
        >
          <AlertCircle className="w-5 h-5 text-red-400 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-red-200">{actionError}</p>
          </div>
          <button
            onClick={() => setActionError(null)}
            className="text-red-300 hover:text-red-200 text-sm"
            data-testid="cabinet-action-error-dismiss"
          >
            Dismiss
          </button>
        </div>
      )}
      {/* HERO BLOCK */}
      <section className="mb-8" data-testid="project-hero">
        <div className="rounded-2xl bg-card border border-border p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-80 h-80 pointer-events-none" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{project.status}</span>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2" data-testid="project-name">{project.name}</h1>
            
            {/* Progress Bar */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-zinc-500">Progress</span>
                <span className="text-xs font-bold text-white" data-testid="project-progress">{project.progress}%</span>
              </div>
              <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-signal rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(project.progress, 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TIMELINE */}
      <section className="mb-8" data-testid="project-timeline">
        <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500 mb-4">Timeline</h2>
        <div className="flex items-center gap-0">
          {timeline.map((step, idx) => (
            <div key={step.stage} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-colors ${
                  step.done 
                    ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' 
                    : 'bg-zinc-900 border-zinc-700 text-zinc-600'
                }`}>
                  {step.done ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                </div>
                <span className={`text-[10px] mt-1.5 font-medium ${step.done ? 'text-emerald-400' : 'text-zinc-600'}`}>
                  {step.label}
                </span>
              </div>
              {idx < timeline.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 ${
                  step.done ? 'bg-emerald-500/40' : 'bg-zinc-800'
                }`} />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* NEXT ACTION (IMPORTANT) */}
      {next_action && next_action.type !== 'none' && (
        <section className="mb-8" data-testid="next-action-block">
          <div className={`rounded-xl p-5 border ${
            next_action.type === 'pay' 
              ? 'bg-signal/15 border-amber-500/20' 
              : next_action.type === 'review'
              ? 'bg-signal/10 border-signal/30'
              : 'bg-zinc-900/60 border-zinc-800'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  next_action.type === 'pay' ? 'bg-amber-500/20' :
                  next_action.type === 'review' ? 'bg-signal/15' : 'bg-zinc-800'
                }`}>
                  {next_action.type === 'pay' ? <CreditCard className="w-5 h-5 text-amber-400" /> :
                   next_action.type === 'review' ? <Package className="w-5 h-5 text-signal" /> :
                   next_action.type === 'complete' ? <Sparkles className="w-5 h-5 text-emerald-400" /> :
                   <Clock className="w-5 h-5 text-zinc-500" />}
                </div>
                <div>
                  <p className="text-xs text-zinc-500 uppercase tracking-wider font-medium">Next Step</p>
                  <p className="text-sm font-semibold text-white" data-testid="next-action-message">{next_action.message}</p>
                </div>
              </div>
              {(next_action.type === 'pay' || next_action.type === 'review') && (
                <button 
                  onClick={() => {
                    if (next_action.type === 'pay' && next_action.deliverable_id) {
                      handlePayDeliverable(next_action.deliverable_id);
                    }
                  }}
                  disabled={payingDeliverable}
                  className="flex items-center gap-1.5 px-4 py-2 bg-muted hover:bg-muted border border-border rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
                  data-testid="next-action-btn"
                >
                  {payingDeliverable ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {next_action.type === 'pay' ? 'Pay Now' : 'Review'}
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* WORKSPACE */}
      {(workspace.in_progress.length > 0 || workspace.recent_completed.length > 0 || workspace.under_review.length > 0) && (
        <section className="mb-8" data-testid="workspace-section">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500 mb-4">Workspace</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {/* Currently Building */}
            {workspace.in_progress.length > 0 && (
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Currently Building</h3>
                </div>
                <div className="space-y-2">
                  {workspace.in_progress.map(task => (
                    <div key={task.unit_id} className="flex items-center gap-2 text-sm">
                      <div className="w-1 h-1 rounded-full bg-emerald-400" />
                      <span className="text-zinc-300">{task.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recently Completed */}
            {workspace.recent_completed.length > 0 && (
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="w-3.5 h-3.5 text-signal" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Recently Done</h3>
                </div>
                <div className="space-y-2">
                  {workspace.recent_completed.map(task => (
                    <div key={task.unit_id} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="w-3 h-3 text-signal/60" />
                      <span className="text-zinc-400">{task.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Task count summary */}
          {workspace.total_tasks > 0 && (
            <div className="mt-3 flex items-center gap-3 text-xs text-zinc-500">
              <span>{workspace.done_tasks}/{workspace.total_tasks} tasks completed</span>
              {workspace.under_review.length > 0 && (
                <span className="text-signal">{workspace.under_review.length} under review</span>
              )}
            </div>
          )}
        </section>
      )}

      {/* DELIVERABLES */}
      {deliverables.length > 0 && (
        <section className="mb-8" data-testid="deliverables-section">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500 mb-4">Deliverables</h2>
          <div className="space-y-3">
            {deliverables.map(d => (
              <div 
                key={d.deliverable_id} 
                className={`flex items-center justify-between bg-zinc-900/60 border rounded-xl p-4 transition-colors ${
                  d.locked ? 'border-amber-500/20 hover:border-amber-500/30' : 'border-zinc-800 hover:border-zinc-700'
                }`}
                data-testid={`deliverable-${d.deliverable_id}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    d.locked ? 'bg-amber-500/10' : 'bg-emerald-500/10'
                  }`}>
                    {d.locked ? <Lock className="w-5 h-5 text-amber-400" /> : <Unlock className="w-5 h-5 text-emerald-400" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{d.title}</p>
                    <p className="text-xs text-zinc-500">{d.version} · {d.status}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {d.price && (
                    <span className="text-sm font-bold text-white">${d.price}</span>
                  )}
                  {d.locked && d.price && (
                    <button 
                      onClick={() => handlePayDeliverable(d.deliverable_id)}
                      disabled={payingDeliverable === d.deliverable_id}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/20 rounded-lg text-xs font-medium text-amber-400 transition-colors disabled:opacity-50"
                      data-testid={`pay-deliverable-${d.deliverable_id}`}
                    >
                      {payingDeliverable === d.deliverable_id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CreditCard className="w-3.5 h-3.5" />
                      )}
                      {payingDeliverable === d.deliverable_id ? 'Processing...' : 'Pay'}
                    </button>
                  )}
                  {paymentSuccess === d.deliverable_id && (
                    <span className="flex items-center gap-1 text-xs text-emerald-400 animate-pulse">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Paid!
                    </span>
                  )}
                  {!d.locked && (
                    <span className="flex items-center gap-1 text-xs text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Available
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* INVOICES */}
      {invoices.length > 0 && (
        <section className="mb-8" data-testid="invoices-section">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500 mb-4">Invoices</h2>
          <div className="space-y-2">
            {invoices.map(inv => (
              <div 
                key={inv.invoice_id} 
                className="flex items-center justify-between bg-zinc-900/40 border border-zinc-800/60 rounded-xl px-4 py-3"
                data-testid={`invoice-${inv.invoice_id}`}
              >
                <div className="flex items-center gap-3">
                  <FileText className="w-4 h-4 text-zinc-500" />
                  <div>
                    <p className="text-sm text-white">{inv.title || `Invoice #${inv.invoice_id?.slice(-6)}`}</p>
                    <p className="text-xs text-zinc-500">{inv.created_at ? new Date(inv.created_at).toLocaleDateString() : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-white">${inv.amount}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                    inv.status === 'paid' ? 'bg-emerald-500/20 text-emerald-400' :
                    inv.status === 'pending_payment' ? 'bg-amber-500/20 text-amber-400' :
                    'bg-zinc-800 text-zinc-500'
                  }`}>{inv.status.replace('_', ' ')}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* EMPTY STATE */}
      {deliverables.length === 0 && invoices.length === 0 && workspace.total_tasks === 0 && (
        <div className="text-center py-16" data-testid="empty-cabinet">
          <div className="w-16 h-16 bg-zinc-900 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-zinc-800">
            <BarChart3 className="w-8 h-8 text-zinc-600" />
          </div>
          <h3 className="text-lg font-semibold text-zinc-300 mb-2">Project is being set up</h3>
          <p className="text-zinc-500 text-sm">Once development begins, you'll see progress here</p>
        </div>
      )}
    </div>
  );
};

export default ClientCabinet;
