import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import {
  Sparkles,
  DollarSign,
  Clock,
  CheckCircle2,
  Loader2,
  ArrowRight,
  Zap,
  Calculator,
  Brain,
  TrendingUp,
  Shield,
  Target,
  Info,
  BarChart3,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

const ClientEstimatePage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [idea, setIdea] = useState('');
  const [estimate, setEstimate] = useState(null);
  const [smartEstimate, setSmartEstimate] = useState(null);
  const [productionEstimate, setProductionEstimate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showExplain, setShowExplain] = useState(false);

  const handleEstimate = async () => {
    if (!idea.trim()) return;
    setLoading(true);
    setError(null);
    
    try {
      // Iteration 3 (May 18, 2026) — Pricing Reality Layer charter Rule 5:
      // First-party frontends MUST NOT call /api/ai/estimate anymore. That
      // legacy endpoint uses the static $25/h rate and has no Reality Layer.
      // The deprecated `estimate` state below is kept ONLY as a passive
      // fallback for legacy display fields when production + template both
      // fail; we no longer hit the legacy endpoint to populate it.
      //
      // Two parallel paths (was three):
      //  • /api/estimate          — production-aware engine (Reality Layer, narrative chips)
      //  • /api/ai/estimate-price — data-driven template match (kept for "based on N projects" UX)
      const [productionRes, smartRes] = await Promise.allSettled([
        runtime.post(`/api/estimate`, { goal: idea, mode: 'hybrid' }),
        runtime.post(`/api/ai/estimate-price`, { idea }),
      ]);

      if (productionRes.status === 'fulfilled' && productionRes.value?.data?.estimate) {
        setProductionEstimate(productionRes.value.data);
      }
      if (smartRes.status === 'fulfilled' && smartRes.value?.data?.pricing_found) {
        setSmartEstimate(smartRes.value.data);
      }

      if (
        productionRes.status === 'rejected' &&
        smartRes.status === 'rejected'
      ) {
        setError('Failed to generate estimate. Please try again.');
      }
    } catch (err) {
      setError('Failed to generate estimate. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleProceed = () => {
    navigate('/client/dashboard', { state: { prefilledIdea: idea } });
  };

  // Pricing precedence: production-aware (Reality Layer) > template-match > legacy rule-based.
  // We keep all three sources so legacy display fields (hours/weeks) still render even
  // when /api/estimate is the primary source of truth.
  const mainPrice =
    productionEstimate?.estimate?.final_price ||
    smartEstimate?.estimate?.recommended_price ||
    estimate?.estimate?.final_price;
  const mainHours =
    productionEstimate?.estimate?.estimated_hours ||
    smartEstimate?.estimate?.avg_hours ||
    estimate?.estimate?.hours;
  const mainWeeks = smartEstimate?.estimate?.estimated_weeks || estimate?.estimate?.timeline_weeks;
  // Reality Layer chips (production-aware narrative) — never numbers, only words.
  const realityChips = productionEstimate?.reality_layer?.narrative_chips || [];

  return (
    <div className="max-w-4xl mx-auto space-y-8" data-testid="client-estimate-page">
      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-signal/10 mb-4">
          <Calculator className="w-8 h-8 text-signal" />
        </div>
        <h1 className="text-3xl font-bold">Instant Project Estimate</h1>
        <p className="text-muted-foreground mt-2 max-w-lg mx-auto">
          Describe your project idea and get a data-driven cost estimate
        </p>
      </div>

      {/* Input Section */}
      <div className="rounded-2xl border border-border bg-[var(--t-surface-raised)] p-6">
        <label className="block text-sm text-muted-foreground mb-3">Describe your project</label>
        <textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder="e.g. I want to build a marketplace with user authentication, payment processing, chat between buyers and sellers, and an admin dashboard..."
          className="w-full h-40 bg-black/30 border border-border rounded-xl p-4 text-white placeholder:text-muted-foreground focus:outline-none focus:border-signal/30 resize-none"
          data-testid="estimate-idea-input"
        />
        
        <button
          onClick={handleEstimate}
          disabled={loading || !idea.trim()}
          className="mt-4 w-full py-4 bg-signal hover:bg-signal-hover disabled:opacity-50 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2"
          data-testid="get-estimate-btn"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <Sparkles className="w-5 h-5" />
              Get Instant Estimate
            </>
          )}
        </button>
        
        {error && (
          <p className="mt-3 text-red-400 text-sm text-center">{error}</p>
        )}
      </div>

      {/* Estimate Result */}
      {(productionEstimate || smartEstimate || estimate) && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* Price Card */}
          <div className="rounded-2xl border border-emerald-500/30 bg-signal/15 p-8 text-center">
            <div className="text-muted-foreground text-sm mb-2">Estimated Cost</div>
            <div className="text-5xl font-bold text-emerald-400 mb-2" data-testid="estimate-price">
              ${mainPrice ? Math.round(mainPrice).toLocaleString() : '—'}
            </div>
            <div className="flex items-center justify-center gap-4 text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                ~{mainHours || 0} hours
              </span>
              <span className="flex items-center gap-1">
                <Zap className="w-4 h-4" />
                ~{mainWeeks || 0} weeks
              </span>
            </div>

            {/* Reality Layer narrative chips — explains the WHY without numbers.
                Mirrors the Expo /estimate-result UX (full parity).
                Hidden by default for tiny/baseline projects (axes all ×1.00 → no chips). */}
            {realityChips.length > 0 && (
              <div
                className="mt-4 flex flex-wrap justify-center gap-2 max-w-xl mx-auto"
                data-testid="estimate-reality-chips"
              >
                {realityChips.slice(0, 5).map((chip, i) => (
                  <span
                    key={`chip-${i}`}
                    className="px-3 py-1 rounded-full text-xs font-semibold tracking-wide bg-black/30 border border-border text-zinc-300"
                    data-testid={`reality-chip-${i}`}
                  >
                    {chip}
                  </span>
                ))}
              </div>
            )}

            {/* Smart pricing badge */}
            {smartEstimate && (
              <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-signal/10 border border-signal/30">
                <Brain className="w-3.5 h-3.5 text-signal" />
                <span className="text-xs text-signal">
                  Based on {smartEstimate.estimate?.template_name} template 
                  · {(smartEstimate.estimate?.confidence * 100).toFixed(0)}% confidence
                </span>
              </div>
            )}
          </div>

          {/* Why this price - Data driven */}
          {smartEstimate && (
            <div className="rounded-2xl border border-signal/30 bg-[var(--t-surface-raised)] p-6">
              <button
                onClick={() => setShowExplain(!showExplain)}
                className="w-full flex items-center justify-between"
                data-testid="why-this-price-btn"
              >
                <div className="flex items-center gap-2">
                  <Info className="w-5 h-5 text-signal" />
                  <h3 className="font-semibold">Why this price?</h3>
                </div>
                {showExplain ? <ChevronUp className="w-5 h-5 text-zinc-500" /> : <ChevronDown className="w-5 h-5 text-zinc-500" />}
              </button>
              
              {showExplain && (
                <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-black/30 border border-border">
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="w-4 h-4 text-signal" />
                      <span className="text-xs text-zinc-400">Estimated Hours</span>
                    </div>
                    <div className="text-xl font-bold text-white">{smartEstimate.estimate?.avg_hours}h</div>
                    <div className="text-xs text-zinc-600">based on similar projects</div>
                  </div>
                  <div className="p-4 rounded-xl bg-black/30 border border-border">
                    <div className="flex items-center gap-2 mb-2">
                      <Target className="w-4 h-4 text-signal" />
                      <span className="text-xs text-zinc-400">Template Match</span>
                    </div>
                    <div className="text-xl font-bold text-white">{(smartEstimate.estimate?.similarity * 100).toFixed(0)}%</div>
                    <div className="text-xs text-zinc-600">{smartEstimate.estimate?.template_name}</div>
                  </div>
                  <div className="p-4 rounded-xl bg-black/30 border border-border">
                    <div className="flex items-center gap-2 mb-2">
                      <Shield className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs text-zinc-400">Success Rate</span>
                    </div>
                    <div className="text-xl font-bold text-white">{(smartEstimate.estimate?.success_rate * 100).toFixed(0)}%</div>
                    <div className="text-xs text-zinc-600">across {smartEstimate.estimate?.usage_count} projects</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Features Included (from rule-based) */}
          {estimate?.features?.length > 0 && (
            <div className="rounded-2xl border border-border bg-[var(--t-surface-raised)] p-6">
              <h3 className="font-semibold mb-4">Features Included</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {estimate.features.map((feature, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-muted">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                    <span className="text-muted-foreground">{feature}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Price Breakdown */}
          {estimate?.estimate?.breakdown && (
            <div className="rounded-2xl border border-border bg-[var(--t-surface-raised)] p-6">
              <h3 className="font-semibold mb-4">Price Breakdown</h3>
              <div className="space-y-3">
                <div className="flex justify-between text-muted-foreground">
                  <span>Development</span>
                  <span>${estimate.estimate.breakdown.development}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Complexity Factor</span>
                  <span>${estimate.estimate.breakdown.complexity}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Risk Buffer</span>
                  <span>${estimate.estimate.breakdown.risk_buffer}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Platform Fee</span>
                  <span>${estimate.estimate.breakdown.platform_fee}</span>
                </div>
                <div className="border-t border-border pt-3 flex justify-between font-semibold">
                  <span>Total</span>
                  <span className="text-emerald-400">${mainPrice ? Math.round(mainPrice).toLocaleString() : '—'}</span>
                </div>
              </div>
            </div>
          )}

          {/* CTA */}
          <div className="flex gap-4">
            <button
              onClick={handleProceed}
              className="flex-1 py-4 bg-white hover:bg-muted text-black font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              data-testid="proceed-btn"
            >
              Start Project
              <ArrowRight className="w-5 h-5" />
            </button>
            <button
              onClick={() => { setEstimate(null); setSmartEstimate(null); setIdea(''); }}
              className="px-6 py-4 border border-border hover:bg-muted text-muted-foreground rounded-xl transition-colors"
            >
              New Estimate
            </button>
          </div>

          {/* Disclaimer */}
          <p className="text-center text-muted-foreground text-xs">
            This estimate is based on AI analysis and historical project data. Final pricing may vary based on detailed requirements.
          </p>
        </div>
      )}
    </div>
  );
};

export default ClientEstimatePage;
