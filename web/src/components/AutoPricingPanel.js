import { useState } from 'react';
import { API } from '@/App';
import axios from 'axios';
import {
  Brain,
  DollarSign,
  Clock,
  TrendingUp,
  Loader2,
  ChevronDown,
  ChevronUp,
  Zap,
  Shield,
  Info,
  AlertTriangle,
  CheckCircle2,
  Target,
  BarChart3,
  Edit3
} from 'lucide-react';

const AutoPricingPanel = ({ idea, requestId, onPriceSelected, compact = false }) => {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showExplain, setShowExplain] = useState(false);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [overrideMode, setOverrideMode] = useState(false);
  const [finalPrice, setFinalPrice] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);

  const handleEstimate = async () => {
    if (!idea?.trim()) return;
    setLoading(true);
    setError(null);
    
    try {
      const res = await axios.post(`${API}/ai/estimate-price`, {
        idea,
        request_id: requestId || null
      }, { withCredentials: true });
      
      setResult(res.data);
      if (res.data?.estimate?.recommended_price) {
        setFinalPrice(String(Math.round(res.data.estimate.recommended_price)));
        if (onPriceSelected) {
          onPriceSelected(res.data.estimate.recommended_price);
        }
      }
    } catch (err) {
      setError('Failed to generate pricing estimate');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveOverride = async () => {
    if (!finalPrice) return;
    setSavingOverride(true);
    try {
      await axios.post(`${API}/ai/price-override`, {
        ai_price: result?.estimate?.recommended_price || null,
        final_price: parseFloat(finalPrice),
        override_reason: overrideReason,
        request_id: requestId || null
      }, { withCredentials: true });
      
      setOverrideMode(false);
      if (onPriceSelected) {
        onPriceSelected(parseFloat(finalPrice));
      }
    } catch (err) {
      console.error('Override save error:', err);
    } finally {
      setSavingOverride(false);
    }
  };

  const confidenceColor = (conf) => {
    if (conf >= 0.8) return 'text-emerald-400';
    if (conf >= 0.6) return 'text-amber-400';
    return 'text-red-400';
  };

  const confidenceBg = (conf) => {
    if (conf >= 0.8) return 'bg-emerald-500/10 border-emerald-800/30';
    if (conf >= 0.6) return 'bg-amber-500/10 border-amber-800/30';
    return 'bg-red-500/10 border-red-800/30';
  };

  if (!result && !loading) {
    return (
      <div className={`rounded-2xl border border-signal/30 bg-signal/5 ${compact ? 'p-4' : 'p-6'}`} data-testid="auto-pricing-panel">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-signal/10">
              <Brain className="w-5 h-5 text-signal" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Auto Pricing</h3>
              <p className="text-xs text-zinc-500">Data-driven price from historical templates</p>
            </div>
          </div>
          <button
            onClick={handleEstimate}
            disabled={loading || !idea?.trim()}
            className="px-4 py-2.5 bg-signal hover:bg-signal disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors flex items-center gap-2"
            data-testid="generate-price-btn"
          >
            <Zap className="w-4 h-4" />
            Generate Price
          </button>
        </div>
        {error && <p className="mt-3 text-red-400 text-sm">{error}</p>}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-signal/30 bg-signal/5 p-6" data-testid="auto-pricing-panel">
        <div className="flex items-center justify-center gap-3 py-8">
          <Loader2 className="w-6 h-6 animate-spin text-signal" />
          <span className="text-zinc-400">Analyzing templates & historical data...</span>
        </div>
      </div>
    );
  }

  if (result && !result.pricing_found) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6" data-testid="auto-pricing-panel">
        <div className="flex items-center gap-3 mb-3">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
          <h3 className="font-semibold text-white">No Pricing Data</h3>
        </div>
        <p className="text-sm text-zinc-400 mb-4">{result.fallback?.message || 'No strong template match found.'}</p>
        <button
          onClick={() => { setResult(null); setError(null); }}
          className="text-sm text-signal hover:text-signal"
        >
          Try again
        </button>
      </div>
    );
  }

  const est = result?.estimate;
  if (!est) return null;

  return (
    <div className="rounded-2xl border border-signal/30 bg-signal/5 p-6 space-y-5" data-testid="auto-pricing-panel">
      {/* Header with template match info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-signal/10">
            <Brain className="w-5 h-5 text-signal" />
          </div>
          <div>
            <h3 className="font-semibold text-white">AI Price Estimate</h3>
            <p className="text-xs text-zinc-500">Based on: <span className="text-signal">{est.template_name}</span></p>
          </div>
        </div>
        <div className={`px-3 py-1.5 rounded-xl text-xs font-medium border ${confidenceBg(est.confidence)}`}>
          <span className={confidenceColor(est.confidence)}>
            {(est.confidence * 100).toFixed(0)}% confidence
          </span>
        </div>
      </div>

      {/* Main Price Card */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2 rounded-xl border border-signal/30 bg-signal/10 p-5">
          <div className="text-sm text-signal/70">Recommended Price</div>
          <div className="text-4xl font-bold text-white mt-1">
            ${Math.round(est.recommended_price).toLocaleString()}
          </div>
          <div className="flex items-center gap-4 mt-2 text-sm text-zinc-400">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              ~{est.avg_hours}h
            </span>
            <span className="flex items-center gap-1">
              <Target className="w-3.5 h-3.5" />
              ~{est.estimated_weeks} week{est.estimated_weeks > 1 ? 's' : ''}
            </span>
          </div>
        </div>
        
        <div className="rounded-xl border border-zinc-800 bg-black/50 p-4">
          <div className="text-xs text-zinc-500">Similarity</div>
          <div className="text-2xl font-bold text-white mt-1">{(est.similarity * 100).toFixed(0)}%</div>
          <div className="text-xs text-zinc-500 mt-1">match score</div>
        </div>
        
        <div className="rounded-xl border border-zinc-800 bg-black/50 p-4">
          <div className="text-xs text-zinc-500">Margin</div>
          <div className="text-2xl font-bold text-emerald-400 mt-1">{(est.avg_margin * 100).toFixed(0)}%</div>
          <div className="text-xs text-zinc-500 mt-1">avg historical</div>
        </div>
      </div>

      {/* Why this price - expandable */}
      <div className="rounded-xl border border-zinc-800 bg-black/30">
        <button
          onClick={() => setShowExplain(!showExplain)}
          className="w-full flex items-center justify-between p-4 hover:bg-muted transition-colors rounded-xl"
          data-testid="show-explain-btn"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
            <Info className="w-4 h-4 text-zinc-500" />
            Why this price?
          </div>
          {showExplain ? <ChevronUp className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
        </button>
        
        {showExplain && (
          <div className="px-4 pb-4 space-y-3 text-sm border-t border-zinc-800/50 pt-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 text-zinc-400">
                <Clock className="w-3.5 h-3.5 text-zinc-600" />
                <span>Based on <span className="text-white">{est.explain?.hours_basis}h</span> historical average</span>
              </div>
              <div className="flex items-center gap-2 text-zinc-400">
                <DollarSign className="w-3.5 h-3.5 text-zinc-600" />
                <span>Rate: <span className="text-white">${est.explain?.hourly_rate}/h</span></span>
              </div>
              <div className="flex items-center gap-2 text-zinc-400">
                <TrendingUp className="w-3.5 h-3.5 text-zinc-600" />
                <span>Margin: <span className="text-white">{est.explain?.margin_basis}%</span></span>
              </div>
              <div className="flex items-center gap-2 text-zinc-400">
                <BarChart3 className="w-3.5 h-3.5 text-zinc-600" />
                <span>Used in <span className="text-white">{est.explain?.projects_used}</span> projects</span>
              </div>
              <div className="flex items-center gap-2 text-zinc-400">
                <Shield className="w-3.5 h-3.5 text-zinc-600" />
                <span>Success rate: <span className="text-white">{est.explain?.success_rate_pct}%</span></span>
              </div>
              {est.explain?.historical_price_basis > 0 && (
                <div className="flex items-center gap-2 text-zinc-400">
                  <DollarSign className="w-3.5 h-3.5 text-zinc-600" />
                  <span>Hist. avg price: <span className="text-white">${est.explain?.historical_price_basis}</span></span>
                </div>
              )}
            </div>
            
            <div className="text-xs text-zinc-600 border-t border-zinc-800/50 pt-2">
              Price = (hours * rate) / (1 - margin)
              {est.explain?.historical_price_basis > 0 && ' · Blended with historical pricing'}
              {est.explain?.used_low_confidence_buffer && ' · +10% safety buffer (low confidence)'}
            </div>
          </div>
        )}
      </div>

      {/* Alternatives */}
      {result?.alternatives?.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-black/30">
          <button
            onClick={() => setShowAlternatives(!showAlternatives)}
            className="w-full flex items-center justify-between p-4 hover:bg-muted transition-colors rounded-xl"
            data-testid="show-alternatives-btn"
          >
            <span className="text-sm font-medium text-zinc-300">Alternative estimates</span>
            {showAlternatives ? <ChevronUp className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
          </button>
          
          {showAlternatives && (
            <div className="px-4 pb-4 space-y-2 border-t border-zinc-800/50 pt-3">
              {result.alternatives.map((alt, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-zinc-900/50">
                  <div>
                    <span className="text-sm text-white">{alt.template_name}</span>
                    <span className="text-xs text-zinc-500 ml-2">{(alt.similarity * 100).toFixed(0)}% match</span>
                  </div>
                  <div className="text-sm font-medium text-zinc-300">
                    ${Math.round(alt.estimated_price).toLocaleString()} · {alt.avg_hours}h
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Admin Override */}
      <div className="rounded-xl border border-zinc-800 bg-black/30 p-4">
        {!overrideMode ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <div>
                <div className="text-sm font-medium text-white">
                  Final Price: <span className="text-emerald-400">${parseInt(finalPrice || 0).toLocaleString()}</span>
                </div>
                <div className="text-xs text-zinc-500">Click override to adjust</div>
              </div>
            </div>
            <button
              onClick={() => setOverrideMode(true)}
              className="px-3 py-1.5 text-xs border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 rounded-lg transition-colors flex items-center gap-1.5"
              data-testid="override-price-btn"
            >
              <Edit3 className="w-3 h-3" />
              Override
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <Edit3 className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-medium text-amber-400">Admin Override</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Final Price ($)</label>
                <input
                  type="number"
                  value={finalPrice}
                  onChange={(e) => setFinalPrice(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-signal/50"
                  data-testid="override-price-input"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Reason</label>
                <input
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="e.g. extra integrations"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-signal/50"
                  data-testid="override-reason-input"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSaveOverride}
                disabled={savingOverride || !finalPrice}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                data-testid="save-override-btn"
              >
                {savingOverride ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Save Override
              </button>
              <button
                onClick={() => {
                  setOverrideMode(false);
                  setFinalPrice(String(Math.round(est.recommended_price)));
                }}
                className="px-4 py-2 border border-zinc-700 text-zinc-400 hover:text-white rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
            {est.recommended_price !== parseFloat(finalPrice) && finalPrice && (
              <div className="text-xs text-zinc-500">
                AI: ${Math.round(est.recommended_price).toLocaleString()} → Override: ${parseInt(finalPrice).toLocaleString()} 
                ({((parseFloat(finalPrice) - est.recommended_price) / est.recommended_price * 100).toFixed(0)}% {parseFloat(finalPrice) > est.recommended_price ? 'higher' : 'lower'})
              </div>
            )}
          </div>
        )}
      </div>

      {/* Regenerate */}
      <button
        onClick={() => { setResult(null); setError(null); }}
        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        Regenerate estimate
      </button>
    </div>
  );
};

export default AutoPricingPanel;
