import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import axios from 'axios';
import { getDeviceFingerprint } from '@/lib/deviceFingerprint';
import { ArrowLeft, ArrowRight, Loader2, Eye, EyeOff, Sparkles, Activity, Users, TrendingUp, Zap } from 'lucide-react';
import Logo from '@/components/Logo';
import ThemeToggle from '@/components/ThemeToggle';
import ForgotPasswordModal from '@/components/ForgotPasswordModal';

/**
 * AdminLoginPage — admin entry point.
 * Dual-theme via semantic CSS tokens (no hardcoded hex).
 * Password-first; OTP is only triggered through "Forgot password".
 */
const AdminLoginPage = () => {
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [forgotOpen, setForgotOpen] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const { setUser } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`${API}/auth/login`, {
        email: email.trim(),
        password,
        device_fingerprint: getDeviceFingerprint(),
      }, { withCredentials: true });

      // 2FA gate — short-circuit to the challenge screen if the admin has 2FA on.
      if (res.data?.requires_2fa) {
        setLoading(false);
        navigate('/two-factor-challenge', {
          state: {
            challenge_token: res.data.challenge_token,
            email: email.trim(),
            ttl_seconds: res.data.ttl_seconds,
            from: '/admin/dashboard',
          },
          replace: true,
        });
        return;
      }

      if (res.data.role !== 'admin') {
        setError('Access denied. Admin credentials required.');
        return;
      }
      setUser(res.data);
      navigate('/admin/dashboard');
    } catch (err) {
      setError(err.response?.data?.detail || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoAccess = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`${API}/auth/demo`, { role: 'admin' }, { withCredentials: true });
      setUser(res.data);
      navigate('/admin/dashboard');
    } catch (err) {
      setError(err.response?.data?.detail || 'Demo access failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex"
      style={{ background: 'var(--token-bg)', color: 'var(--token-text-primary)' }}
      data-testid="admin-login-page"
    >
      {/* Left — Visual */}
      <div className="hidden lg:flex w-1/2 relative overflow-hidden" style={{ borderRight: '1px solid var(--token-border)' }}>
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 50% 30%, var(--token-primary-accent-soft) 0%, transparent 60%)',
          }}
        />
        <div className="relative z-10 w-full flex items-center justify-center p-12">
          <AdminFlowAnimation />
        </div>
      </div>

      {/* Right — Form */}
      <div className="w-full lg:w-1/2 flex flex-col min-h-screen">
        {/* Top bar */}
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

            <h1
              className="text-[28px] font-bold tracking-tight leading-tight mb-2"
              style={{ color: 'var(--token-text-primary)' }}
            >
              Command Center
            </h1>
            <p className="text-base mb-8" style={{ color: 'var(--token-text-secondary)' }}>
              Access the admin dashboard to manage your platform
            </p>

            {/* Envelope card */}
            <div
              className="rounded-2xl p-7"
              style={{
                background: 'var(--token-surface)',
                border: '1px solid var(--token-border)',
                boxShadow: 'var(--token-shadow-card)',
              }}
            >
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
                <FieldLabel>Email</FieldLabel>
                <FieldInput
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@atlas.dev"
                  testId="email-input"
                  required
                />

                <FieldLabel>Password</FieldLabel>
                <div className="relative">
                  <FieldInput
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    testId="password-input"
                    required
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

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full font-semibold py-4 rounded-xl flex items-center justify-center gap-2 mt-2 transition-all disabled:opacity-50"
                  style={{
                    background: 'var(--token-primary)',
                    color: 'var(--token-primary-ink)',
                  }}
                  data-testid="submit-btn"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      Access Dashboard
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>

              <Divider label="or" />

              <button
                onClick={handleDemoAccess}
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
                <Sparkles className="w-4 h-4" style={{ color: 'var(--token-primary)' }} />
                Demo Admin Access
              </button>
            </div>
          </div>
        </div>
      </div>

      <ForgotPasswordModal
        open={forgotOpen}
        onClose={() => setForgotOpen(false)}
        defaultEmail={email}
      />
    </div>
  );
};

// ----- Small primitives used inside this page (kept local) -----

const FieldLabel = ({ children }) => (
  <label
    className="text-[11px] font-semibold uppercase tracking-wider block mb-2"
    style={{ color: 'var(--token-text-muted)' }}
  >
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

const Divider = ({ label }) => (
  <div className="relative my-6">
    <div className="absolute inset-0 flex items-center">
      <div className="w-full h-px" style={{ background: 'var(--token-border)' }} />
    </div>
    <div className="relative flex justify-center">
      <span
        className="px-3 text-[11px] uppercase tracking-wider font-medium"
        style={{ background: 'var(--token-surface)', color: 'var(--token-text-muted)' }}
      >
        {label}
      </span>
    </div>
  </div>
);

// ----- Visual side animation -----

const AdminFlowAnimation = () => {
  const stats = [
    { label: 'Active Projects', value: '24', Icon: Activity },
    { label: 'Team Members', value: '12', Icon: Users },
    { label: 'Revenue', value: '$48.2K', Icon: TrendingUp },
  ];

  return (
    <div className="w-full max-w-md">
      <div className="flex items-center justify-center gap-3 mb-12">
        {[1, 2, 3, 4].map((step, i) => (
          <div key={step} className="flex items-center">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-semibold"
              style={{
                background: i === 0 ? 'var(--token-primary)' : 'var(--token-surface-secondary)',
                color: i === 0 ? 'var(--token-primary-ink)' : 'var(--token-text-secondary)',
                border: i === 0 ? 'none' : '1px solid var(--token-border)',
              }}
            >
              {step}
            </div>
            {i < 3 && <div className="w-8 h-0.5 mx-1" style={{ background: 'var(--token-border)' }} />}
          </div>
        ))}
      </div>

      <div
        className="rounded-2xl p-6"
        style={{
          background: 'var(--token-surface)',
          border: '1px solid var(--token-border)',
          boxShadow: 'var(--token-shadow-card)',
        }}
      >
        <div className="flex items-center gap-2 mb-6">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ background: 'var(--token-danger)' }} />
            <div className="w-3 h-3 rounded-full" style={{ background: 'var(--token-warning)' }} />
            <div className="w-3 h-3 rounded-full" style={{ background: 'var(--token-success)' }} />
          </div>
          <span className="text-xs ml-2" style={{ color: 'var(--token-text-muted)' }}>Control Center</span>
        </div>

        <div className="space-y-3">
          {stats.map(({ label, value, Icon }) => (
            <div
              key={label}
              className="flex items-center justify-between p-3 rounded-xl"
              style={{
                background: 'var(--token-surface-secondary)',
                border: '1px solid var(--token-border)',
              }}
            >
              <div className="flex items-center gap-3">
                <Icon className="w-5 h-5" style={{ color: 'var(--token-primary)' }} />
                <span className="text-sm" style={{ color: 'var(--token-text-secondary)' }}>{label}</span>
              </div>
              <span className="font-semibold" style={{ color: 'var(--token-text-primary)' }}>{value}</span>
            </div>
          ))}
        </div>

        <div className="mt-6 pt-6" style={{ borderTop: '1px solid var(--token-border)' }}>
          <div className="flex items-center gap-2" style={{ color: 'var(--token-primary)' }}>
            <Zap className="w-4 h-4" />
            <span className="text-sm font-medium">System Healthy</span>
          </div>
        </div>
      </div>

      <p className="text-center mt-8 text-sm" style={{ color: 'var(--token-text-muted)' }}>
        Full control over your development pipeline
      </p>
    </div>
  );
};

export default AdminLoginPage;
