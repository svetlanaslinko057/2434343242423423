import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, API } from '@/App';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import { ArrowLeft, Eye, EyeOff, Loader2, Terminal, Code2, GitBranch } from 'lucide-react';
import Logo from '@/components/Logo';
import ThemeToggle from '@/components/ThemeToggle';
import ForgotPasswordModal from '@/components/ForgotPasswordModal';

/**
 * BuilderAuthPage — developer / tester entry point.
 * Dual-theme via semantic CSS tokens (no hardcoded hex).
 * Password-first; OTP only through "Forgot password".
 */
const BuilderAuthPage = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [searchParams] = useSearchParams();

  const [mode, setMode] = useState('signin');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [forgotOpen, setForgotOpen] = useState(false);

  const [form, setForm] = useState({ email: '', password: '', name: '' });

  useEffect(() => {
    const refCode = searchParams.get('ref');
    if (refCode) {
      localStorage.setItem('dev_referral_code', refCode);
      runtime.post(`/api/public/capture-referral`, {
        ref: refCode,
        session_id: `sess_${Date.now()}`,
        program: 'developer_growth',
      }).catch(() => {});
    }
  }, [searchParams]);

  const bindDevReferral = async () => {
    const refCode = localStorage.getItem('dev_referral_code');
    if (refCode) {
      try {
        await runtime.post(`/api/developer/growth/bind`, { referral_code: refCode });
        localStorage.removeItem('dev_referral_code');
      } catch (_e) { /* silent */ }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'register') {
        await runtime.post(`/api/auth/register`, {
          email: form.email, password: form.password, name: form.name, role: 'developer',
        });
      }
      await login(form.email, form.password);
      await bindDevReferral();
      navigate('/developer/dashboard');
    } catch (err) {
      if (err?.requires_2fa && err?.challenge_token) {
        setLoading(false);
        navigate('/two-factor-challenge', {
          state: {
            challenge_token: err.challenge_token,
            email: err.email || form.email,
            ttl_seconds: err.ttl_seconds,
            from: '/developer/dashboard',
          },
          replace: true,
        });
        return;
      }
      setError(err.response?.data?.detail || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDemo = async () => {
    setLoading(true);
    try {
      await runtime.post(`/api/auth/demo`, { role: 'developer' });
      const base = process.env.PUBLIC_URL || '/api/web-ui';
      window.location.href = `${base}/developer/dashboard`;
    } catch (_err) {
      setError('Demo access failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex"
      style={{ background: 'var(--token-bg)', color: 'var(--token-text-primary)' }}
      data-testid="builder-auth-page"
    >
      {/* Left — Form */}
      <div className="w-full lg:w-1/2 flex flex-col min-h-screen">
        <div className="p-6 flex items-center justify-between">
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl transition-colors"
            style={{ color: 'var(--token-text-secondary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--token-surface-secondary)'; e.currentTarget.style.color = 'var(--token-text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--token-text-secondary)'; }}
            data-testid="back-btn"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to home
          </button>
          <ThemeToggle />
        </div>

        <div className="flex-1 flex items-center justify-center px-6 pb-12">
          <div className="w-full max-w-[420px]">
            <div className="flex items-center mb-8">
              <Logo height={140} className="h-[140px] w-auto max-w-none" />
            </div>

            <h1 className="text-[28px] font-bold tracking-tight leading-tight mb-2" style={{ color: 'var(--token-text-primary)' }}>
              {mode === 'signin' ? 'Welcome back' : 'Join as Builder'}
            </h1>
            <p className="text-base mb-8" style={{ color: 'var(--token-text-secondary)' }}>
              {mode === 'signin' ? 'Access your workspace and tasks' : 'Start building real products'}
            </p>

            <div
              className="rounded-2xl p-7"
              style={{
                background: 'var(--token-surface)',
                border: '1px solid var(--token-border)',
                boxShadow: 'var(--token-shadow-card)',
              }}
            >
              {/* Tabs */}
              <div
                className="flex p-1 rounded-xl mb-7"
                style={{ background: 'var(--token-surface-secondary)', border: '1px solid var(--token-border)' }}
              >
                {['signin', 'register'].map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className="flex-1 py-3 text-sm font-semibold rounded-lg transition-all"
                    style={{
                      background: mode === m ? 'var(--token-primary)' : 'transparent',
                      color: mode === m ? 'var(--token-primary-ink)' : 'var(--token-text-secondary)',
                      boxShadow: mode === m ? 'var(--token-shadow-card)' : 'none',
                    }}
                    data-testid={`tab-${m}`}
                  >
                    {m === 'signin' ? 'Sign In' : 'Register'}
                  </button>
                ))}
              </div>

              {error && (
                <div
                  className="mb-5 px-4 py-3 rounded-xl text-sm"
                  style={{
                    background: 'var(--token-danger-tint)',
                    color: 'var(--token-danger)',
                    border: '1px solid var(--token-danger-border)',
                  }}
                  data-testid="error-message"
                >
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === 'register' && (
                  <div>
                    <FieldLabel>Name</FieldLabel>
                    <FieldInput
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Your name"
                      required
                      testId="input-name"
                    />
                  </div>
                )}

                <div>
                  <FieldLabel>Email</FieldLabel>
                  <FieldInput
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="you@email.com"
                    required
                    testId="input-email"
                  />
                </div>

                <div>
                  <FieldLabel>Password</FieldLabel>
                  <div className="relative">
                    <FieldInput
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      placeholder="••••••••"
                      required
                      testId="input-password"
                      className="pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 transition-colors"
                      style={{ color: 'var(--token-text-muted)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--token-text-primary)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--token-text-muted)')}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {mode === 'signin' && (
                  <div className="flex justify-end -mt-1">
                    <button
                      type="button"
                      onClick={() => setForgotOpen(true)}
                      className="text-xs font-medium transition-colors"
                      style={{ color: 'var(--token-primary)' }}
                      data-testid="forgot-password-link"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full font-semibold py-4 rounded-xl flex items-center justify-center gap-2 mt-2 transition-all disabled:opacity-50"
                  style={{ background: 'var(--token-primary)', color: 'var(--token-primary-ink)' }}
                  data-testid="submit-btn"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : mode === 'signin' ? 'Sign In' : 'Create Account'}
                </button>
              </form>

              <div className="relative my-7">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full h-px" style={{ background: 'var(--token-border)' }} />
                </div>
                <div className="relative flex justify-center">
                  <span
                    className="px-3 text-[11px] uppercase tracking-wider font-medium"
                    style={{ background: 'var(--token-surface)', color: 'var(--token-text-muted)' }}
                  >
                    or continue with
                  </span>
                </div>
              </div>

              <button
                onClick={handleDemo}
                disabled={loading}
                className="w-full font-medium py-3.5 rounded-xl flex items-center justify-center gap-2 transition-colors"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--token-border)',
                  color: 'var(--token-text-primary)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--token-surface-secondary)'; e.currentTarget.style.borderColor = 'var(--token-border-strong)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--token-border)'; }}
                data-testid="demo-btn"
              >
                <Terminal className="w-4 h-4" style={{ color: 'var(--token-primary)' }} />
                Try Demo Workspace
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Right — Visual */}
      <div className="hidden lg:flex w-1/2 relative overflow-hidden" style={{ borderLeft: '1px solid var(--token-border)' }}>
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 50% 30%, var(--token-primary-accent-soft) 0%, transparent 60%)',
          }}
        />
        <div className="relative z-10 w-full flex items-center justify-center p-12">
          <WorkflowAnimation />
        </div>
      </div>

      <ForgotPasswordModal open={forgotOpen} onClose={() => setForgotOpen(false)} defaultEmail={form.email} />
    </div>
  );
};

const FieldLabel = ({ children }) => (
  <label className="text-[11px] font-semibold uppercase tracking-wider block mb-2" style={{ color: 'var(--token-text-muted)' }}>
    {children}
  </label>
);

const FieldInput = ({ testId, className = '', ...props }) => (
  <input
    {...props}
    className={`w-full rounded-xl px-4 py-3.5 text-sm outline-none transition-all ${className}`}
    style={{
      background: 'var(--token-surface-secondary)',
      border: '1px solid var(--token-border)',
      color: 'var(--token-text-primary)',
    }}
    onFocus={(e) => { e.target.style.borderColor = 'var(--token-primary)'; e.target.style.boxShadow = '0 0 0 3px var(--token-primary-accent-soft)'; props.onFocus?.(e); }}
    onBlur={(e) => { e.target.style.borderColor = 'var(--token-border)'; e.target.style.boxShadow = 'none'; props.onBlur?.(e); }}
    data-testid={testId}
  />
);

const WorkflowAnimation = () => {
  const [currentLine, setCurrentLine] = useState(0);
  const codeLines = [
    { text: '// workflow.ts', dim: true },
    { text: '' },
    { text: 'const pipeline = {' },
    { text: '  request: "received",' },
    { text: '  scope: "structured",' },
    { text: '  assignment: "auto",' },
    { text: '  execution: "tracked",' },
    { text: '  review: "verified",' },
    { text: '  delivery: "approved"' },
    { text: '};' },
    { text: '' },
    { text: '// You build.' },
    { text: '// We manage.' },
    { text: '// Client receives.' },
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentLine((prev) => (prev >= codeLines.length - 1 ? 0 : prev + 1));
    }, 400);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="w-full max-w-md">
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: 'var(--token-surface)',
          border: '1px solid var(--token-border)',
          boxShadow: 'var(--token-shadow-card)',
        }}
      >
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--token-border)', background: 'var(--token-surface-secondary)' }}>
          <div className="flex gap-2">
            <div className="w-3 h-3 rounded-full" style={{ background: 'var(--token-danger)' }} />
            <div className="w-3 h-3 rounded-full" style={{ background: 'var(--token-warning)' }} />
            <div className="w-3 h-3 rounded-full" style={{ background: 'var(--token-success)' }} />
          </div>
          <span className="text-xs ml-2 font-mono" style={{ color: 'var(--token-text-muted)' }}>execution_platform</span>
        </div>

        <div className="p-6 min-h-[340px] font-mono text-sm">
          {codeLines.slice(0, currentLine + 1).map((line, i) => (
            <div
              key={i}
              className={i === currentLine ? 'animate-fade-in' : ''}
              style={{ minHeight: '1.5rem', color: line.dim ? 'var(--token-text-muted)' : 'var(--token-text-secondary)' }}
            >
              {line.text}
            </div>
          ))}
          <span className="inline-block w-2 h-5 animate-pulse" style={{ background: 'var(--token-primary)' }} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mt-8">
        <StatBlock label="Builders" value="200+" />
        <StatBlock label="Projects" value="500+" />
        <StatBlock label="Delivery" value="98%" />
      </div>

      <div className="mt-8 space-y-3">
        <Benefit Icon={GitBranch} text="Work on real production projects" />
        <Benefit Icon={Code2} text="Structured tasks with clear requirements" />
        <Benefit Icon={Terminal} text="Flexible remote work schedule" />
      </div>
    </div>
  );
};

const StatBlock = ({ label, value }) => (
  <div
    className="text-center p-4 rounded-xl"
    style={{
      background: 'var(--token-surface)',
      border: '1px solid var(--token-border)',
    }}
  >
    <div className="text-2xl font-semibold" style={{ color: 'var(--token-text-primary)' }}>{value}</div>
    <div className="text-xs mt-1" style={{ color: 'var(--token-text-muted)' }}>{label}</div>
  </div>
);

const Benefit = ({ Icon, text }) => (
  <div className="flex items-center gap-3" style={{ color: 'var(--token-text-secondary)' }}>
    <div
      className="w-8 h-8 rounded-lg flex items-center justify-center"
      style={{
        background: 'var(--token-primary-accent-soft)',
        color: 'var(--token-primary)',
      }}
    >
      <Icon className="w-4 h-4" />
    </div>
    <span className="text-sm">{text}</span>
  </div>
);

export default BuilderAuthPage;
