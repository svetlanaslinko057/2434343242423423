import { useState, useEffect, useCallback } from 'react';
import { useAuth, API } from '@/App';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  Brain, AlertTriangle, Zap, Target, DollarSign, Eye, TestTube,
  ClipboardList, MessageCircle, Banknote, Package, CreditCard,
  Gift, TrendingUp, Rocket, Link, AlertCircle, Play, Award,
  X, ChevronRight, Sparkles
} from 'lucide-react';

const ICON_MAP = {
  'alert-triangle': AlertTriangle,
  'clipboard-list': ClipboardList,
  'eye': Eye,
  'test-tube': TestTube,
  'dollar-sign': DollarSign,
  'message-circle': MessageCircle,
  'zap': Zap,
  'banknote': Banknote,
  'package': Package,
  'credit-card': CreditCard,
  'gift': Gift,
  'trending-up': TrendingUp,
  'rocket': Rocket,
  'link': Link,
  'alert-circle': AlertCircle,
  'play': Play,
  'award': Award,
  'target': Target,
};

const PRIORITY_STYLES = {
  critical: { bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-400', badge: 'bg-red-500/20 text-red-400' },
  high: { bg: 'bg-amber-500/5', border: 'border-amber-500/15', text: 'text-amber-400', badge: 'bg-amber-500/20 text-amber-400' },
  medium: { bg: 'bg-signal/5', border: 'border-signal/15', text: 'text-signal', badge: 'bg-signal/20 text-signal' },
  low: { bg: 'bg-white/[0.02]', border: 'border-border', text: 'text-muted-foreground', badge: 'bg-muted text-muted-foreground' },
};

const TYPE_STYLES = {
  risk: { label: 'Risk', color: 'text-red-400' },
  action: { label: 'Action', color: 'text-amber-400' },
  opportunity: { label: 'Opportunity', color: 'text-emerald-400' },
};

const AIRecommendationsPanel = ({ compact = false }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [recs, setRecs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(new Set());

  const fetchRecs = useCallback(async () => {
    if (!user) return;
    try {
      const res = await axios.get(`${API}/ai/recommendations`, { withCredentials: true });
      setRecs(res.data.recommendations || []);
    } catch (err) {
      console.error('AI recommendations error:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchRecs(); }, [fetchRecs]);

  const handleDismiss = async (recId) => {
    setDismissed(prev => new Set([...prev, recId]));
    try {
      await axios.post(`${API}/ai/recommendations/${recId}/dismiss`, {}, { withCredentials: true });
    } catch (err) { /* ignore */ }
  };

  const handleAction = async (rec) => {
    try {
      await axios.post(`${API}/ai/recommendations/${rec.rec_id}/accept`, {}, { withCredentials: true });
    } catch (err) { /* ignore */ }

    const action = rec.action?.type;
    const payload = rec.action?.payload || {};

    switch (action) {
      case 'assign_tasks': navigate('/admin/dashboard'); break;
      case 'review_submissions': navigate('/admin/review'); break;
      case 'assign_testers': navigate('/admin/validation'); break;
      case 'approve_payouts': navigate('/admin/dashboard'); break;
      case 'view_tickets': navigate('/admin/dashboard'); break;
      case 'auto_assign': navigate('/admin/dashboard'); break;
      case 'view_invoices': navigate('/admin/dashboard'); break;
      case 'view_developer': navigate('/admin/users'); break;
      case 'review_deliverable': payload.project_id && navigate(`/client/projects/${payload.project_id}`); break;
      case 'pay_invoice': payload.invoice_id && navigate('/client/projects'); break;
      case 'create_referral_link': navigate('/client/referrals'); break;
      case 'share_referral': navigate('/client/referrals'); break;
      case 'new_request': navigate('/client/request/new'); break;
      case 'fix_revision': payload.unit_id && navigate(`/developer/work/${payload.unit_id}`); break;
      case 'start_work': payload.unit_id && navigate(`/developer/work/${payload.unit_id}`); break;
      case 'invite_devs': navigate('/developer/network'); break;
      case 'create_invite_link': navigate('/developer/network'); break;
      case 'check_achievements': navigate('/developer/network'); break;
      default: break;
    }
  };

  const visibleRecs = recs.filter(r => !dismissed.has(r.rec_id));

  if (loading) {
    return (
      <div className={`rounded-2xl border border-border bg-[var(--t-surface)] p-5 ${compact ? '' : ''}`} data-testid="ai-panel-loading">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-5 h-5 text-signal animate-pulse" />
          <span className="text-sm font-semibold text-muted-foreground">AI analyzing...</span>
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 rounded-xl bg-white/[0.02] border border-border animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (visibleRecs.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-[var(--t-surface)] p-5" data-testid="ai-panel-empty">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <Brain className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">All clear</div>
            <div className="text-xs text-muted-foreground">No recommendations right now. Great job!</div>
          </div>
        </div>
      </div>
    );
  }

  const displayRecs = compact ? visibleRecs.slice(0, 4) : visibleRecs;

  return (
    <div className="rounded-2xl border border-border bg-[var(--t-surface)] p-5" data-testid="ai-recommendations-panel">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-signal/10 flex items-center justify-center">
            <Brain className="w-5 h-5 text-signal" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white" data-testid="ai-panel-title">AI Recommendations</div>
            <div className="text-xs text-muted-foreground">{visibleRecs.length} action{visibleRecs.length !== 1 ? 's' : ''} suggested</div>
          </div>
        </div>
      </div>

      <div className="space-y-2" data-testid="ai-recommendations-list">
        {displayRecs.map((rec) => {
          const Icon = ICON_MAP[rec.icon] || Zap;
          const ps = PRIORITY_STYLES[rec.priority] || PRIORITY_STYLES.medium;
          const ts = TYPE_STYLES[rec.type] || TYPE_STYLES.action;

          return (
            <div
              key={rec.rec_id}
              className={`group relative flex items-start gap-3 p-3.5 rounded-xl border transition-all hover:bg-white/[0.02] ${ps.border} ${ps.bg}`}
              data-testid={`ai-rec-${rec.rec_id}`}
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${ps.bg} border ${ps.border}`}>
                <Icon className={`w-4.5 h-4.5 ${ps.text}`} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-white truncate">{rec.title}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${ps.badge}`}>{rec.priority}</span>
                  <span className={`text-[9px] font-medium ${ts.color}`}>{ts.label}</span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-1">{rec.message}</p>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleAction(rec)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-muted transition-colors"
                  title="Take action"
                  data-testid={`ai-rec-action-${rec.rec_id}`}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDismiss(rec.rec_id)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-muted-foreground hover:bg-muted transition-colors opacity-0 group-hover:opacity-100"
                  title="Dismiss"
                  data-testid={`ai-rec-dismiss-${rec.rec_id}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {compact && visibleRecs.length > 4 && (
        <div className="mt-3 text-center">
          <span className="text-xs text-muted-foreground">+{visibleRecs.length - 4} more recommendations</span>
        </div>
      )}
    </div>
  );
};

export default AIRecommendationsPanel;
