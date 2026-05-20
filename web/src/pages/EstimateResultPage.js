/**
 * EstimateResultPage — visitor-mode estimate result + inline signup gate.
 *
 * Reads the estimate from router state (set by DescribeWidget or
 * DescribeFlow). Two-tier disclosure:
 *
 *   GUEST (not logged in)
 *     - Hero: price + hours + complexity + module count (always visible)
 *     - 3 first modules visible; rest blurred with overlay
 *     - Reality multiplier value visible; narrative chip breakdown blurred
 *     - Tech stack blurred
 *     - Inline mini-signup card (name/email/password) — replaces redirect.
 *       On success → auto-login → re-renders unlocked content (no nav).
 *
 *   AUTHENTICATED
 *     - Everything visible, no overlays
 *     - CTA → /client/auth path no longer needed; show "Lock the price"
 *       button that pre-creates a project (future hook). For now goes to
 *       client cabinet new-request flow.
 *
 * Refresh-safe: if state is missing, redirects to /describe.
 */
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
  Sparkles,
  Clock,
  DollarSign,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  Layers,
  RefreshCw,
  Lock,
  Loader2,
} from 'lucide-react';
import Logo from '@/components/Logo';
import ThemeToggle from '@/components/ThemeToggle';
import { useAuth } from '@/App';
import { runtime } from '@/runtime';

const HARDENING_SOURCE = 'operational_hardening_pass';
const GUEST_MODULES_VISIBLE = 3;

/**
 * createProjectAndBoot — single source of truth for the "estimate → project"
 * jump. Used both by AuthedCta (already-logged-in users) and InlineSignup
 * (just-registered users, right after auto-login). Mirrors mobile's
 * createProjectDirect() in /app/frontend/app/estimate-result.tsx so both
 * surfaces converge on /project-booting without an intermediate /client/auth
 * stop.
 */
async function createProjectAndBoot({ estimate, originalGoal, navigate, mode }) {
  const title = (originalGoal || '').trim().slice(0, 80) || 'New product';
  const r = await runtime.post('/api/projects', {
    title,
    goal: (originalGoal || '').trim() || null,
    mode: mode || estimate?.mode || 'hybrid',
    payment_plan: 'half',
    axes: estimate?.reality_layer?.axes,
    axes_source: estimate?.reality_layer?.axes_source,
  });
  const projectId = r?.data?.project_id;
  navigate(`/project-booting?id=${encodeURIComponent(projectId || '')}`, {
    replace: true,
    state: { project_id: projectId },
  });
}

const EstimateResultPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, login } = useAuth();
  const estimate = location.state?.estimate;
  const originalGoal = location.state?.originalGoal || '';

  const isAuthed = !!user;

  useEffect(() => {
    if (!estimate) {
      navigate('/describe', { replace: true });
    }
  }, [estimate, navigate]);

  if (!estimate) return null;

  const est = estimate.estimate || {};
  const rl = estimate.reality_layer || {};
  const modules = estimate.modules_detailed || [];
  const techStack = estimate.tech_stack || [];
  const hardeningCount = modules.filter((m) => m._source === HARDENING_SOURCE).length;

  const fmtMoney = (n) => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`);

  const visibleModules = isAuthed ? modules : modules.slice(0, GUEST_MODULES_VISIBLE);
  const hiddenModuleCount = isAuthed ? 0 : Math.max(0, modules.length - GUEST_MODULES_VISIBLE);

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="estimate-result-page">
      {/* Header */}
      <header className="sticky top-0 z-30 w-full backdrop-blur-md bg-background/80 border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={() => navigate('/')} className="flex items-center" data-testid="result-logo-back">
            <Logo />
          </button>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 pt-12 pb-24">
        {/* Title block */}
        <div className="mb-10 space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-card border border-border">
            <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--t-signal)' }} />
            <span className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Estimate ready · {isAuthed ? 'full breakdown' : 'preview'}
            </span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.05]" data-testid="result-title">
            Your product is{' '}
            <span style={{ color: 'var(--t-signal)' }}>{est.complexity || 'medium'}</span>
            {est.complexity && /complex/i.test(String(est.complexity)) ? '.' : ' complexity.'}
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            {modules.length} modules · {est.estimated_hours || 0} hours estimated ·{' '}
            {rl.axes_source === 'llm_inferred' ? 'axes inferred from your brief' : 'standard axes applied'}.
          </p>
        </div>

        {/* Headline price + multiplier — ALWAYS visible to guest, the
            "what does it cost" is the hook. */}
        <div className="grid md:grid-cols-3 gap-4 mb-12">
          <PriceCard
            label="Implementation price"
            value={fmtMoney(est.implementation_price)}
            sub={`${est.estimated_hours || 0} hours @ $${rl.base_hourly_rate || 65}/h`}
            icon={<Layers className="w-5 h-5" />}
            testId="result-impl-price"
          />
          <PriceCard
            label="Reality multiplier"
            value={`×${(est.reality_multiplier || 1).toFixed(2)}`}
            sub="based on entropy axes & live load"
            icon={<Cpu className="w-5 h-5" />}
            testId="result-multiplier"
            highlight
          />
          <PriceCard
            label="Final price"
            value={fmtMoney(est.final_price)}
            sub="contract-backed delivery"
            icon={<DollarSign className="w-5 h-5" />}
            testId="result-final-price"
            big
          />
        </div>

        {/* Narrative chips — gated for guest */}
        {rl.narrative_chips?.length > 0 && (
          <div className="mb-12" data-testid="result-narrative">
            <h2 className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase mb-3">
              Why this multiplier {!isAuthed && '· locked'}
            </h2>
            <GatedBlock locked={!isAuthed} small>
              <div className="flex flex-wrap gap-2">
                {rl.narrative_chips.map((chip, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center px-3 py-1.5 rounded-full bg-card border border-border text-sm font-mono text-foreground"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </GatedBlock>
          </div>
        )}

        {/* Modules — first 3 visible to guest, rest blurred */}
        <div className="mb-12" data-testid="result-modules">
          <h2 className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase mb-4">
            Scope breakdown ({modules.length} modules
            {hardeningCount > 0 && (
              <> · {hardeningCount} added by <span style={{ color: 'var(--t-signal)' }}>operational review pass</span></>
            )})
          </h2>
          <div className="space-y-2">
            {visibleModules.map((m, i) => {
              const isHardening = m._source === HARDENING_SOURCE;
              return (
                <div
                  key={i}
                  className="flex items-start gap-4 p-4 rounded-xl bg-card border border-border hover:border-[var(--t-signal)]/50 transition-colors"
                  data-testid={`result-module-${i}`}
                >
                  <div className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${isHardening ? 'bg-[var(--t-signal)]/15' : 'bg-muted'}`}>
                    {isHardening ? (
                      <ShieldCheck className="w-5 h-5" style={{ color: 'var(--t-signal)' }} />
                    ) : (
                      <CheckCircle2 className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground">{m.title}</span>
                      {isHardening && (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--t-signal)]/15 text-[10px] font-semibold uppercase tracking-wider"
                          style={{ color: 'var(--t-signal)' }}
                        >
                          <ShieldCheck className="w-3 h-3" />
                          {m._category === 'reliability' ? 'Reliability' : m._category === 'qa' ? 'QA' : 'Hardening'}
                        </span>
                      )}
                    </div>
                    {m.description && <p className="text-sm text-muted-foreground mt-1">{m.description}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-mono font-semibold text-foreground">{m.hours || 0}h</div>
                  </div>
                </div>
              );
            })}

            {/* Locked tail — visible count summary, blurred preview */}
            {hiddenModuleCount > 0 && (
              <GatedBlock locked label={`${hiddenModuleCount} more modules`}>
                <div className="space-y-2 pointer-events-none">
                  {modules.slice(GUEST_MODULES_VISIBLE, GUEST_MODULES_VISIBLE + 2).map((m, i) => (
                    <div key={i} className="flex items-start gap-4 p-4 rounded-xl bg-card border border-border">
                      <div className="shrink-0 w-10 h-10 rounded-lg bg-muted" />
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-foreground">{m.title}</span>
                        {m.description && <p className="text-sm text-muted-foreground mt-1">{m.description}</p>}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-mono font-semibold">{m.hours || 0}h</div>
                      </div>
                    </div>
                  ))}
                </div>
              </GatedBlock>
            )}
          </div>
        </div>

        {/* Tech stack — gated */}
        {techStack.length > 0 && (
          <div className="mb-12" data-testid="result-tech-stack">
            <h2 className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase mb-3">
              Proposed stack {!isAuthed && '· locked'}
            </h2>
            <GatedBlock locked={!isAuthed} small>
              <div className="flex flex-wrap gap-2">
                {techStack.map((t, i) => (
                  <span key={i} className="px-3 py-1.5 rounded-md bg-card border border-border text-sm font-mono">
                    {t}
                  </span>
                ))}
              </div>
            </GatedBlock>
          </div>
        )}

        {/* Bottom CTA — different for guest vs authed */}
        {!isAuthed ? (
          <InlineSignup
            estimate={estimate}
            originalGoal={originalGoal}
            login={login}
          />
        ) : (
          <AuthedCta
            onContinue={() =>
              createProjectAndBoot({ estimate, originalGoal, navigate })
                .catch((err) => {
                  // Surface a minimal alert on the same screen so the user
                  // isn't silently stuck. Production telemetry will pick this
                  // up via runtime's interceptor; here we just keep them
                  // unblocked with a fallback to the legacy auth path.
                  // eslint-disable-next-line no-console
                  console.error('createProjectAndBoot failed:', err);
                  navigate('/client/auth', { state: { fromEstimate: true, estimate, originalGoal } });
                })
            }
            onRefine={() => navigate('/describe', { state: { initialGoal: originalGoal } })}
          />
        )}

        {/* Low-confidence warning */}
        {estimate.confidence != null && estimate.confidence < 0.5 && (
          <div className="mt-6 flex items-start gap-3 p-4 rounded-xl bg-yellow-500/5 border border-yellow-500/30" data-testid="result-low-confidence">
            <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-semibold text-foreground">Lower confidence on this estimate</div>
              <p className="text-muted-foreground mt-1">
                The brief is short or unusual. Refine for a tighter price — or proceed; we'll re-estimate after a 30-minute scoping call before any commitment.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

/* ============================================================================
 * GatedBlock — wraps content with a blur+lock overlay when locked=true.
 * Used for narrative chips, tech stack tail, hidden modules. The overlay
 * sits on top so child interactivity is killed without removing the
 * structural HTML (good for SEO + smooth unlock animation).
 * ========================================================================= */
const GatedBlock = ({ locked, children, label, small }) => {
  if (!locked) return children;
  return (
    <div className="relative" data-testid="gated-block">
      <div style={{ filter: 'blur(6px)', userSelect: 'none', pointerEvents: 'none' }}>
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className={`inline-flex items-center gap-2 ${small ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'} rounded-full bg-card border border-[var(--t-signal)]/50 font-mono uppercase tracking-wider`}
          style={{ color: 'var(--t-signal)' }}
        >
          <Lock className={small ? 'w-3 h-3' : 'w-4 h-4'} />
          {label || 'Sign up to unlock'}
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * InlineSignup — replaces the old "navigate to /client/auth" redirect.
 * Guest fills email/password right here. On success, auto-login is run via
 * useAuth.login(), which flips isAuthed → page unblurs in-place. No nav,
 * no lost state, no double-render.
 * ========================================================================= */
const InlineSignup = ({ estimate, originalGoal, login }) => {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = name.trim().length >= 2 && /@/.test(email) && password.length >= 6 && !busy;

  const handleRegister = async (e) => {
    e?.preventDefault?.();
    if (!canSubmit) return;
    setError('');
    setBusy(true);
    try {
      await runtime.post('/api/auth/register', {
        email: email.trim().toLowerCase(),
        password,
        name: name.trim(),
        role: 'client',
      });
      // Auto-login — uses the same session cookie path as ClientAuthPage.
      await login(email.trim().toLowerCase(), password);
      // Auto-create project + redirect to /project-booting — guest doesn't
      // have to click "Lock the price" again. Matches mobile behaviour in
      // /app/frontend/app/estimate-result.tsx (createProjectDirect chained
      // off handleRegister).
      await createProjectAndBoot({ estimate, originalGoal, navigate });
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || 'Registration failed';
      setError(String(msg));
      setBusy(false);
    }
  };

  const final = estimate?.estimate?.final_price;

  return (
    <div
      className="relative rounded-2xl p-8 sm:p-10 overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(11,143,94,0.15) 0%, rgba(47,230,166,0.05) 100%)',
        border: '1px solid var(--t-signal)',
      }}
      data-testid="result-inline-signup"
    >
      <div className="grid md:grid-cols-2 gap-8 items-start">
        <div className="space-y-3">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Unlock the full breakdown
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            10-second signup — no payment yet. Once registered you'll see all{' '}
            <span className="text-foreground font-semibold">
              {estimate?.modules_detailed?.length || 0} modules
            </span>
            , the entropy axes that drive the ×{(estimate?.estimate?.reality_multiplier || 1).toFixed(2)} multiplier, the proposed
            tech stack, and you can lock the price{final ? <> at <span className="text-foreground font-semibold">{`$${Math.round(final).toLocaleString()}`}</span></> : ''}{' '}
            with a 10% deposit.
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" style={{ color: 'var(--t-signal)' }} />
              Contract-backed
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="w-4 h-4" style={{ color: 'var(--t-signal)' }} />
              Devs assigned in 24h
            </span>
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw className="w-4 h-4" style={{ color: 'var(--t-signal)' }} />
              Refundable until kickoff
            </span>
          </div>
        </div>

        <form onSubmit={handleRegister} className="space-y-3" data-testid="result-signup-form">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            disabled={busy}
            className="w-full bg-card text-foreground border border-border rounded-xl px-4 py-3 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--t-signal)]"
            data-testid="result-signup-name"
            autoComplete="name"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Work email"
            disabled={busy}
            className="w-full bg-card text-foreground border border-border rounded-xl px-4 py-3 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--t-signal)]"
            data-testid="result-signup-email"
            autoComplete="email"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (min 6 chars)"
            disabled={busy}
            className="w-full bg-card text-foreground border border-border rounded-xl px-4 py-3 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--t-signal)]"
            data-testid="result-signup-password"
            autoComplete="new-password"
          />
          <button
            type="submit"
            disabled={!canSubmit}
            className="group w-full inline-flex items-center justify-center gap-2 font-semibold px-7 py-4 rounded-xl text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:translate-y-[-1px]"
            style={{
              background: 'var(--t-signal)',
              boxShadow: canSubmit ? '0 10px 26px rgba(11,143,94,0.28)' : 'none',
            }}
            data-testid="result-signup-submit"
          >
            {busy ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Creating account…
              </>
            ) : (
              <>
                Unlock my full estimate
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>
          {error && (
            <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2" data-testid="result-signup-error">
              {error}
            </div>
          )}
          <p className="text-xs text-muted-foreground text-center">
            Already have an account?{' '}
            <button
              type="button"
              onClick={() => navigate('/client/auth', { state: { fromEstimate: true, estimate, originalGoal } })}
              className="underline hover:text-foreground"
              data-testid="result-signup-signin-link"
            >
              Sign in instead
            </button>
          </p>
        </form>
      </div>
    </div>
  );
};

/* ============================================================================
 * AuthedCta — shown to logged-in users only. They've already passed the
 * signup gate, so we offer to formally lock the estimate as a project
 * (deposit flow) or refine the brief.
 * ========================================================================= */
const AuthedCta = ({ onContinue, onRefine }) => (
  <div
    className="relative rounded-2xl p-8 sm:p-10 overflow-hidden"
    style={{
      background: 'linear-gradient(135deg, rgba(11,143,94,0.15) 0%, rgba(47,230,166,0.05) 100%)',
      border: '1px solid var(--t-signal)',
    }}
    data-testid="result-authed-cta"
  >
    <div className="grid md:grid-cols-3 gap-8 items-center">
      <div className="md:col-span-2 space-y-3">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">Lock this estimate?</h2>
        <p className="text-muted-foreground leading-relaxed">
          Pay a 10% deposit to lock the price. Real developers are assigned within 24 hours.
          Full contract-backed delivery, full refund if scope can't be matched.
        </p>
      </div>
      <div className="flex md:flex-col md:items-stretch gap-3">
        <button
          onClick={onContinue}
          className="group inline-flex items-center justify-center gap-2 font-semibold px-7 py-4 rounded-xl text-white transition-all hover:translate-y-[-1px]"
          style={{ background: 'var(--t-signal)', boxShadow: '0 10px 26px rgba(11,143,94,0.28)' }}
          data-testid="result-cta-continue"
        >
          Lock the price
          <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
        </button>
        <button
          onClick={onRefine}
          className="inline-flex items-center justify-center gap-2 font-medium px-5 py-3 rounded-xl bg-card border border-border text-foreground hover:bg-muted transition-colors text-sm"
          data-testid="result-cta-refine"
        >
          Refine my idea
        </button>
      </div>
    </div>
  </div>
);

const PriceCard = ({ label, value, sub, icon, testId, highlight, big }) => (
  <div
    className={`p-6 rounded-xl bg-card border ${highlight ? 'border-[var(--t-signal)]' : 'border-border'}`}
    data-testid={testId}
  >
    <div className="flex items-center gap-2 mb-3 text-muted-foreground">
      {icon}
      <span className="text-xs font-semibold tracking-[0.12em] uppercase">{label}</span>
    </div>
    <div className={`font-semibold tracking-tight ${big ? 'text-4xl' : 'text-3xl'} ${big ? 'text-foreground' : highlight ? 'text-[var(--t-signal)]' : 'text-foreground'}`}>
      {value}
    </div>
    {sub && <div className="text-xs text-muted-foreground mt-2">{sub}</div>}
  </div>
);

export default EstimateResultPage;
