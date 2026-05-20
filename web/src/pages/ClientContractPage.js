import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  AlertCircle,
  Rocket,
} from 'lucide-react';

/**
 * Phase 3 — Client contract page (web).
 *
 * Single-decision UX, mirrors the mobile screen. Backend builds the
 * view-model (`/api/client/projects/:id/contract`); we render JSON.
 *
 * Sign endpoint: `POST /api/client/contracts/:id/sign` with `{accepted:true}`.
 */

const fmtMoney = (n, ccy = 'USD') =>
  ccy === 'USD'
    ? `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    : `${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${ccy}`;

const ClientContractPage = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  // eslint-disable-next-line no-unused-vars
  const { user } = useAuth();

  const [contract, setContract] = useState(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await runtime.get(`/api/client/projects/${projectId}/contract`);
      setContract(res.data);
      setError(null);
    } catch (e) {
      setError(e?.response?.data?.detail || 'Could not load contract');
      setContract(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const onSign = async () => {
    if (!contract) return;
    if (!window.confirm(
      'Sign this agreement?\n\nBy signing you accept the scope, timeline, and payment terms above. Your acceptance will be timestamped.',
    )) return;

    setSigning(true);
    try {
      const r = await runtime.post(`/api/client/contracts/${contract.contract_id}/sign`,
        { accepted: true },
        { },
      );
      setContract(r.data);
    } catch (e) {
      alert(e?.response?.data?.detail || 'Failed to sign contract');
    } finally {
      setSigning(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="contract-loading">
        <div className="w-8 h-8 border-2 border-border border-t-signal rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="contract-not-found">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <div className="text-muted-foreground text-sm">{error || 'No contract found for this project'}</div>
          <button
            onClick={() => navigate(-1)}
            className="mt-4 px-4 py-2 text-sm bg-muted border border-border rounded-md hover:bg-muted"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  const signed = !!contract.signed;

  return (
    <div className="min-h-screen p-6 lg:p-8 max-w-3xl mx-auto" data-testid="client-contract-page">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-muted-foreground hover:text-white mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="text-sm">Back</span>
      </button>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold tracking-tight">
          {signed ? "You've started your project" : "You're about to start your project"}
        </h1>
        <span className={`px-3 py-1 rounded-full text-xs font-bold tracking-wider ${
          signed ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                 : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
        }`} data-testid="contract-status-badge">
          {signed ? 'SIGNED' : 'READY TO SIGN'}
        </span>
      </div>

      {/* Project + scope */}
      <section className="rounded-xl border border-border p-6 mb-4" data-testid="contract-scope-card">
        <div className="text-[10px] tracking-[2px] font-bold text-muted-foreground mb-2">PROJECT</div>
        <div className="text-2xl font-bold mb-4">{contract.project_title}</div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <Pill label="Scope"    value={`${contract.totals.modules_count} module${contract.totals.modules_count === 1 ? '' : 's'}`} />
          <Pill label="Timeline" value={contract.timeline.label} />
          <Pill label="Cost"     value={fmtMoney(contract.totals.total_value, contract.totals.currency)} accent="emerald" />
        </div>

        <div className="text-[10px] tracking-[2px] font-bold text-muted-foreground mb-2">MODULES</div>
        <div className="space-y-2">
          {contract.scope.map((m) => (
            <div key={m.module_id} className="flex items-center justify-between py-2 border-b border-border last:border-0"
                 data-testid={`contract-module-${m.module_id}`}>
              <div>
                <div className="text-sm font-medium">{m.title}</div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mt-0.5">{m.speed_tier}</div>
              </div>
              <div className="text-sm font-bold">{fmtMoney(m.final_price, contract.totals.currency)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Includes */}
      <section className="rounded-xl border border-border p-6 mb-4">
        <div className="text-[10px] tracking-[2px] font-bold text-muted-foreground mb-3">INCLUDES</div>
        <div className="space-y-2">
          {contract.includes.map((it) => (
            <div key={it} className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>{it}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Payment */}
      <section className="rounded-xl border border-border p-6 mb-4" data-testid="contract-payment-card">
        <div className="text-[10px] tracking-[2px] font-bold text-muted-foreground mb-2">PAYMENT TERMS</div>
        <div className="text-base font-medium">
          {contract.payment_terms.upfront_pct}% upfront · {contract.payment_terms.delivery_pct}% on delivery
        </div>
      </section>

      {/* Click-wrap copy */}
      {!signed ? (
        <p className="text-sm text-muted-foreground text-center my-4">
          By clicking "Accept &amp; Start Project" you agree to the scope, timeline,
          and payment terms above. Your acceptance will be timestamped.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground text-center my-4 flex items-center justify-center gap-1" data-testid="contract-signed-meta">
          <Clock className="w-4 h-4" />
          Signed at {contract.signed_at ? new Date(contract.signed_at).toLocaleString() : '—'}
        </p>
      )}

      {/* CTA */}
      {!signed ? (
        <button
          data-testid="contract-sign-btn"
          disabled={signing}
          onClick={onSign}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-xl bg-signal hover:bg-signal text-black font-bold disabled:opacity-50 transition shadow-lg shadow-signal/30"
        >
          <Rocket className="w-5 h-5" />
          {signing ? 'Signing…' : 'Accept & Start Project'}
        </button>
      ) : (
        <button
          data-testid="contract-go-workspace"
          onClick={() => navigate(`/client/project/${projectId}/workspace`)}
          className="w-full py-4 rounded-xl bg-muted border border-signal text-signal font-bold hover:bg-signal/10 transition"
        >
          Open project workspace
        </button>
      )}
    </div>
  );
};

function Pill({ label, value, accent }) {
  const cls = accent === 'emerald' ? 'text-emerald-400' : 'text-white';
  return (
    <div className="rounded-lg bg-white/[0.03] border border-border p-4">
      <div className="text-[10px] tracking-[2px] font-bold text-muted-foreground mb-1">{label.toUpperCase()}</div>
      <div className={`text-base font-bold ${cls}`}>{value}</div>
    </div>
  );
}

export default ClientContractPage;
