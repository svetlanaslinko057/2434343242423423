import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useAuth, API } from '@/App';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import { ArrowLeft, Eye, EyeOff, Loader2, Sparkles } from 'lucide-react';
import { GoogleLogin } from '@react-oauth/google';
import Logo from '@/components/Logo';
import ThemeToggle from '@/components/ThemeToggle';
import ForgotPasswordModal from '@/components/ForgotPasswordModal';

const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID
  || '539552820560-pso3qndegrntp46oneml9nr33t7rpi9j.apps.googleusercontent.com';

const ClientAuthPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [searchParams] = useSearchParams();

  // Visitor-mode estimate carried over from /estimate-result → claim the
  // anonymous lead on first authenticated request so the project is created
  // automatically and the admin gets a converted-lead event.
  const fromEstimateState = location.state || {};
  const pendingLeadId = fromEstimateState.estimate?.lead_id || null;
  const fromEstimate = !!fromEstimateState.fromEstimate;
  
  const [mode, setMode] = useState(fromEstimate ? 'register' : 'signin');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [forgotOpen, setForgotOpen] = useState(false);
  
  const [form, setForm] = useState({
    email: '',
    password: '',
    name: ''
  });

  const claimPendingLead = async () => {
    if (!pendingLeadId) return null;
    try {
      const r = await runtime.post(`/api/leads/${pendingLeadId}/claim`, {}, { timeoutMs: 15000 });
      return r.data?.project_id || null;
    } catch (err) {
      console.warn('lead claim failed', err);
      return null;
    }
  };

  const postAuthRedirect = async () => {
    await bindReferral();
    const projectId = await claimPendingLead();
    if (projectId) {
      navigate(`/client/projects/${projectId}`, { replace: true });
      return;
    }
    navigate('/client/dashboard');
  };

  // Capture referral code from URL
  useEffect(() => {
    const refCode = searchParams.get('ref');
    if (refCode) {
      localStorage.setItem('devos_ref', refCode);
      // Capture in backend
      runtime.post(`/api/public/capture-referral`, {
        ref: refCode,
        session_id: null
      }).catch(() => {});
    }
  }, [searchParams]);

  const bindReferral = async () => {
    const refCode = localStorage.getItem('devos_ref');
    if (refCode) {
      try {
        await runtime.post(`/api/referral/bind`, { referral_code: refCode });
        localStorage.removeItem('devos_ref');
      } catch (err) {
        // Silent fail - referral binding is non-critical
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    try {
      if (mode === 'register') {
        await runtime.post(`/api/auth/register`, {
          email: form.email,
          password: form.password,
          name: form.name,
          role: 'client'
        });
      }
      
      await login(form.email, form.password);
      await postAuthRedirect();
    } catch (err) {
      // 2FA gate — route to the challenge screen with the token in tow.
      if (err?.requires_2fa && err?.challenge_token) {
        setLoading(false);
        navigate('/two-factor-challenge', {
          state: {
            challenge_token: err.challenge_token,
            email: err.email || form.email,
            ttl_seconds: err.ttl_seconds,
            from: '/client/dashboard',
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
    setError('');
    try {
      const res = await runtime.post(`/api/auth/demo`, { role: 'client' });
      if (res.data) {
        // If a pending lead is in router state, claim it before redirecting
        // so the demo user lands inside the project workspace.
        const projectId = await claimPendingLead();
        const base = process.env.PUBLIC_URL || '/api/web-ui';
        const target = projectId ? `/client/projects/${projectId}` : '/client/dashboard';
        window.location.href = `${base}${target}`;
      }
    } catch (err) {
      console.error('Demo login error:', err);
      setError(err.response?.data?.detail || 'Demo access failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Real Google Sign-In. The button (below) hands us a JWT credential
  // issued by Google; we just post it to the backend, which verifies the
  // signature/aud and issues the same session cookie used by every other
  // authed endpoint. Referral is bound post-login exactly like the
  // email+password path so attribution stays consistent.
  const handleGoogleSuccess = async (credentialResponse) => {
    setError('');
    setLoading(true);
    try {
      const credential = credentialResponse?.credential;
      if (!credential) throw new Error('No credential from Google');
      await runtime.post(`/api/auth/google`,
        { credential });
      await bindReferral();
      const projectId = await claimPendingLead();
      const base = process.env.PUBLIC_URL || '/api/web-ui';
      const target = projectId ? `/client/projects/${projectId}` : '/client/dashboard';
      window.location.href = `${base}${target}`;
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Google sign-in failed');
      setLoading(false);
    }
  };

  const handleGoogleError = () => {
    setError('Google sign-in was cancelled or blocked by the browser');
  };

  return (
    <div className="min-h-screen bg-background flex" data-testid="client-auth-page">
      {/* Left - Visual Side */}
      <div className="hidden lg:flex w-1/2 relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-signal/15" />
        
        <div className="relative z-10 w-full flex items-center justify-center p-12">
          <ClientFlowAnimation />
        </div>
      </div>

      {/* Right - Form Side */}
      <div className="w-full lg:w-1/2 flex flex-col min-h-screen">
        {/* Top bar with back button + theme toggle */}
        <div className="p-6 flex items-center justify-between">
          <button 
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground text-sm transition-colors px-3 py-2 rounded-xl hover:bg-muted"
            data-testid="back-btn"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to home
          </button>
          <ThemeToggle />
        </div>

        {/* Form container */}
        <div className="flex-1 flex items-center justify-center px-6 pb-12">
          <div className="w-full max-w-[420px]">
            <div className="flex items-center mb-8">
              <Logo height={140} className="h-[140px] w-auto max-w-none" />
            </div>

            {/* Title */}
            <h1 className="text-[28px] font-bold text-foreground tracking-tight leading-tight mb-2">
              {mode === 'signin' ? 'Welcome back' : 'Start your project'}
            </h1>
            <p className="text-muted-foreground text-base mb-8">
              {mode === 'signin' ? 'Sign in to manage your projects' : 'Create an account to get started'}
            </p>

            {/* Envelope card around the form — gives depth + structure */}
            <div className="rounded-2xl border border-border bg-card shadow-sm p-7">

            {/* From-estimate banner — visitor came from /estimate-result */}
            {fromEstimate && fromEstimateState.estimate?.estimate && (
              <div
                className="mb-5 p-4 rounded-xl border flex items-start gap-3"
                style={{
                  background: 'rgba(11,143,94,0.06)',
                  borderColor: 'rgba(11,143,94,0.30)',
                }}
                data-testid="auth-from-estimate-banner"
              >
                <Sparkles className="w-4 h-4 mt-0.5" style={{ color: 'var(--t-signal)' }} />
                <div className="text-sm">
                  <div className="font-semibold text-foreground">
                    Your estimate is saved
                    <span className="font-mono ml-1.5" style={{ color: 'var(--t-signal)' }}>
                      ${Math.round(fromEstimateState.estimate.estimate.final_price || 0).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-0.5">
                    Sign up or log in — we'll claim it for you and open your project workspace.
                  </p>
                </div>
              </div>
            )}

            {/* Tabs */}
            <div className="flex p-1 bg-muted rounded-xl mb-7 border border-border">
              <button
                onClick={() => setMode('signin')}
                className={`flex-1 py-3 text-sm font-semibold rounded-lg transition-all ${
                  mode === 'signin' 
                    ? 'bg-primary text-primary-foreground shadow-md' 
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                data-testid="tab-signin"
              >
                Sign In
              </button>
              <button
                onClick={() => setMode('register')}
                className={`flex-1 py-3 text-sm font-semibold rounded-lg transition-all ${
                  mode === 'register' 
                    ? 'bg-primary text-primary-foreground shadow-md' 
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                data-testid="tab-register"
              >
                Register
              </button>
            </div>

            {/* Error */}
            {error && (
              <div className="mb-5 p-4 rounded-xl border border-destructive/30 bg-destructive/10 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Your name"
                    className="w-full bg-muted border border-border rounded-xl px-4 py-3.5 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                    required={mode === 'register'}
                    data-testid="input-name"
                  />
                </div>
              )}
              
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="you@company.com"
                  className="w-full bg-muted border border-border rounded-xl px-4 py-3.5 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  required
                  data-testid="input-email"
                />
              </div>
              
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="••••••••"
                    className="w-full bg-muted border border-border rounded-xl px-4 py-3.5 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all pr-12"
                    required
                    data-testid="input-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {mode === 'signin' && (
                <div className="flex justify-end -mt-1">
                  <button
                    type="button"
                    onClick={() => setForgotOpen(true)}
                    className="text-xs font-medium text-primary hover:underline"
                    data-testid="forgot-password-link"
                  >
                    Forgot password?
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold py-4 rounded-xl transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2 mt-6 disabled:opacity-50"
                data-testid="submit-btn"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : mode === 'signin' ? 'Sign In' : 'Create Account'}
              </button>
            </form>

            {/* Divider */}
            <div className="relative my-7">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-card px-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground">or continue with</span>
              </div>
            </div>

            {/* Google Sign-In — real Google OAuth (ID-token flow). */}
            {GOOGLE_CLIENT_ID ? (
              <div
                className="flex justify-center mb-3"
                data-testid="google-signin-wrapper"
              >
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={handleGoogleError}
                  useOneTap={false}
                  theme="outline"
                  size="large"
                  shape="pill"
                  text={mode === 'signin' ? 'signin_with' : 'continue_with'}
                  width="320"
                />
              </div>
            ) : null}

            {/* Demo Button */}
            <button
              onClick={handleDemo}
              disabled={loading}
              className="w-full bg-transparent hover:bg-muted border border-border text-foreground font-medium py-3.5 rounded-xl transition-all flex items-center justify-center gap-2"
              data-testid="demo-btn"
            >
              <Sparkles className="w-5 h-5 text-primary" />
              Try Demo (No signup)
            </button>

            </div> {/* /envelope card */}
          </div>
        </div>
      </div>

      <ForgotPasswordModal
        open={forgotOpen}
        onClose={() => setForgotOpen(false)}
        defaultEmail={form.email}
      />
    </div>
  );
};

// Animated Flow for Clients
const ClientFlowAnimation = () => {
  const [step, setStep] = useState(0);
  
  const steps = [
    {
      label: 'Your request',
      json: `{
  "idea": "Marketplace App",
  "features": [
    "User accounts",
    "Product listings",
    "Payments"
  ]
}`
    },
    {
      label: 'Our scope',
      json: `{
  "project": "Marketplace MVP",
  "stages": 4,
  "estimate": "120h",
  "team": 2
}`
    },
    {
      label: 'In progress',
      json: `{
  "stage": "Development",
  "progress": "65%",
  "completed": [
    "Auth API",
    "Product CRUD"
  ]
}`
    },
    {
      label: 'Delivery',
      json: `{
  "version": "1.0",
  "status": "ready",
  "includes": [
    "Source code",
    "Documentation",
    "Preview link"
  ]
}`
    }
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setStep((prev) => (prev + 1) % steps.length);
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-full max-w-md">
      {/* Flow steps */}
      <div className="flex items-center justify-between mb-8">
        {['Request', 'Scope', 'Build', 'Ship'].map((s, i) => (
          <div key={i} className="flex items-center">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-semibold transition-all ${
              i <= step ? 'bg-primary text-primary-foreground shadow-md shadow-primary/25' : 'bg-muted text-muted-foreground border border-border'
            }`}>
              {i + 1}
            </div>
            {i < 3 && (
              <div className={`w-8 h-0.5 transition-all ${
                i < step ? 'bg-primary' : 'bg-border'
              }`} />
            )}
          </div>
        ))}
      </div>

      {/* Terminal */}
      <div className="border border-border rounded-2xl overflow-hidden bg-surface shadow-2xl">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-white/[0.02]">
          <div className="flex gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500/60" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
            <div className="w-3 h-3 rounded-full bg-green-500/60" />
          </div>
          <span className="text-xs text-muted-foreground ml-2 font-mono">{steps[step].label}</span>
        </div>

        <div className="p-6 min-h-[260px] font-mono text-sm">
          <pre className="text-muted-foreground whitespace-pre animate-fade-in">
            {steps[step].json}
          </pre>
        </div>
      </div>

      {/* Caption */}
      <div className="text-center mt-8">
        <p className="text-muted-foreground">
          From idea to production.
        </p>
        <p className="text-foreground font-semibold mt-1">You decide. We deliver.</p>
      </div>
    </div>
  );
};

export default ClientAuthPage;
