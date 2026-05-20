/**
 * Two-factor challenge — login second step (web).
 *
 * Arrives here after /auth/login returned { requires_2fa, challenge_token }.
 * State is passed via react-router `state` — if a user lands on this URL
 * with no state (refresh / bookmark) we kick them back to the login they
 * came from.
 *
 * Submits to /auth/2fa/verify with the device fingerprint and the
 * "Trust this device for 30 days" choice.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '@/App';
import { getDeviceFingerprint, getDeviceLabel } from '@/lib/deviceFingerprint';
import { Shield, Clock, KeyRound, Smartphone } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function TwoFactorChallengePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setUser } = useAuth();

  const ctx = useMemo(() => location.state || {}, [location.state]);
  const challengeToken = ctx.challenge_token;
  const ttlSeconds = ctx.ttl_seconds || 300;
  const fromPath = ctx.from || '/';
  const email = ctx.email || '';

  const [mode, setMode] = useState('totp');
  const [code, setCode] = useState('');
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(ttlSeconds);

  useEffect(() => {
    if (!challengeToken) {
      // No challenge in flight — send them back to the appropriate sign-in.
      if (fromPath.startsWith('/admin')) navigate('/admin/login', { replace: true });
      else if (fromPath.startsWith('/developer') || fromPath.startsWith('/tester')) navigate('/builder/auth', { replace: true });
      else navigate('/client/auth', { replace: true });
    }
  }, [challengeToken, fromPath, navigate]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft(v => Math.max(0, v - 1)), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  const ttlLabel = secondsLeft > 0
    ? `${Math.floor(secondsLeft / 60)}:${(secondsLeft % 60).toString().padStart(2, '0')}`
    : 'expired';

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!challengeToken) return;
    const cleaned = code.trim();
    if (!cleaned) { setError('Enter the code from your authenticator'); return; }
    setBusy(true); setError('');
    try {
      const r = await axios.post(
        `${API}/auth/2fa/verify`,
        {
          challenge_token: challengeToken,
          code: cleaned,
          device_fingerprint: getDeviceFingerprint(),
          trust_device: trust,
          device_label: getDeviceLabel(),
        },
        { withCredentials: true }
      );
      setUser(r.data);
      const role = r.data?.role;
      const target =
        fromPath && fromPath !== '/' ? fromPath :
        role === 'admin' ? '/admin/dashboard' :
        role === 'developer' ? '/developer/dashboard' :
        role === 'tester' ? '/tester/dashboard' :
        '/client/dashboard';
      navigate(target, { replace: true });
    } catch (err) {
      const detail = err.response?.data?.detail || err.response?.data?.message || 'Invalid code';
      setError(detail);
      setCode('');
      if (err.response?.status === 410) {
        setTimeout(() => navigate('/client/auth', { replace: true }), 1500);
      }
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    if (fromPath.startsWith('/admin')) navigate('/admin/login', { replace: true });
    else if (fromPath.startsWith('/developer') || fromPath.startsWith('/tester')) navigate('/builder/auth', { replace: true });
    else navigate('/client/auth', { replace: true });
  };

  return (
    <div className="min-h-screen bg-app text-text-primary flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mx-auto w-16 h-16 rounded-full bg-signal/10 border border-signal/30 flex items-center justify-center mb-6">
          <Shield className="w-8 h-8 text-signal" />
        </div>
        <h1 className="text-2xl font-bold text-center" data-testid="2fa-challenge-title">Two-factor verification</h1>
        <p className="text-center text-text-secondary mt-2 text-sm">
          Signing in to <span className="text-text-primary font-semibold">{email || 'your account'}</span>.
          Enter the {mode === 'totp' ? '6-digit code from your authenticator app' : 'recovery code'}.
        </p>

        <div className="mt-6 flex bg-surface rounded-full p-1 border border-border">
          <button
            type="button"
            data-testid="2fa-web-tab-totp"
            onClick={() => { setMode('totp'); setCode(''); setError(''); }}
            className={`flex-1 py-2 rounded-full text-sm font-semibold transition flex items-center justify-center gap-2 ${mode === 'totp' ? 'bg-signal/15 text-signal border border-signal/40' : 'text-text-muted'}`}
          >
            <Smartphone className="w-3.5 h-3.5" /> Authenticator
          </button>
          <button
            type="button"
            data-testid="2fa-web-tab-recovery"
            onClick={() => { setMode('recovery'); setCode(''); setError(''); }}
            className={`flex-1 py-2 rounded-full text-sm font-semibold transition flex items-center justify-center gap-2 ${mode === 'recovery' ? 'bg-signal/15 text-signal border border-signal/40' : 'text-text-muted'}`}
          >
            <KeyRound className="w-3.5 h-3.5" /> Recovery code
          </button>
        </div>

        <form onSubmit={submit} className="mt-5">
          {mode === 'totp' ? (
            <input
              data-testid="2fa-web-input"
              autoFocus
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); if (error) setError(''); }}
              placeholder="000000"
              className="w-full bg-surface border border-border rounded-lg px-4 py-4 text-center text-3xl tracking-[0.5em] font-bold text-text-primary placeholder:text-text-muted focus:outline-none focus:border-signal"
            />
          ) : (
            <input
              data-testid="2fa-web-recovery-input"
              autoFocus
              autoCapitalize="characters"
              maxLength={24}
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24)); if (error) setError(''); }}
              placeholder="ABCDE-12345"
              className="w-full bg-surface border border-border rounded-lg px-4 py-4 text-center text-xl tracking-widest font-mono font-bold text-text-primary placeholder:text-text-muted focus:outline-none focus:border-signal"
            />
          )}

          {!!error && (
            <div className="mt-3 text-sm text-red-400 text-center" data-testid="2fa-web-error">{error}</div>
          )}

          <label className="mt-5 flex items-start gap-3 cursor-pointer select-none" data-testid="2fa-web-trust-toggle">
            <input
              type="checkbox"
              checked={trust}
              onChange={(e) => setTrust(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-signal"
            />
            <span className="text-sm text-text-secondary">
              <span className="text-text-primary font-semibold">Trust this device for 30 days</span>
              <br />
              <span className="text-xs text-text-muted">Skip 2FA on this browser. Revoke any time in Settings.</span>
            </span>
          </label>

          <div className="mt-3 text-xs text-text-muted text-center flex items-center justify-center gap-1.5">
            <Clock className="w-3 h-3" /> Code request expires in {ttlLabel}
          </div>

          <button
            type="submit"
            data-testid="2fa-web-submit"
            disabled={busy || code.length < 4 || secondsLeft <= 0}
            className="mt-5 w-full bg-signal text-app font-bold py-3 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-signal/90 transition"
          >
            {busy ? 'Verifying…' : 'Verify & sign in'}
          </button>

          <button
            type="button"
            onClick={restart}
            data-testid="2fa-web-cancel"
            className="mt-3 w-full text-text-muted text-sm py-2 hover:text-text-secondary transition"
          >
            Cancel — back to sign in
          </button>
        </form>
      </div>
    </div>
  );
}
