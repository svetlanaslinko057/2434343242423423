/**
 * Master Admin · Integrations & Keys
 *
 * Single source of truth for runtime-configurable secrets:
 *   • LLM (OpenAI / Emergent)        — backed by /api/admin/settings/llm
 *   • Email (Resend)                  — /api/admin/settings/integrations/email
 *   • Google Auth                     — /api/admin/settings/integrations/google_auth
 *   • WayForPay                       — /api/admin/settings/integrations/wayforpay
 *   • Stripe                          — /api/admin/settings/integrations/stripe
 *   • Preview URL & active provider   — /api/admin/settings/integrations/app
 *
 * Every save is hot-applied — no backend restart required.
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth, API } from '@/App';
import axios from 'axios';
import {
  Key, Loader2, CheckCircle2, XCircle, Save, Zap, Eye, EyeOff,
  AlertCircle, Sparkles, Globe, Shield, Mail, CreditCard, Link2,
} from 'lucide-react';

const MODEL_OPTIONS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'o1-mini'];

// ========================================================================== Section
function Section({ icon: Icon, title, badge, children }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Icon className="w-5 h-5 text-signal" />
        <h2 className="text-lg font-semibold">{title}</h2>
        {badge && <span className="ml-auto">{badge}</span>}
      </div>
      {children}
    </div>
  );
}

function StatusPill({ ok, label }) {
  if (ok) return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-900/40 border border-emerald-700/50 px-3 py-1 text-xs font-medium text-emerald-300">
      <CheckCircle2 className="w-3.5 h-3.5" /> {label || 'Configured'}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-900/40 border border-amber-700/50 px-3 py-1 text-xs font-medium text-amber-300">
      <AlertCircle className="w-3.5 h-3.5" /> {label || 'Not configured'}
    </span>
  );
}

function SecretInput({ value, onChange, placeholder, dataTestid }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        data-testid={dataTestid}
        className="w-full rounded-lg bg-muted border border-border px-3 py-2 pr-10 text-sm font-mono"
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

function Toast({ msg }) {
  if (!msg) return null;
  const ok = msg.type === 'ok';
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${ok ? 'border-emerald-700/50 bg-emerald-900/30 text-emerald-200' : 'border-red-700/50 bg-red-900/30 text-red-200'}`}>
      {msg.text}
    </div>
  );
}

// ========================================================================== Main
export default function AdminIntegrationsPage() {
  const { user } = useAuth();
  const [llmSettings, setLlmSettings] = useState(null);
  const [integrations, setIntegrations] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [testResult, setTestResult] = useState({});

  // Local form state (only the field admin types in)
  const [llmInput, setLlmInput] = useState({ openai: '', emergent: '', provider: 'openai', model: 'gpt-4o-mini' });
  const [emailInput, setEmailInput] = useState({ api_key: '', from_email: '', from_name: '' });
  const [googleInput, setGoogleInput] = useState({ client_id: '', client_secret: '' });
  const [wfpInput, setWfpInput] = useState({
    merchant_account: '', secret_key: '', merchant_password: '', domain: '', currency: 'UAH',
  });
  const [stripeInput, setStripeInput] = useState({
    publishable_key: '', secret_key: '', restricted_key: '', webhook_secret: '', currency: 'usd',
  });
  const [appInput, setAppInput] = useState({ preview_url: '', active_payment_provider: 'auto' });
  const [emailTestTo, setEmailTestTo] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [llmR, intR] = await Promise.all([
        axios.get(`${API}/admin/settings/llm`, { withCredentials: true }),
        axios.get(`${API}/admin/settings/integrations`, { withCredentials: true }),
      ]);
      setLlmSettings(llmR.data);
      setIntegrations(intR.data);
      setLlmInput((prev) => ({
        ...prev,
        provider: llmR.data.preferred_provider || 'openai',
        model: llmR.data.default_model || 'gpt-4o-mini',
      }));
      // Pre-populate non-secret fields so admin sees current values without retyping
      setEmailInput({
        api_key: '',
        from_email: intR.data.email.from_email || '',
        from_name: intR.data.email.from_name || '',
      });
      setGoogleInput({
        client_id: intR.data.google_auth.client_id || '',
        client_secret: '',
      });
      setWfpInput({
        merchant_account: intR.data.wayforpay.merchant_account || '',
        secret_key: '',
        merchant_password: '',
        domain: intR.data.wayforpay.domain || '',
        currency: intR.data.wayforpay.currency || 'UAH',
      });
      setStripeInput({
        publishable_key: intR.data.stripe.publishable_key || '',
        secret_key: '',
        restricted_key: '',
        webhook_secret: '',
        currency: intR.data.stripe.currency || 'usd',
      });
      setAppInput({
        preview_url: intR.data.app.preview_url || '',
        active_payment_provider: intR.data.app.active_payment_provider || 'auto',
      });
    } catch (e) {
      setMsg({ type: 'err', text: e?.response?.data?.detail || 'Failed to load settings' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Generic save helper
  const saveBlock = async (block, body) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await axios.put(`${API}/admin/settings/integrations/${block}`, body, { withCredentials: true });
      setIntegrations(r.data);
      setMsg({ type: 'ok', text: `${block} saved. Hot-reloaded — no restart needed.` });
      // Wipe secret fields after save (they're now persisted)
      if (block === 'email') setEmailInput((s) => ({ ...s, api_key: '' }));
      if (block === 'google_auth') setGoogleInput((s) => ({ ...s, client_secret: '' }));
      if (block === 'wayforpay') setWfpInput((s) => ({ ...s, secret_key: '', merchant_password: '' }));
      if (block === 'stripe') setStripeInput((s) => ({ ...s, secret_key: '', restricted_key: '', webhook_secret: '' }));
    } catch (e) {
      setMsg({ type: 'err', text: e?.response?.data?.detail || 'Save failed' });
    } finally {
      setBusy(false);
    }
  };

  // Save LLM (separate endpoint, kept from original page)
  const saveLlm = async () => {
    setBusy(true);
    const body = { preferred_provider: llmInput.provider, default_model: llmInput.model };
    if (llmInput.openai !== '') body.openai_api_key = llmInput.openai;
    if (llmInput.emergent !== '') body.emergent_llm_key = llmInput.emergent;
    try {
      const r = await axios.put(`${API}/admin/settings/llm`, body, { withCredentials: true });
      setLlmSettings(r.data);
      setLlmInput((s) => ({ ...s, openai: '', emergent: '' }));
      setMsg({ type: 'ok', text: 'LLM settings saved.' });
    } catch (e) {
      setMsg({ type: 'err', text: e?.response?.data?.detail || 'Save failed' });
    } finally {
      setBusy(false);
    }
  };

  const runTest = async (kind, body = {}) => {
    setTestResult((tr) => ({ ...tr, [kind]: { loading: true } }));
    try {
      const path = kind === 'llm'
        ? `${API}/admin/settings/llm/test`
        : `${API}/admin/settings/integrations/${kind}/test`;
      const r = await axios.post(path, body, { withCredentials: true });
      setTestResult((tr) => ({ ...tr, [kind]: r.data }));
    } catch (e) {
      setTestResult((tr) => ({ ...tr, [kind]: { ok: false, error: e?.response?.data?.detail || 'Test failed' } }));
    }
  };

  if (loading) return <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-signal" /></div>;
  if (user?.role !== 'admin') return (
    <div className="p-6 flex items-center gap-2 text-red-400">
      <Shield className="w-5 h-5" /> Admin access required
    </div>
  );

  const i = integrations || {};

  return (
    <div className="space-y-6 p-6 max-w-5xl" data-testid="admin-integrations-page">
      <div className="flex items-center gap-3">
        <Key className="w-6 h-6 text-signal" />
        <div>
          <h1 className="text-2xl font-semibold">Integrations &amp; Keys</h1>
          <p className="text-sm text-muted-foreground">
            Configure every external integration here. All saves take effect immediately — no redeploy.
          </p>
        </div>
      </div>

      <Toast msg={msg} />

      {/* ============================================================ APP / Preview URL */}
      <Section
        icon={Link2}
        title="App URL & Active Payment Provider"
        badge={<StatusPill ok={!!i.app?.preview_url} label={i.app?.preview_url ? 'Set' : 'Auto-detect'} />}
      >
        <p className="text-xs text-muted-foreground">
          The Emergent preview URL changes between sessions. Saving a value here pins it as the canonical
          base URL used in payment callbacks, success/cancel redirects, and the public config endpoint.
        </p>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview / App URL</label>
          <input
            type="text"
            value={appInput.preview_url}
            onChange={(e) => setAppInput({ ...appInput, preview_url: e.target.value })}
            placeholder="https://<sub>.preview.emergentagent.com"
            data-testid="app-preview-url-input"
            className="w-full rounded-lg bg-muted border border-border px-3 py-2 text-sm font-mono mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Active Payment Provider</label>
          <select
            value={appInput.active_payment_provider}
            onChange={(e) => setAppInput({ ...appInput, active_payment_provider: e.target.value })}
            data-testid="app-payment-provider-select"
            className="w-full rounded-lg bg-muted border border-border px-3 py-2 text-sm mt-1"
          >
            <option value="auto">auto — pick whatever's configured (Stripe → WFP → Mock)</option>
            <option value="stripe">stripe — force Stripe</option>
            <option value="wayforpay">wayforpay — force WayForPay</option>
            <option value="mock">mock — dev only</option>
          </select>
        </div>
        <div className="flex justify-end">
          <button
            onClick={() => saveBlock('app', appInput)}
            disabled={busy}
            data-testid="app-save-btn"
            className="inline-flex items-center gap-2 rounded-lg bg-signal hover:bg-signal disabled:opacity-40 px-4 py-2 text-sm font-medium text-white"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
          </button>
        </div>
      </Section>

      {/* ============================================================ EMAIL / Resend */}
      <Section
        icon={Mail}
        title="Email · Resend"
        badge={<StatusPill ok={i.email?.configured} label={i.email?.configured ? `Key: ${i.email.api_key_masked}` : 'Not configured'} />}
      >
        <p className="text-xs text-muted-foreground">
          Resend API key drives OTP sign-in, password reset and notifications. Get one at{' '}
          <a href="https://resend.com/api-keys" target="_blank" rel="noreferrer" className="underline">resend.com/api-keys</a>.
          Leave the key field empty to keep the current value.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">API key</label>
            <SecretInput
              value={emailInput.api_key}
              onChange={(v) => setEmailInput({ ...emailInput, api_key: v })}
              placeholder={i.email?.configured ? '•••••••••• (leave empty to keep)' : 're_…'}
              dataTestid="email-api-key-input"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">From email</label>
            <input
              type="email"
              value={emailInput.from_email}
              onChange={(e) => setEmailInput({ ...emailInput, from_email: e.target.value })}
              placeholder="onboarding@resend.dev"
              data-testid="email-from-input"
              className="w-full rounded-lg bg-muted border border-border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">From name</label>
            <input
              type="text"
              value={emailInput.from_name}
              onChange={(e) => setEmailInput({ ...emailInput, from_name: e.target.value })}
              placeholder="EVA-X"
              data-testid="email-from-name-input"
              className="w-full rounded-lg bg-muted border border-border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Test recipient</label>
            <div className="flex gap-2">
              <input
                type="email"
                value={emailTestTo}
                onChange={(e) => setEmailTestTo(e.target.value)}
                placeholder="me@example.com"
                data-testid="email-test-to-input"
                className="flex-1 rounded-lg bg-muted border border-border px-3 py-2 text-sm"
              />
              <button
                onClick={() => runTest('email', { to: emailTestTo })}
                disabled={!emailTestTo || testResult.email?.loading}
                data-testid="email-test-btn"
                className="rounded-lg bg-signal hover:bg-signal disabled:opacity-40 px-3 py-2 text-xs font-medium text-white inline-flex items-center gap-1"
              >
                {testResult.email?.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />} Test
              </button>
            </div>
          </div>
        </div>
        {testResult.email && !testResult.email.loading && (
          <div className={`text-xs px-3 py-2 rounded ${testResult.email.ok ? 'bg-emerald-900/30 text-emerald-200' : 'bg-red-900/30 text-red-200'}`}>
            {testResult.email.ok ? `Sent ✓ id=${testResult.email.message_id}` : testResult.email.error}
          </div>
        )}
        <div className="flex justify-end">
          <button
            onClick={() => saveBlock('email', emailInput)}
            disabled={busy}
            data-testid="email-save-btn"
            className="inline-flex items-center gap-2 rounded-lg bg-signal hover:bg-signal disabled:opacity-40 px-4 py-2 text-sm font-medium text-white"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Email
          </button>
        </div>
      </Section>

      {/* ============================================================ GOOGLE AUTH */}
      <Section
        icon={Globe}
        title="Google Sign-In"
        badge={<StatusPill ok={i.google_auth?.configured} label={i.google_auth?.configured ? 'Client ID set' : 'No Client ID'} />}
      >
        <p className="text-xs text-muted-foreground">
          Real Google OAuth (ID-token verify flow). Create OAuth 2.0 Client ID at{' '}
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="underline">console.cloud.google.com</a>{' '}
          → APIs &amp; Services → Credentials. Copy the <strong>Client ID</strong> here. Authorized JavaScript origins must include your preview URL.
        </p>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">OAuth 2.0 Client ID (PUBLIC — exposed to browsers)</label>
            <input
              type="text"
              value={googleInput.client_id}
              onChange={(e) => setGoogleInput({ ...googleInput, client_id: e.target.value })}
              placeholder="…apps.googleusercontent.com"
              data-testid="google-client-id-input"
              className="w-full rounded-lg bg-muted border border-border px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Client Secret (server-side only · optional, only needed for server-flow OAuth)</label>
            <SecretInput
              value={googleInput.client_secret}
              onChange={(v) => setGoogleInput({ ...googleInput, client_secret: v })}
              placeholder={i.google_auth?.client_secret_masked || 'GOCSPX-…'}
              dataTestid="google-client-secret-input"
            />
          </div>
        </div>
        {testResult.google_auth && (
          <div className={`text-xs px-3 py-2 rounded ${testResult.google_auth.ok ? 'bg-emerald-900/30 text-emerald-200' : 'bg-red-900/30 text-red-200'}`}>
            {testResult.google_auth.ok ? testResult.google_auth.note || 'OK' : testResult.google_auth.error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={() => runTest('google_auth')}
            data-testid="google-test-btn"
            className="rounded-lg bg-signal hover:bg-signal px-3 py-2 text-xs font-medium text-white inline-flex items-center gap-1"
          >
            <Zap className="w-3 h-3" /> Validate
          </button>
          <button
            onClick={() => saveBlock('google_auth', googleInput)}
            disabled={busy}
            data-testid="google-save-btn"
            className="inline-flex items-center gap-2 rounded-lg bg-signal hover:bg-signal disabled:opacity-40 px-4 py-2 text-sm font-medium text-white"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Google
          </button>
        </div>
      </Section>

      {/* ============================================================ STRIPE */}
      <Section
        icon={CreditCard}
        title="Stripe"
        badge={<StatusPill ok={i.stripe?.configured} label={i.stripe?.configured ? `Secret: ${i.stripe.secret_key_masked}` : 'Not configured'} />}
      >
        <p className="text-xs text-muted-foreground">
          Stripe powers card / Apple Pay / Google Pay / crypto. Get keys from{' '}
          <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer" className="underline">dashboard.stripe.com/apikeys</a>.
          Use <code className="bg-muted px-1 rounded">pk_test_…</code> / <code className="bg-muted px-1 rounded">sk_test_…</code> for testing.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Publishable key (PUBLIC)</label>
            <input
              type="text"
              value={stripeInput.publishable_key}
              onChange={(e) => setStripeInput({ ...stripeInput, publishable_key: e.target.value })}
              placeholder="pk_test_…"
              data-testid="stripe-pk-input"
              className="w-full rounded-lg bg-muted border border-border px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Secret key</label>
            <SecretInput
              value={stripeInput.secret_key}
              onChange={(v) => setStripeInput({ ...stripeInput, secret_key: v })}
              placeholder={i.stripe?.configured ? '•••••••••• (leave empty to keep)' : 'sk_test_…'}
              dataTestid="stripe-sk-input"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Restricted key (read-only ops)</label>
            <SecretInput
              value={stripeInput.restricted_key}
              onChange={(v) => setStripeInput({ ...stripeInput, restricted_key: v })}
              placeholder={i.stripe?.restricted_key_masked || 'rk_test_…'}
              dataTestid="stripe-rk-input"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Webhook signing secret</label>
            <SecretInput
              value={stripeInput.webhook_secret}
              onChange={(v) => setStripeInput({ ...stripeInput, webhook_secret: v })}
              placeholder={i.stripe?.webhook_secret_masked || 'whsec_…'}
              dataTestid="stripe-whsec-input"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Default currency</label>
            <select
              value={stripeInput.currency}
              onChange={(e) => setStripeInput({ ...stripeInput, currency: e.target.value })}
              data-testid="stripe-currency-select"
              className="w-full rounded-lg bg-muted border border-border px-3 py-2 text-sm"
            >
              <option value="usd">USD</option>
              <option value="eur">EUR</option>
              <option value="gbp">GBP</option>
              <option value="uah">UAH (auto-converts to USD)</option>
            </select>
          </div>
        </div>
        {testResult.stripe && (
          <div className={`text-xs px-3 py-2 rounded ${testResult.stripe.ok ? 'bg-emerald-900/30 text-emerald-200' : 'bg-red-900/30 text-red-200'}`}>
            {testResult.stripe.ok
              ? `Account ${testResult.stripe.account_id} · ${testResult.stripe.country} · charges ${testResult.stripe.charges_enabled ? 'enabled' : 'disabled'}`
              : testResult.stripe.error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={() => runTest('stripe')}
            data-testid="stripe-test-btn"
            className="rounded-lg bg-signal hover:bg-signal px-3 py-2 text-xs font-medium text-white inline-flex items-center gap-1"
          >
            <Zap className="w-3 h-3" /> Test connection
          </button>
          <button
            onClick={() => saveBlock('stripe', stripeInput)}
            disabled={busy}
            data-testid="stripe-save-btn"
            className="inline-flex items-center gap-2 rounded-lg bg-signal hover:bg-signal disabled:opacity-40 px-4 py-2 text-sm font-medium text-white"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Stripe
          </button>
        </div>
      </Section>

      {/* ============================================================ WAYFORPAY */}
      <Section
        icon={CreditCard}
        title="WayForPay"
        badge={<StatusPill ok={i.wayforpay?.configured} label={i.wayforpay?.configured ? `Merchant: ${i.wayforpay.merchant_account}` : 'Not configured'} />}
      >
        <p className="text-xs text-muted-foreground">
          UA-focused card payments. Credentials live at{' '}
          <a href="https://m.wayforpay.com/account/site" target="_blank" rel="noreferrer" className="underline">m.wayforpay.com → Sites</a>.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Merchant account (login)</label>
            <input
              type="text"
              value={wfpInput.merchant_account}
              onChange={(e) => setWfpInput({ ...wfpInput, merchant_account: e.target.value })}
              placeholder="y_store_in_ua"
              data-testid="wfp-merchant-input"
              className="w-full rounded-lg bg-muted border border-border px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Domain</label>
            <input
              type="text"
              value={wfpInput.domain}
              onChange={(e) => setWfpInput({ ...wfpInput, domain: e.target.value })}
              placeholder="evax.io"
              data-testid="wfp-domain-input"
              className="w-full rounded-lg bg-muted border border-border px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Secret key</label>
            <SecretInput
              value={wfpInput.secret_key}
              onChange={(v) => setWfpInput({ ...wfpInput, secret_key: v })}
              placeholder={i.wayforpay?.configured ? '•••••••••• (leave empty to keep)' : '32-hex'}
              dataTestid="wfp-secret-input"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Merchant password</label>
            <SecretInput
              value={wfpInput.merchant_password}
              onChange={(v) => setWfpInput({ ...wfpInput, merchant_password: v })}
              placeholder={i.wayforpay?.merchant_password_masked || '32-hex'}
              dataTestid="wfp-pw-input"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Currency</label>
            <select
              value={wfpInput.currency}
              onChange={(e) => setWfpInput({ ...wfpInput, currency: e.target.value })}
              data-testid="wfp-currency-select"
              className="w-full rounded-lg bg-muted border border-border px-3 py-2 text-sm"
            >
              <option value="UAH">UAH</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
        </div>
        {testResult.wayforpay && (
          <div className={`text-xs px-3 py-2 rounded ${testResult.wayforpay.ok ? 'bg-emerald-900/30 text-emerald-200' : 'bg-red-900/30 text-red-200'}`}>
            {testResult.wayforpay.ok ? testResult.wayforpay.note : testResult.wayforpay.error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={() => runTest('wayforpay')}
            data-testid="wfp-test-btn"
            className="rounded-lg bg-signal hover:bg-signal px-3 py-2 text-xs font-medium text-white inline-flex items-center gap-1"
          >
            <Zap className="w-3 h-3" /> Validate
          </button>
          <button
            onClick={() => saveBlock('wayforpay', wfpInput)}
            disabled={busy}
            data-testid="wfp-save-btn"
            className="inline-flex items-center gap-2 rounded-lg bg-signal hover:bg-signal disabled:opacity-40 px-4 py-2 text-sm font-medium text-white"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save WayForPay
          </button>
        </div>
      </Section>

      {/* ============================================================ LLM (legacy) */}
      <Section
        icon={Sparkles}
        title="LLM · OpenAI / Emergent (existing)"
        badge={<StatusPill ok={!!llmSettings?.active_provider} label={llmSettings?.active_provider || 'No key'} />}
      >
        <p className="text-xs text-muted-foreground">
          Drives Estimate AI, scope generation and operator brains.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">OpenAI API key</label>
            <SecretInput
              value={llmInput.openai}
              onChange={(v) => setLlmInput({ ...llmInput, openai: v })}
              placeholder={llmSettings?.openai?.configured ? `Current: ${llmSettings.openai.masked}` : 'sk-proj-…'}
              dataTestid="llm-openai-input"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Emergent Universal Key</label>
            <SecretInput
              value={llmInput.emergent}
              onChange={(v) => setLlmInput({ ...llmInput, emergent: v })}
              placeholder={llmSettings?.emergent?.configured ? `Current: ${llmSettings.emergent.masked}` : 'emergent_…'}
              dataTestid="llm-emergent-input"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Preferred provider</label>
            <select
              value={llmInput.provider}
              onChange={(e) => setLlmInput({ ...llmInput, provider: e.target.value })}
              data-testid="llm-provider-select"
              className="w-full rounded-lg bg-muted border border-border px-3 py-2 text-sm"
            >
              <option value="openai">openai</option>
              <option value="emergent">emergent</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Default model</label>
            <select
              value={llmInput.model}
              onChange={(e) => setLlmInput({ ...llmInput, model: e.target.value })}
              data-testid="llm-model-select"
              className="w-full rounded-lg bg-muted border border-border px-3 py-2 text-sm"
            >
              {MODEL_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
        {testResult.llm && (
          <div className={`text-xs px-3 py-2 rounded ${testResult.llm.ok ? 'bg-emerald-900/30 text-emerald-200' : 'bg-red-900/30 text-red-200'}`}>
            {testResult.llm.ok ? `OK · ${testResult.llm.provider}/${testResult.llm.model} · ${testResult.llm.response}` : testResult.llm.error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={() => runTest('llm')}
            data-testid="llm-test-btn"
            className="rounded-lg bg-signal hover:bg-signal px-3 py-2 text-xs font-medium text-white inline-flex items-center gap-1"
          >
            <Zap className="w-3 h-3" /> Test
          </button>
          <button
            onClick={saveLlm}
            disabled={busy}
            data-testid="llm-save-btn"
            className="inline-flex items-center gap-2 rounded-lg bg-signal hover:bg-signal disabled:opacity-40 px-4 py-2 text-sm font-medium text-white"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save LLM
          </button>
        </div>
      </Section>
    </div>
  );
}
