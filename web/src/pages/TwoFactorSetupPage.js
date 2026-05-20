/**
 * Two-factor setup wizard (web).
 *
 * Three steps:
 *   1. intro     — explain TOTP, "Begin setup"
 *   2. scan      — QR code + manual secret + 6-digit verify
 *   3. recovery  — show 10 single-use codes, force ack, then back to /account
 *
 * Backend is the same as Expo — /api/account/me/2fa/setup,
 * /setup/verify, /setup/cancel.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '@/App';
import { Shield, KeyRound, Copy, Check, Download } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function TwoFactorSetupPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [step, setStep] = useState('intro');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [setupPayload, setSetupPayload] = useState(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [ack, setAck] = useState(false);
  const [copied, setCopied] = useState(false);

  // Drop pending secret on unmount if we never reached `recovery`.
  const finishedRef = useRef(false);
  useEffect(() => {
    return () => {
      if (!finishedRef.current && setupPayload && !recoveryCodes) {
        axios.post(`${API}/account/me/2fa/setup/cancel`, {}, { withCredentials: true }).catch(() => {});
      }
    };
  }, [setupPayload, recoveryCodes]);

  // If user already has 2FA, kick them to recovery management instead.
  useEffect(() => {
    if (user?.two_factor_enabled) {
      navigate('/account/2fa/recovery', { replace: true });
    }
  }, [user, navigate]);

  const begin = async () => {
    setBusy(true); setError('');
    try {
      const r = await axios.post(`${API}/account/me/2fa/setup`, {}, { withCredentials: true });
      setSetupPayload(r.data);
      setStep('scan');
    } catch (e) {
      setError(e.response?.data?.detail || 'Could not start setup');
    } finally { setBusy(false); }
  };

  const verify = async (e) => {
    e?.preventDefault?.();
    const clean = code.replace(/\D/g, '');
    if (clean.length !== 6) { setError('Enter the 6-digit code from your authenticator'); return; }
    setBusy(true); setError('');
    try {
      const r = await axios.post(
        `${API}/account/me/2fa/setup/verify`,
        { code: clean },
        { withCredentials: true }
      );
      setRecoveryCodes(r.data.recovery_codes || []);
      finishedRef.current = true;
      setStep('recovery');
    } catch (e2) {
      setError(e2.response?.data?.detail || 'Invalid code — try again with a fresh one');
      setCode('');
    } finally { setBusy(false); }
  };

  const copySecret = async () => {
    if (!setupPayload?.secret) return;
    await navigator.clipboard.writeText(setupPayload.secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const copyRecovery = async () => {
    if (!recoveryCodes) return;
    await navigator.clipboard.writeText(recoveryCodes.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const downloadRecovery = () => {
    if (!recoveryCodes) return;
    const text = [
      'ATLAS DevOS — Two-factor recovery codes',
      '',
      'Keep these somewhere safe. Each code works once.',
      '',
      ...recoveryCodes.map((c, i) => `${(i + 1).toString().padStart(2, ' ')}.  ${c}`),
    ].join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'atlas-recovery-codes.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const finish = () => {
    if (!ack) {
      setError('Tick the box to confirm you have saved the codes.');
      return;
    }
    navigate('/account/2fa/recovery', { replace: true });
  };

  return (
    <div className="min-h-screen bg-app text-text-primary flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        {step === 'intro' && (
          <div data-testid="2fa-web-setup-intro">
            <div className="mx-auto w-16 h-16 rounded-full bg-signal/10 border border-signal/30 flex items-center justify-center mb-6">
              <Shield className="w-8 h-8 text-signal" />
            </div>
            <h1 className="text-2xl font-bold text-center">Protect your account</h1>
            <p className="text-center text-text-secondary mt-2 text-sm leading-relaxed">
              Two-factor authentication adds a second check at sign-in — a 6-digit code from
              an authenticator app. Even if someone steals your password, they can't get in
              without your device.
            </p>

            <div className="mt-6 bg-surface rounded-lg border border-border p-4 space-y-4">
              <Bullet num="1" title="Scan a QR code" body="Use Google Authenticator, Authy, 1Password, or any TOTP app." />
              <Bullet num="2" title="Verify a code" body="Type the 6-digit code your app generates." />
              <Bullet num="3" title="Save recovery codes" body="10 single-use codes for emergencies." />
            </div>

            {!!error && <div className="mt-4 text-sm text-red-400 text-center">{error}</div>}

            <button
              onClick={begin}
              disabled={busy}
              data-testid="2fa-web-begin"
              className="mt-6 w-full bg-signal text-app font-bold py-3 rounded-lg disabled:opacity-40 hover:bg-signal/90 transition"
            >
              {busy ? 'Starting…' : 'Begin setup'}
            </button>
            <button
              onClick={() => navigate(-1)}
              className="mt-3 w-full text-text-muted text-sm py-2 hover:text-text-secondary transition"
            >
              Not now
            </button>
          </div>
        )}

        {step === 'scan' && setupPayload && (
          <div data-testid="2fa-web-setup-scan">
            <h1 className="text-2xl font-bold text-center">Scan with your authenticator</h1>
            <p className="text-center text-text-secondary mt-2 text-sm">
              Open your authenticator app and scan this code. If you can't scan, copy the
              secret below and enter it manually.
            </p>

            <div className="mt-6 flex justify-center">
              <div className="bg-white p-4 rounded-lg border border-border">
                <img
                  src={setupPayload.qr_data_url}
                  alt="2FA QR code"
                  className="w-56 h-56"
                  data-testid="2fa-web-qr"
                />
              </div>
            </div>

            <div className="mt-5">
              <div className="text-[10px] font-bold tracking-[0.2em] text-text-muted uppercase">Secret</div>
              <button
                onClick={copySecret}
                data-testid="2fa-web-copy-secret"
                className="mt-1.5 w-full flex items-center justify-between bg-surface border border-border rounded-lg px-3 py-3 hover:border-signal/50 transition"
              >
                <span className="font-mono text-sm text-text-primary truncate">{setupPayload.secret}</span>
                {copied ? <Check className="w-4 h-4 text-signal" /> : <Copy className="w-4 h-4 text-text-muted" />}
              </button>
            </div>

            <form onSubmit={verify} className="mt-6">
              <div className="text-[10px] font-bold tracking-[0.2em] text-text-muted uppercase">Enter the 6-digit code</div>
              <input
                data-testid="2fa-web-verify-input"
                inputMode="numeric"
                autoFocus
                maxLength={6}
                value={code}
                onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); if (error) setError(''); }}
                placeholder="000000"
                className="mt-1.5 w-full bg-surface border border-border rounded-lg px-4 py-4 text-center text-3xl tracking-[0.5em] font-bold text-text-primary placeholder:text-text-muted focus:outline-none focus:border-signal"
              />

              {!!error && <div className="mt-3 text-sm text-red-400 text-center">{error}</div>}

              <button
                type="submit"
                disabled={busy || code.length !== 6}
                data-testid="2fa-web-verify-btn"
                className="mt-5 w-full bg-signal text-app font-bold py-3 rounded-lg disabled:opacity-40 hover:bg-signal/90 transition"
              >
                {busy ? 'Verifying…' : 'Verify & enable'}
              </button>
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="mt-3 w-full text-text-muted text-sm py-2 hover:text-text-secondary transition"
              >
                Cancel
              </button>
            </form>
          </div>
        )}

        {step === 'recovery' && recoveryCodes && (
          <div data-testid="2fa-web-setup-recovery">
            <div className="mx-auto w-16 h-16 rounded-full bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center mb-6">
              <KeyRound className="w-8 h-8 text-yellow-400" />
            </div>
            <h1 className="text-2xl font-bold text-center">Save your recovery codes</h1>
            <p className="text-center text-text-secondary mt-2 text-sm leading-relaxed">
              If you lose your phone, these codes are your only way back in. Each code works{' '}
              <span className="text-text-primary font-bold">once</span>. Save them somewhere offline.
            </p>

            <div className="mt-5 grid grid-cols-2 gap-2">
              {recoveryCodes.map((c, i) => (
                <div
                  key={c}
                  data-testid={`2fa-web-recovery-${i}`}
                  className="bg-surface border border-border rounded-md px-3 py-2 flex items-center gap-2"
                >
                  <span className="text-[10px] text-text-muted font-bold w-5">{(i + 1).toString().padStart(2, '0')}</span>
                  <span className="font-mono text-sm font-bold text-text-primary">{c}</span>
                </div>
              ))}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={copyRecovery}
                data-testid="2fa-web-copy-recovery"
                className="flex-1 flex items-center justify-center gap-1.5 bg-surface border border-border rounded-md py-2.5 text-sm font-semibold hover:border-signal/50 transition"
              >
                {copied ? <Check className="w-4 h-4 text-signal" /> : <Copy className="w-4 h-4" />}
                Copy
              </button>
              <button
                onClick={downloadRecovery}
                data-testid="2fa-web-download-recovery"
                className="flex-1 flex items-center justify-center gap-1.5 bg-surface border border-border rounded-md py-2.5 text-sm font-semibold hover:border-signal/50 transition"
              >
                <Download className="w-4 h-4" />
                Download .txt
              </button>
            </div>

            <label className="mt-5 flex items-start gap-3 cursor-pointer" data-testid="2fa-web-ack">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => { setAck(e.target.checked); if (error) setError(''); }}
                className="mt-0.5 w-4 h-4 accent-signal"
              />
              <span className="text-sm text-text-secondary">
                I have saved these codes somewhere safe.
              </span>
            </label>

            {!!error && <div className="mt-3 text-sm text-red-400 text-center">{error}</div>}

            <button
              onClick={finish}
              disabled={!ack}
              data-testid="2fa-web-finish"
              className="mt-5 w-full bg-signal text-app font-bold py-3 rounded-lg disabled:opacity-40 hover:bg-signal/90 transition"
            >
              Done — 2FA is on
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Bullet({ num, title, body }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="w-7 h-7 rounded-full bg-signal/10 border border-signal/30 flex items-center justify-center flex-shrink-0">
        <span className="text-signal font-bold text-sm">{num}</span>
      </div>
      <div>
        <div className="font-semibold text-sm text-text-primary">{title}</div>
        <div className="text-xs text-text-muted mt-0.5">{body}</div>
      </div>
    </div>
  );
}
