/**
 * ForgotPasswordModal — three-step password reset flow.
 *
 * Step 1: enter email → POST /auth/password-reset/request
 * Step 2: enter 6-digit code (sent via email) + new password
 *         → POST /auth/password-reset/verify
 * Step 3: success → close and let user sign in with the new password.
 *
 * Dual-theme: uses semantic CSS tokens only, no hardcoded hex colours,
 * so it renders identically in both Light and Dark.
 */
import { useState, useEffect } from 'react';
import axios from 'axios';
import { API } from '@/App';
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Mail, KeyRound, Eye, EyeOff, X } from 'lucide-react';

const RESEND_SECONDS = 30;

const ForgotPasswordModal = ({ open, onClose, defaultEmail = '' }) => {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState(defaultEmail);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [devCode, setDevCode] = useState(null);

  // Reset internal state every time the modal is reopened.
  useEffect(() => {
    if (open) {
      setStep(1);
      setEmail(defaultEmail);
      setCode('');
      setNewPassword('');
      setConfirmPassword('');
      setError('');
      setDevCode(null);
      setResendIn(0);
    }
  }, [open, defaultEmail]);

  // Resend countdown.
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  if (!open) return null;

  const requestCode = async () => {
    setError('');
    if (!email.trim() || !email.includes('@')) {
      setError('Enter a valid email');
      return;
    }
    setLoading(true);
    try {
      const res = await axios.post(`${API}/auth/password-reset/request`, { email: email.trim() });
      if (res.data?.dev_code) setDevCode(res.data.dev_code);
      setStep(2);
      setResendIn(RESEND_SECONDS);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to send reset code');
    } finally {
      setLoading(false);
    }
  };

  const submitReset = async () => {
    setError('');
    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your email');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await axios.post(`${API}/auth/password-reset/verify`, {
        email: email.trim(),
        code,
        new_password: newPassword,
      });
      setStep(3);
    } catch (err) {
      setError(err.response?.data?.detail || 'Reset failed');
    } finally {
      setLoading(false);
    }
  };

  const headerForStep = {
    1: { title: 'Reset your password', subtitle: 'Enter the email tied to your account.' },
    2: { title: 'Enter reset code', subtitle: `We sent a 6-digit code to ${email}.` },
    3: { title: 'Password updated', subtitle: 'You can now sign in with your new password.' },
  };
  const head = headerForStep[step];

  return (
    <div className="modal-overlay flex items-center justify-center p-4" data-testid="forgot-password-modal">
      <div
        className="w-full max-w-[440px] rounded-2xl p-7 relative"
        style={{
          background: 'var(--token-surface-elevated)',
          border: '1px solid var(--token-border)',
          boxShadow: 'var(--token-shadow-hover)',
        }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-lg transition-colors"
          style={{ color: 'var(--token-text-muted)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--token-surface-secondary)'; e.currentTarget.style.color = 'var(--token-text-primary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--token-text-muted)'; }}
          data-testid="forgot-close-btn"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-6">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className="h-1 flex-1 rounded-full transition-all"
              style={{
                background: s <= step ? 'var(--token-primary)' : 'var(--token-border)',
              }}
            />
          ))}
        </div>

        {/* Icon */}
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
          style={{
            background: 'var(--token-primary-accent-soft)',
            color: 'var(--token-primary)',
          }}
        >
          {step === 1 && <Mail className="w-5 h-5" />}
          {step === 2 && <KeyRound className="w-5 h-5" />}
          {step === 3 && <CheckCircle2 className="w-5 h-5" />}
        </div>

        {/* Title */}
        <h2
          className="text-[20px] font-semibold tracking-tight mb-1"
          style={{ color: 'var(--token-text-primary)' }}
          data-testid="forgot-title"
        >
          {head.title}
        </h2>
        <p
          className="text-sm mb-6"
          style={{ color: 'var(--token-text-secondary)' }}
        >
          {head.subtitle}
        </p>

        {/* Error */}
        {error && (
          <div
            className="mb-4 px-3 py-2.5 rounded-lg text-sm"
            style={{
              background: 'var(--token-danger-tint)',
              color: 'var(--token-danger)',
              border: '1px solid var(--token-danger-border)',
            }}
            data-testid="forgot-error"
          >
            {error}
          </div>
        )}

        {/* Step 1 — request code */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label
                className="text-[11px] font-semibold uppercase tracking-wider block mb-2"
                style={{ color: 'var(--token-text-muted)' }}
              >
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all"
                style={{
                  background: 'var(--token-surface)',
                  border: '1px solid var(--token-border)',
                  color: 'var(--token-text-primary)',
                }}
                onFocus={(e) => { e.target.style.borderColor = 'var(--token-primary)'; e.target.style.boxShadow = '0 0 0 3px var(--token-primary-accent-soft)'; }}
                onBlur={(e) => { e.target.style.borderColor = 'var(--token-border)'; e.target.style.boxShadow = 'none'; }}
                data-testid="forgot-email-input"
              />
            </div>
            <button
              onClick={requestCode}
              disabled={loading}
              className="w-full py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              style={{
                background: 'var(--token-primary)',
                color: 'var(--token-primary-ink)',
              }}
              data-testid="forgot-send-btn"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Send reset code <ArrowRight className="w-4 h-4" /></>}
            </button>
          </div>
        )}

        {/* Step 2 — verify + new password */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label
                className="text-[11px] font-semibold uppercase tracking-wider block mb-2"
                style={{ color: 'var(--token-text-muted)' }}
              >
                6-digit code
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full rounded-xl px-4 py-3 text-lg font-mono tracking-[0.3em] text-center outline-none transition-all"
                style={{
                  background: 'var(--token-surface)',
                  border: '1px solid var(--token-border)',
                  color: 'var(--token-text-primary)',
                }}
                onFocus={(e) => { e.target.style.borderColor = 'var(--token-primary)'; e.target.style.boxShadow = '0 0 0 3px var(--token-primary-accent-soft)'; }}
                onBlur={(e) => { e.target.style.borderColor = 'var(--token-border)'; e.target.style.boxShadow = 'none'; }}
                data-testid="forgot-code-input"
              />
              {devCode && (
                <p
                  className="text-[11px] mt-1.5 font-mono"
                  style={{ color: 'var(--token-text-muted)' }}
                  data-testid="forgot-dev-code-hint"
                >
                  dev-mode code: {devCode}
                </p>
              )}
            </div>

            <div>
              <label
                className="text-[11px] font-semibold uppercase tracking-wider block mb-2"
                style={{ color: 'var(--token-text-muted)' }}
              >
                New password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full rounded-xl px-4 py-3 pr-12 text-sm outline-none transition-all"
                  style={{
                    background: 'var(--token-surface)',
                    border: '1px solid var(--token-border)',
                    color: 'var(--token-text-primary)',
                  }}
                  onFocus={(e) => { e.target.style.borderColor = 'var(--token-primary)'; e.target.style.boxShadow = '0 0 0 3px var(--token-primary-accent-soft)'; }}
                  onBlur={(e) => { e.target.style.borderColor = 'var(--token-border)'; e.target.style.boxShadow = 'none'; }}
                  data-testid="forgot-new-password-input"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors p-1"
                  style={{ color: 'var(--token-text-muted)' }}
                  data-testid="forgot-toggle-password"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label
                className="text-[11px] font-semibold uppercase tracking-wider block mb-2"
                style={{ color: 'var(--token-text-muted)' }}
              >
                Confirm new password
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all"
                style={{
                  background: 'var(--token-surface)',
                  border: '1px solid var(--token-border)',
                  color: 'var(--token-text-primary)',
                }}
                onFocus={(e) => { e.target.style.borderColor = 'var(--token-primary)'; e.target.style.boxShadow = '0 0 0 3px var(--token-primary-accent-soft)'; }}
                onBlur={(e) => { e.target.style.borderColor = 'var(--token-border)'; e.target.style.boxShadow = 'none'; }}
                data-testid="forgot-confirm-password-input"
              />
            </div>

            <button
              onClick={submitReset}
              disabled={loading}
              className="w-full py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              style={{
                background: 'var(--token-primary)',
                color: 'var(--token-primary-ink)',
              }}
              data-testid="forgot-submit-btn"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Set new password'}
            </button>

            <div className="flex items-center justify-between pt-1">
              <button
                onClick={() => setStep(1)}
                className="text-xs flex items-center gap-1 transition-colors"
                style={{ color: 'var(--token-text-secondary)' }}
                data-testid="forgot-back-btn"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Change email
              </button>
              <button
                onClick={resendIn > 0 ? undefined : requestCode}
                disabled={resendIn > 0 || loading}
                className="text-xs transition-colors disabled:opacity-50"
                style={{ color: resendIn > 0 ? 'var(--token-text-muted)' : 'var(--token-primary)' }}
                data-testid="forgot-resend-btn"
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — success */}
        {step === 3 && (
          <div className="text-center py-4">
            <p
              className="text-sm mb-6"
              style={{ color: 'var(--token-text-secondary)' }}
              data-testid="forgot-success-message"
            >
              All active sessions have been signed out for safety. Use your new password below.
            </p>
            <button
              onClick={onClose}
              className="w-full py-3.5 rounded-xl font-semibold text-sm transition-all"
              style={{
                background: 'var(--token-primary)',
                color: 'var(--token-primary-ink)',
              }}
              data-testid="forgot-done-btn"
            >
              Back to sign in
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ForgotPasswordModal;
