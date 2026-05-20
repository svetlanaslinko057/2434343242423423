/**
 * Two-factor recovery & device management (web).
 *
 * Shows:
 *   - 2FA status (on/off) + "Enable" link if off
 *   - Recovery codes status (unused / total) + "Regenerate" (needs TOTP)
 *   - Trusted devices list with per-device "Revoke" buttons + "Revoke all"
 *   - "Disable 2FA" button (needs TOTP or recovery code)
 *
 * One canonical security surface — linked from /admin /client /developer
 * settings, and from /account if the user has 2FA on.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '@/App';
import {
  Shield, KeyRound, Monitor, AlertTriangle, Copy, Check, Download, X,
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function TwoFactorRecoveryPage() {
  const navigate = useNavigate();
  const { user, checkAuth } = useAuth();

  const [status, setStatus] = useState(null);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);

  // Regenerate modal
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenCode, setRegenCode] = useState('');
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenError, setRegenError] = useState('');
  const [fresh, setFresh] = useState(null);
  const [ack, setAck] = useState(false);
  const [copied, setCopied] = useState(false);

  // Disable modal
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [disableBusy, setDisableBusy] = useState(false);
  const [disableError, setDisableError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, d] = await Promise.all([
        axios.get(`${API}/account/me/2fa/recovery-codes/status`, { withCredentials: true }),
        axios.get(`${API}/account/me/2fa/trusted-devices`, { withCredentials: true }),
      ]);
      setStatus(s.data);
      setDevices(d.data?.devices || []);
    } catch {
      setStatus({ total: 0, unused: 0, enabled: false });
      setDevices([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const regenerate = async (e) => {
    e?.preventDefault?.();
    const clean = regenCode.replace(/\D/g, '');
    if (clean.length !== 6) { setRegenError('Enter the 6-digit code from your authenticator'); return; }
    setRegenBusy(true); setRegenError('');
    try {
      const r = await axios.post(
        `${API}/account/me/2fa/recovery-codes/regenerate`,
        { code: clean },
        { withCredentials: true }
      );
      setFresh(r.data.recovery_codes || []);
      setRegenOpen(false);
      setRegenCode('');
      await load();
    } catch (err) {
      setRegenError(err.response?.data?.detail || 'Could not regenerate codes');
    } finally { setRegenBusy(false); }
  };

  const disable = async (e) => {
    e?.preventDefault?.();
    const v = disableCode.trim();
    if (!v) { setDisableError('Enter your code'); return; }
    setDisableBusy(true); setDisableError('');
    try {
      await axios.post(
        `${API}/account/me/2fa/disable`,
        { code: v },
        { withCredentials: true }
      );
      setDisableOpen(false);
      setDisableCode('');
      await checkAuth();
      await load();
    } catch (err) {
      setDisableError(err.response?.data?.detail || 'Invalid code');
    } finally { setDisableBusy(false); }
  };

  const revoke = async (deviceId) => {
    try {
      await axios.delete(`${API}/account/me/2fa/trusted-devices/${deviceId}`, { withCredentials: true });
      await load();
    } catch {/* ignore */}
  };

  const revokeAll = async () => {
    if (!window.confirm('Revoke trust for all devices? Every device will be asked for 2FA again on next sign-in.')) return;
    try {
      await axios.post(`${API}/account/me/2fa/trusted-devices/revoke-all`, {}, { withCredentials: true });
      await load();
    } catch {/* ignore */}
  };

  const copyFresh = async () => {
    if (!fresh) return;
    await navigator.clipboard.writeText(fresh.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const downloadFresh = () => {
    if (!fresh) return;
    const text = [
      'ATLAS DevOS — Two-factor recovery codes',
      '',
      'Keep these somewhere safe. Each code works once.',
      '',
      ...fresh.map((c, i) => `${(i + 1).toString().padStart(2, ' ')}.  ${c}`),
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

  const dismissFresh = () => {
    if (!ack) { setRegenError('Tick the box to confirm you saved them.'); return; }
    setFresh(null);
    setAck(false);
  };

  const is2faOn = status?.enabled || user?.two_factor_enabled;

  if (loading) {
    return (
      <div className="min-h-screen bg-app flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-border border-t-signal rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app text-text-primary p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Shield className="w-6 h-6 text-signal" />
          <h1 className="text-2xl font-bold">Two-factor authentication</h1>
        </div>

        {/* Status card */}
        <div className="bg-surface border border-border rounded-lg p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm text-text-muted">Status</div>
              <div className={`text-xl font-bold mt-1 ${is2faOn ? 'text-signal' : 'text-text-secondary'}`} data-testid="2fa-web-status">
                {is2faOn ? 'Enabled' : 'Disabled'}
              </div>
              <div className="text-xs text-text-muted mt-1">
                {is2faOn ? 'TOTP authenticator required at sign-in.' : 'Anyone with your password can sign in.'}
              </div>
            </div>
            {!is2faOn ? (
              <Link
                to="/account/2fa/setup"
                data-testid="2fa-web-enable-btn"
                className="bg-signal text-app font-bold px-4 py-2 rounded-md hover:bg-signal/90 transition text-sm"
              >
                Enable 2FA
              </Link>
            ) : (
              <button
                onClick={() => { setDisableOpen(true); setDisableError(''); setDisableCode(''); }}
                data-testid="2fa-web-disable-btn"
                className="bg-surface border border-red-500/40 text-red-300 hover:bg-red-500/10 px-4 py-2 rounded-md transition text-sm font-semibold"
              >
                Disable
              </button>
            )}
          </div>
        </div>

        {is2faOn && (
          <>
            {/* Recovery codes */}
            <div className="mt-4 bg-surface border border-border rounded-lg p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-yellow-400" />
                    <div className="font-semibold">Recovery codes</div>
                  </div>
                  <div className="text-3xl font-bold text-text-primary mt-2">
                    <span data-testid="2fa-web-unused">{status?.unused ?? 0}</span>
                    <span className="text-text-muted text-xl"> / {status?.total ?? 0}</span>
                  </div>
                  <div className="text-xs text-text-muted mt-1">Unused single-use codes</div>
                </div>
                <button
                  onClick={() => { setRegenOpen(true); setRegenError(''); setRegenCode(''); }}
                  data-testid="2fa-web-regenerate-btn"
                  className="bg-surface border border-border hover:border-signal/50 text-text-primary font-semibold px-4 py-2 rounded-md transition text-sm"
                >
                  Regenerate
                </button>
              </div>
              {(status?.unused ?? 0) <= 2 && (
                <div className="mt-3 flex items-center gap-2 text-yellow-400 text-xs bg-yellow-500/10 border border-yellow-500/30 rounded px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Low recovery codes — regenerate before you run out.
                </div>
              )}
            </div>

            {/* Trusted devices */}
            <div className="mt-4 bg-surface border border-border rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-text-secondary" />
                  <div className="font-semibold">Trusted devices</div>
                </div>
                {devices.length > 0 && (
                  <button
                    onClick={revokeAll}
                    data-testid="2fa-web-revoke-all"
                    className="text-xs text-red-300 hover:text-red-200 font-semibold"
                  >
                    Revoke all
                  </button>
                )}
              </div>
              {devices.length === 0 ? (
                <div className="text-sm text-text-muted">No trusted devices. You'll be asked for 2FA on every sign-in.</div>
              ) : (
                <div className="space-y-2" data-testid="2fa-web-device-list">
                  {devices.map((d) => (
                    <div key={d.device_id} className="flex items-center justify-between bg-app border border-border rounded-md px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{d.label || 'Unknown device'}</div>
                        <div className="text-[11px] text-text-muted truncate">
                          {d.user_agent?.slice(0, 60) || 'no user-agent'}
                          {d.expires_at && ` · expires ${new Date(d.expires_at).toLocaleDateString()}`}
                        </div>
                      </div>
                      <button
                        onClick={() => revoke(d.device_id)}
                        data-testid={`2fa-web-revoke-${d.device_id}`}
                        className="text-text-muted hover:text-red-300 transition p-1.5"
                        title="Revoke"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Regenerate confirm modal */}
        {regenOpen && (
          <Modal onClose={() => setRegenOpen(false)}>
            <h3 className="text-lg font-bold">Confirm regeneration</h3>
            <p className="text-sm text-text-secondary mt-2">
              Enter the current 6-digit code from your authenticator to mint a fresh set of recovery codes.
              Old codes are invalidated immediately.
            </p>
            <form onSubmit={regenerate} className="mt-4">
              <input
                autoFocus
                inputMode="numeric"
                maxLength={6}
                value={regenCode}
                onChange={(e) => { setRegenCode(e.target.value.replace(/\D/g, '').slice(0, 6)); if (regenError) setRegenError(''); }}
                placeholder="000000"
                className="w-full bg-app border border-border rounded-md px-4 py-3 text-center text-2xl tracking-[0.5em] font-bold focus:outline-none focus:border-signal"
                data-testid="2fa-web-regen-input"
              />
              {!!regenError && <div className="mt-2 text-sm text-red-400 text-center">{regenError}</div>}
              <div className="mt-4 flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setRegenOpen(false)}
                  className="px-4 py-2 rounded-md bg-surface border border-border hover:border-border/80 text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={regenBusy || regenCode.length !== 6}
                  className="px-4 py-2 rounded-md bg-signal text-app font-bold text-sm disabled:opacity-40"
                  data-testid="2fa-web-regen-submit"
                >
                  {regenBusy ? 'Regenerating…' : 'Regenerate'}
                </button>
              </div>
            </form>
          </Modal>
        )}

        {/* Fresh codes panel */}
        {fresh && (
          <Modal onClose={() => {}} wide>
            <div className="flex items-center gap-2 mb-2">
              <KeyRound className="w-5 h-5 text-yellow-400" />
              <h3 className="text-lg font-bold">New recovery codes</h3>
            </div>
            <p className="text-sm text-text-secondary">Save these now. Old codes no longer work.</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {fresh.map((c, i) => (
                <div key={c} className="bg-app border border-border rounded-md px-3 py-2 flex items-center gap-2">
                  <span className="text-[10px] text-text-muted font-bold w-5">{(i + 1).toString().padStart(2, '0')}</span>
                  <span className="font-mono text-sm font-bold">{c}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={copyFresh} className="flex-1 flex items-center justify-center gap-1.5 bg-app border border-border rounded-md py-2 text-sm font-semibold hover:border-signal/50">
                {copied ? <Check className="w-4 h-4 text-signal" /> : <Copy className="w-4 h-4" />} Copy
              </button>
              <button onClick={downloadFresh} className="flex-1 flex items-center justify-center gap-1.5 bg-app border border-border rounded-md py-2 text-sm font-semibold hover:border-signal/50">
                <Download className="w-4 h-4" /> Download
              </button>
            </div>
            <label className="mt-4 flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 w-4 h-4 accent-signal" />
              <span className="text-sm text-text-secondary">I have saved these codes.</span>
            </label>
            {!!regenError && <div className="mt-2 text-sm text-red-400 text-center">{regenError}</div>}
            <button
              onClick={dismissFresh}
              disabled={!ack}
              className="mt-3 w-full bg-signal text-app font-bold py-2.5 rounded-md disabled:opacity-40"
            >
              Done
            </button>
          </Modal>
        )}

        {/* Disable confirm */}
        {disableOpen && (
          <Modal onClose={() => setDisableOpen(false)}>
            <h3 className="text-lg font-bold">Disable 2FA</h3>
            <p className="text-sm text-text-secondary mt-2">
              Enter your current 6-digit authenticator code, or a recovery code (XXXXX-XXXXX).
              Disabling 2FA removes your secret and recovery codes.
            </p>
            <form onSubmit={disable} className="mt-4">
              <input
                autoFocus
                autoCapitalize="characters"
                maxLength={24}
                value={disableCode}
                onChange={(e) => { setDisableCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24)); if (disableError) setDisableError(''); }}
                placeholder="123456 / ABCDE-12345"
                className="w-full bg-app border border-border rounded-md px-4 py-3 text-center text-lg tracking-wider font-mono font-bold focus:outline-none focus:border-signal"
                data-testid="2fa-web-disable-input"
              />
              {!!disableError && <div className="mt-2 text-sm text-red-400 text-center">{disableError}</div>}
              <div className="mt-4 flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setDisableOpen(false)}
                  className="px-4 py-2 rounded-md bg-surface border border-border text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={disableBusy || !disableCode.trim()}
                  className="px-4 py-2 rounded-md bg-red-500/20 text-red-200 border border-red-500/40 font-bold text-sm disabled:opacity-40"
                  data-testid="2fa-web-disable-confirm"
                >
                  {disableBusy ? 'Disabling…' : 'Disable 2FA'}
                </button>
              </div>
            </form>
          </Modal>
        )}

        <button
          onClick={() => navigate(-1)}
          className="mt-6 text-text-muted text-sm hover:text-text-primary transition"
        >
          ← Back
        </button>
      </div>
    </div>
  );
}

function Modal({ children, onClose, wide }) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`bg-surface border border-border rounded-lg p-5 w-full ${wide ? 'max-w-lg' : 'max-w-md'}`}
      >
        {children}
      </div>
    </div>
  );
}
