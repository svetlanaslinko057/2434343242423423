/**
 * Master Admin · Payments Center
 *
 * Полноценная админка платёжной системы — всё, что отдают Stripe и
 * WayForPay, плюс кросс-провайдерная экономика (валюты, лимиты, налоги,
 * комиссии, локали). Все сохранения горячие, без рестарта.
 *
 * Разделы:
 *   1. Provider switch          — кто сейчас активен (auto / stripe / wfp / mock)
 *   2. Pricing & Currencies     — default + allowed currencies, min/max, fees, tax
 *   3. Stripe deep config       — все Checkout Session параметры
 *   4. WayForPay deep config    — language, lifetime, payment systems
 *   5. URLs                     — success/cancel paths
 *   6. Live test checkout       — выписать настоящий Stripe Session за 1 клик
 *   7. Recent transactions      — последние транзакции из payment_transactions
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/App';
// ─── Runtime-client migration (Batch 1 — Web Admin Finance) ─────────────
// Transport-swap only. Local loading/busy/msg state preserved (doctrine).
// AdminPaymentsPage manages provider CREDENTIALS — it does not itself move
// money, so no `capability: 'payment'` gate on writes. The live test
// `test-checkout` IS a real checkout against Stripe/WayForPay sandbox, but
// it's already isolated to test-mode by definition (admin chooses sandbox
// keys in `mode: 'test'`); we keep it ungated so admins can validate their
// keys before flipping `app.active_payment_provider` to live.
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import {
  CreditCard, Loader2, Save, Zap, Eye, EyeOff,
  CheckCircle2, AlertCircle, Globe, DollarSign, Percent, Settings2,
  Receipt, ExternalLink, ListChecks,
} from 'lucide-react';

const ALL_CURRENCIES = [
  ['usd', 'USD · US Dollar'],
  ['eur', 'EUR · Euro'],
  ['gbp', 'GBP · British Pound'],
  ['uah', 'UAH · Ukrainian Hryvnia'],
  ['pln', 'PLN · Polish Zloty'],
  ['czk', 'CZK · Czech Koruna'],
  ['cad', 'CAD · Canadian Dollar'],
  ['aud', 'AUD · Australian Dollar'],
  ['jpy', 'JPY · Japanese Yen'],
  ['sek', 'SEK · Swedish Krona'],
];
const STRIPE_PAYMENT_METHODS = [
  ['card', 'Cards (Visa / MC / Amex)'],
  ['link', 'Stripe Link'],
  ['klarna', 'Klarna'],
  ['afterpay_clearpay', 'Afterpay / Clearpay'],
  ['affirm', 'Affirm'],
  ['sepa_debit', 'SEPA Direct Debit'],
  ['ideal', 'iDEAL'],
  ['bancontact', 'Bancontact'],
  ['eps', 'EPS'],
  ['p24', 'P24'],
  ['giropay', 'Giropay'],
  ['sofort', 'Sofort'],
  ['alipay', 'Alipay'],
  ['wechat_pay', 'WeChat Pay'],
  ['cashapp', 'Cash App Pay'],
];
const WFP_PAYMENT_SYSTEMS = ['card', 'applepay', 'googlepay', 'privat24', 'masterpass', 'qrCode'];
const LOCALES = [['auto', 'Auto'], ['en', 'English'], ['uk', 'Українська'], ['ru', 'Русский'],
  ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pl', 'Polski']];

// ======================================================================== UI helpers
function Section({ icon: Icon, title, desc, children, badge }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start gap-3">
        <Icon className="w-5 h-5 mt-0.5 text-signal flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold">{title}</h2>
          {desc && <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>}
        </div>
        {badge && <div>{badge}</div>}
      </div>
      {children}
    </div>
  );
}
function Pill({ ok, label }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border ${ok ? 'bg-emerald-900/40 border-emerald-700/50 text-emerald-300' : 'bg-amber-900/40 border-amber-700/50 text-amber-300'}`}>
      {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />} {label}
    </span>
  );
}
function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}
function Input({ value, onChange, placeholder, type = 'text', testid, ...rest }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={(e) => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
      placeholder={placeholder}
      data-testid={testid}
      className="w-full rounded-lg bg-muted border border-border px-3 py-2 text-sm font-mono"
      {...rest}
    />
  );
}
function Secret({ value, onChange, placeholder, testid }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        data-testid={testid}
        className="w-full rounded-lg bg-muted border border-border px-3 py-2 pr-10 text-sm font-mono"
      />
      <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}
function Select({ value, onChange, options, testid }) {
  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      data-testid={testid}
      className="w-full rounded-lg bg-muted border border-border px-3 py-2 text-sm"
    >
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
function MultiCheckbox({ value, onChange, options, testid }) {
  const set = new Set(value || []);
  const toggle = (v) => {
    const next = new Set(set);
    next.has(v) ? next.delete(v) : next.add(v);
    onChange(Array.from(next));
  };
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2" data-testid={testid}>
      {options.map(([v, l]) => (
        <label key={v} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-xs ${set.has(v) ? 'border-signal/60 bg-signal/30 text-signal' : 'border-border bg-muted text-muted-foreground hover:bg-muted/60'}`}>
          <input type="checkbox" checked={set.has(v)} onChange={() => toggle(v)} className="hidden" />
          <span className={`w-3 h-3 rounded border-2 ${set.has(v) ? 'bg-signal border-signal' : 'border-muted-foreground'}`} />
          <span>{l}</span>
        </label>
      ))}
    </div>
  );
}
function Toggle({ value, onChange, label, testid }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer" data-testid={testid}>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative w-10 h-6 rounded-full transition ${value ? 'bg-signal' : 'bg-muted border border-border'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : ''}`} />
      </button>
      <span className="text-sm">{label}</span>
    </label>
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
function SaveBtn({ onClick, busy, label = 'Save', testid }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      data-testid={testid}
      className="inline-flex items-center gap-2 rounded-lg bg-signal hover:bg-signal disabled:opacity-40 px-4 py-2 text-sm font-medium text-white"
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {label}
    </button>
  );
}

// ======================================================================== Page
export default function AdminPaymentsPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  // Form state per block
  const [stripeForm, setStripeForm] = useState({});
  const [wfpForm, setWfpForm] = useState({});
  const [paymentsForm, setPaymentsForm] = useState({});
  const [appForm, setAppForm] = useState({ active_payment_provider: 'auto' });

  // Live test
  const [testForm, setTestForm] = useState({ provider: 'stripe', amount: 5, currency: 'usd', description: 'Admin smoke test' });
  const [testResult, setTestResult] = useState(null);

  // Recent transactions
  const [txs, setTxs] = useState([]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [intR, txR] = await Promise.all([
        runtime.get(`/api/admin/settings/integrations`),
        runtime.get(`/api/admin/payments/transactions?limit=20`).catch(() => ({ data: { items: [] } })),
      ]);
      setData(intR.data);
      const i = intR.data;
      // Pre-populate forms with current (non-secret) values
      setStripeForm({
        publishable_key: i.stripe.publishable_key || '',
        secret_key: '', restricted_key: '', webhook_secret: '',
        currency: i.stripe.currency,
        mode: i.stripe.mode,
        capture_method: i.stripe.capture_method,
        payment_method_types: i.stripe.payment_method_types,
        billing_address_collection: i.stripe.billing_address_collection,
        phone_number_collection: i.stripe.phone_number_collection,
        customer_creation: i.stripe.customer_creation,
        submit_type: i.stripe.submit_type,
        save_payment_method: i.stripe.save_payment_method,
      });
      setWfpForm({
        merchant_account: i.wayforpay.merchant_account,
        secret_key: '', merchant_password: '',
        domain: i.wayforpay.domain,
        currency: i.wayforpay.currency,
        language: i.wayforpay.language,
        order_lifetime: i.wayforpay.order_lifetime,
        payment_systems: i.wayforpay.payment_systems,
      });
      setPaymentsForm({ ...i.payments });
      setAppForm({ active_payment_provider: i.app.active_payment_provider });
      setTxs(txR.data?.items || []);
    } catch (e) {
      const msg = e instanceof ApiError ? (e.hint || e.message) : 'Failed to load';
      setMsg({ type: 'err', text: msg });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const save = async (block, body, label) => {
    setBusy(true); setMsg(null);
    try {
      // Persisting integration credentials — admin double-submit guard.
      const r = await runtime.put(`/api/admin/settings/integrations/${block}`, body, {
        idempotencyKey: `int-save:${block}:${Date.now()}`,
      });
      setData(r.data);
      setMsg({ type: 'ok', text: `${label} saved · hot-reloaded` });
      // Wipe newly-typed secrets
      if (block === 'stripe') setStripeForm((s) => ({ ...s, secret_key: '', restricted_key: '', webhook_secret: '' }));
      if (block === 'wayforpay') setWfpForm((s) => ({ ...s, secret_key: '', merchant_password: '' }));
    } catch (e) {
      const msg = e instanceof ApiError ? (e.hint || e.message) : 'Save failed';
      setMsg({ type: 'err', text: msg });
    } finally { setBusy(false); }
  };

  const runLiveTest = async () => {
    setTestResult({ loading: true });
    try {
      const r = await runtime.post(`/api/admin/settings/integrations/test-checkout`, testForm);
      setTestResult(r.data);
    } catch (e) {
      const msg = e instanceof ApiError ? (e.hint || e.message) : 'Test failed';
      setTestResult({ ok: false, error: msg });
    }
  };

  if (loading) return <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-signal" /></div>;
  if (user?.role !== 'admin') return <div className="p-6 text-red-400">Admin required</div>;
  if (!data) return null;

  const i = data;

  return (
    <div className="space-y-5 p-6 max-w-5xl" data-testid="admin-payments-page">
      <div className="flex items-center gap-3">
        <CreditCard className="w-6 h-6 text-signal" />
        <div>
          <h1 className="text-2xl font-semibold">Payments Center</h1>
          <p className="text-sm text-muted-foreground">
            Один центр управления валютами, провайдерами, методами оплаты и checkout-конфигом. Все сохранения применяются мгновенно.
          </p>
        </div>
      </div>

      <Toast msg={msg} />

      {/* ===================================================== 1. Provider switch */}
      <Section
        icon={Settings2}
        title="Active Payment Provider"
        desc="Какой провайдер обрабатывает все новые платежи. Auto: Stripe → WayForPay → Mock в зависимости от настройки ключей."
        badge={<Pill ok label={`Now: ${i.app.active_payment_provider}`} />}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            ['auto', 'Auto', 'Smart-pick'],
            ['stripe', 'Stripe', i.stripe.configured ? 'Ready' : 'No keys'],
            ['wayforpay', 'WayForPay', i.wayforpay.configured ? 'Ready' : 'No keys'],
            ['mock', 'Mock', 'Dev only'],
          ].map(([v, l, s]) => (
            <button
              key={v}
              onClick={() => setAppForm({ active_payment_provider: v })}
              data-testid={`provider-${v}-btn`}
              className={`rounded-lg border px-3 py-3 text-left ${appForm.active_payment_provider === v ? 'border-signal bg-signal/30' : 'border-border bg-muted hover:bg-muted/60'}`}
            >
              <div className="text-sm font-medium">{l}</div>
              <div className="text-[11px] text-muted-foreground">{s}</div>
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <SaveBtn onClick={() => save('app', appForm, 'Active provider')} busy={busy} testid="provider-save-btn" />
        </div>
      </Section>

      {/* ===================================================== 2. Pricing & Currencies */}
      <Section
        icon={DollarSign}
        title="Pricing · Currencies · Limits · Tax"
        desc="Кросс-провайдерные правила. Default валюта, разрешённый набор, минимум/максимум сумм, налог и платформенная комиссия."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Default currency">
            <Select value={paymentsForm.default_currency} onChange={(v) => setPaymentsForm({ ...paymentsForm, default_currency: v })} options={ALL_CURRENCIES} testid="default-currency" />
          </Field>
          <Field label="Locale (Stripe Checkout language)">
            <Select value={paymentsForm.locale} onChange={(v) => setPaymentsForm({ ...paymentsForm, locale: v })} options={LOCALES} testid="locale" />
          </Field>
        </div>
        <Field label="Allowed currencies" hint="Клиенты не смогут платить в валютах вне списка">
          <MultiCheckbox value={paymentsForm.allowed_currencies} onChange={(v) => setPaymentsForm({ ...paymentsForm, allowed_currencies: v })} options={ALL_CURRENCIES} testid="allowed-currencies" />
        </Field>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Min amount">
            <Input type="number" value={paymentsForm.min_amount} onChange={(v) => setPaymentsForm({ ...paymentsForm, min_amount: v })} testid="min-amount" />
          </Field>
          <Field label="Max amount">
            <Input type="number" value={paymentsForm.max_amount} onChange={(v) => setPaymentsForm({ ...paymentsForm, max_amount: v })} testid="max-amount" />
          </Field>
          <Field label="Platform fee %" hint="Удерживается с каждого платежа">
            <Input type="number" value={paymentsForm.platform_fee_percent} onChange={(v) => setPaymentsForm({ ...paymentsForm, platform_fee_percent: v })} testid="platform-fee" />
          </Field>
          <Field label="Tax rate %" hint="Применяется когда automatic_tax выкл.">
            <Input type="number" value={paymentsForm.tax_rate_percent} onChange={(v) => setPaymentsForm({ ...paymentsForm, tax_rate_percent: v })} testid="tax-rate" />
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Tax behavior">
            <Select value={paymentsForm.tax_behavior} onChange={(v) => setPaymentsForm({ ...paymentsForm, tax_behavior: v })} options={[['inclusive', 'Inclusive'], ['exclusive', 'Exclusive'], ['unspecified', 'Unspecified']]} testid="tax-behavior" />
          </Field>
          <Field label="Statement descriptor" hint="Появляется на выписке клиента (макс 22 симв)">
            <Input value={paymentsForm.statement_descriptor} onChange={(v) => setPaymentsForm({ ...paymentsForm, statement_descriptor: v })} testid="stmt-desc" />
          </Field>
          <Field label="Refund window (days)" hint="Сколько дней доступен авторефанд">
            <Input type="number" value={paymentsForm.refund_window_days} onChange={(v) => setPaymentsForm({ ...paymentsForm, refund_window_days: v })} testid="refund-window" />
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          <Toggle value={paymentsForm.allow_promotion_codes} onChange={(v) => setPaymentsForm({ ...paymentsForm, allow_promotion_codes: v })} label="Разрешить промо-коды на checkout" testid="promo-toggle" />
          <Toggle value={paymentsForm.automatic_tax} onChange={(v) => setPaymentsForm({ ...paymentsForm, automatic_tax: v })} label="Stripe Automatic Tax (требует Stripe Tax)" testid="auto-tax-toggle" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          <Field label="Success URL path" hint="{CHECKOUT_SESSION_ID} будет подставлен">
            <Input value={paymentsForm.success_path} onChange={(v) => setPaymentsForm({ ...paymentsForm, success_path: v })} testid="success-path" />
          </Field>
          <Field label="Cancel URL path">
            <Input value={paymentsForm.cancel_path} onChange={(v) => setPaymentsForm({ ...paymentsForm, cancel_path: v })} testid="cancel-path" />
          </Field>
        </div>
        <div className="flex justify-end">
          <SaveBtn onClick={() => save('payments', paymentsForm, 'Pricing rules')} busy={busy} testid="payments-save-btn" />
        </div>
      </Section>

      {/* ===================================================== 3. Stripe deep config */}
      <Section
        icon={CreditCard}
        title="Stripe · Checkout Configuration"
        desc="Все параметры Stripe Checkout Session — методы оплаты, режим, capture, billing/phone collection, кастомер."
        badge={<Pill ok={i.stripe.configured} label={i.stripe.configured ? `Secret: ${i.stripe.secret_key_masked}` : 'No secret'} />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Publishable key (PUBLIC)">
            <Input value={stripeForm.publishable_key} onChange={(v) => setStripeForm({ ...stripeForm, publishable_key: v })} placeholder="pk_test_…" testid="stripe-pk" />
          </Field>
          <Field label="Secret key">
            <Secret value={stripeForm.secret_key} onChange={(v) => setStripeForm({ ...stripeForm, secret_key: v })} placeholder={i.stripe.configured ? '•••• (leave to keep)' : 'sk_test_…'} testid="stripe-sk" />
          </Field>
          <Field label="Restricted key">
            <Secret value={stripeForm.restricted_key} onChange={(v) => setStripeForm({ ...stripeForm, restricted_key: v })} placeholder={i.stripe.restricted_key_masked || 'rk_test_…'} testid="stripe-rk" />
          </Field>
          <Field label="Webhook signing secret" hint="Из dashboard → Webhooks → endpoint /api/webhook/stripe">
            <Secret value={stripeForm.webhook_secret} onChange={(v) => setStripeForm({ ...stripeForm, webhook_secret: v })} placeholder={i.stripe.webhook_secret_masked || 'whsec_…'} testid="stripe-whsec" />
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Currency (Stripe-default)">
            <Select value={stripeForm.currency} onChange={(v) => setStripeForm({ ...stripeForm, currency: v })} options={ALL_CURRENCIES} testid="stripe-currency" />
          </Field>
          <Field label="Mode" hint="payment = разовый, subscription = повторяющийся">
            <Select value={stripeForm.mode} onChange={(v) => setStripeForm({ ...stripeForm, mode: v })} options={[['payment', 'payment (one-off)'], ['subscription', 'subscription (recurring)']]} testid="stripe-mode" />
          </Field>
          <Field label="Capture method" hint="manual = захолдить и захватить руками">
            <Select value={stripeForm.capture_method} onChange={(v) => setStripeForm({ ...stripeForm, capture_method: v })} options={[['automatic', 'automatic'], ['manual', 'manual']]} testid="stripe-capture" />
          </Field>
        </div>
        <Field label="Allowed payment methods" hint="Клиенту покажутся только активные. Apple/Google Pay включаются автоматически если выбран Card.">
          <MultiCheckbox value={stripeForm.payment_method_types} onChange={(v) => setStripeForm({ ...stripeForm, payment_method_types: v })} options={STRIPE_PAYMENT_METHODS} testid="stripe-methods" />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Billing address collection">
            <Select value={stripeForm.billing_address_collection} onChange={(v) => setStripeForm({ ...stripeForm, billing_address_collection: v })} options={[['auto', 'auto'], ['required', 'required']]} testid="stripe-billing" />
          </Field>
          <Field label="Customer creation">
            <Select value={stripeForm.customer_creation} onChange={(v) => setStripeForm({ ...stripeForm, customer_creation: v })} options={[['if_required', 'if_required'], ['always', 'always']]} testid="stripe-customer" />
          </Field>
          <Field label="Submit type (only mode=payment)">
            <Select value={stripeForm.submit_type} onChange={(v) => setStripeForm({ ...stripeForm, submit_type: v })} options={[['auto', 'auto'], ['pay', 'pay'], ['book', 'book'], ['donate', 'donate']]} testid="stripe-submit" />
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          <Toggle value={stripeForm.phone_number_collection} onChange={(v) => setStripeForm({ ...stripeForm, phone_number_collection: v })} label="Phone number collection" testid="stripe-phone" />
          <Toggle value={stripeForm.save_payment_method} onChange={(v) => setStripeForm({ ...stripeForm, save_payment_method: v })} label="Save payment method on file" testid="stripe-save-pm" />
        </div>
        <div className="flex justify-end">
          <SaveBtn onClick={() => save('stripe', stripeForm, 'Stripe config')} busy={busy} testid="stripe-save-btn" />
        </div>
      </Section>

      {/* ===================================================== 4. WayForPay deep config */}
      <Section
        icon={CreditCard}
        title="WayForPay · UA Payment Gateway"
        desc="Украинский шлюз. Поддерживает Apple/Google Pay, Privat24, MasterPass, QR."
        badge={<Pill ok={i.wayforpay.configured} label={i.wayforpay.configured ? `Merchant: ${i.wayforpay.merchant_account}` : 'No keys'} />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Merchant account (login)">
            <Input value={wfpForm.merchant_account} onChange={(v) => setWfpForm({ ...wfpForm, merchant_account: v })} testid="wfp-merch" />
          </Field>
          <Field label="Domain">
            <Input value={wfpForm.domain} onChange={(v) => setWfpForm({ ...wfpForm, domain: v })} testid="wfp-domain" />
          </Field>
          <Field label="Secret key">
            <Secret value={wfpForm.secret_key} onChange={(v) => setWfpForm({ ...wfpForm, secret_key: v })} placeholder={i.wayforpay.configured ? '•••• (leave to keep)' : '32-hex'} testid="wfp-sk" />
          </Field>
          <Field label="Merchant password">
            <Secret value={wfpForm.merchant_password} onChange={(v) => setWfpForm({ ...wfpForm, merchant_password: v })} placeholder={i.wayforpay.merchant_password_masked || '32-hex'} testid="wfp-pw" />
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Currency">
            <Select value={wfpForm.currency} onChange={(v) => setWfpForm({ ...wfpForm, currency: v })} options={[['UAH', 'UAH'], ['USD', 'USD'], ['EUR', 'EUR']]} testid="wfp-cur" />
          </Field>
          <Field label="Language">
            <Select value={wfpForm.language} onChange={(v) => setWfpForm({ ...wfpForm, language: v })} options={[['AUTO', 'Auto'], ['UA', 'UA'], ['EN', 'EN'], ['RU', 'RU']]} testid="wfp-lang" />
          </Field>
          <Field label="Order lifetime (sec)">
            <Input type="number" value={wfpForm.order_lifetime} onChange={(v) => setWfpForm({ ...wfpForm, order_lifetime: v })} testid="wfp-life" />
          </Field>
        </div>
        <Field label="Payment systems shown to client">
          <MultiCheckbox value={wfpForm.payment_systems} onChange={(v) => setWfpForm({ ...wfpForm, payment_systems: v })} options={WFP_PAYMENT_SYSTEMS.map((s) => [s, s])} testid="wfp-methods" />
        </Field>
        <div className="flex justify-end">
          <SaveBtn onClick={() => save('wayforpay', wfpForm, 'WayForPay config')} busy={busy} testid="wfp-save-btn" />
        </div>
      </Section>

      {/* ===================================================== 5. Live test checkout */}
      <Section
        icon={Zap}
        title="Live Test Checkout"
        desc="Создаст реальную Checkout Session текущим конфигом и вернёт ссылку. Тестовая карта Stripe: 4242 4242 4242 4242, любой CVC, любая будущая дата."
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label="Provider">
            <Select value={testForm.provider} onChange={(v) => setTestForm({ ...testForm, provider: v })} options={[['stripe', 'Stripe'], ['wayforpay', 'WayForPay']]} testid="test-provider" />
          </Field>
          <Field label="Amount">
            <Input type="number" value={testForm.amount} onChange={(v) => setTestForm({ ...testForm, amount: v })} testid="test-amount" />
          </Field>
          <Field label="Currency">
            <Select value={testForm.currency} onChange={(v) => setTestForm({ ...testForm, currency: v })} options={ALL_CURRENCIES} testid="test-currency" />
          </Field>
          <Field label="Description">
            <Input value={testForm.description} onChange={(v) => setTestForm({ ...testForm, description: v })} testid="test-desc" />
          </Field>
        </div>
        <div className="flex justify-between items-center">
          <button
            onClick={runLiveTest}
            disabled={testResult?.loading}
            data-testid="run-live-test-btn"
            className="inline-flex items-center gap-2 rounded-lg bg-signal hover:bg-signal disabled:opacity-40 px-4 py-2 text-sm font-medium text-white"
          >
            {testResult?.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />} Create real checkout session
          </button>
          {testResult?.ok && testResult?.url && (
            <a href={testResult.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-emerald-300 hover:text-emerald-200 text-sm" data-testid="open-checkout-link">
              <ExternalLink className="w-4 h-4" /> Open checkout ({testResult.session_id?.slice(0, 16) || testResult.order_id}…)
            </a>
          )}
        </div>
        {testResult && !testResult.loading && !testResult.ok && (
          <div className="text-xs px-3 py-2 rounded bg-red-900/30 text-red-200">{testResult.error}</div>
        )}
        {testResult?.ok && (
          <pre className="text-[11px] bg-muted/30 border border-border rounded p-3 overflow-x-auto">{JSON.stringify(testResult, null, 2)}</pre>
        )}
      </Section>

      {/* ===================================================== 6. Recent transactions */}
      <Section
        icon={Receipt}
        title="Recent Transactions"
        desc="Последние 20 платежей из payment_transactions (включая webhooks)."
      >
        {txs.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">Нет транзакций. Запусти live-test выше — появится здесь.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b border-border">
                <tr><th className="text-left py-2">When</th><th className="text-left">Provider</th><th className="text-left">Session</th><th className="text-left">Invoice</th><th className="text-right">Amount</th><th className="text-left">Status</th></tr>
              </thead>
              <tbody>
                {txs.map((t) => (
                  <tr key={t.session_id || t._id} className="border-b border-border/50">
                    <td className="py-2">{(t.created_at || '').slice(0, 19).replace('T', ' ')}</td>
                    <td>{t.provider}</td>
                    <td className="font-mono">{(t.session_id || '').slice(0, 22)}…</td>
                    <td className="font-mono">{t.invoice_id || '—'}</td>
                    <td className="text-right">{t.amount_total != null ? (t.amount_total / 100).toFixed(2) : '—'} {(t.currency || '').toUpperCase()}</td>
                    <td><span className={t.payment_status === 'paid' ? 'text-emerald-400' : 'text-amber-400'}>{t.payment_status || t.status || '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
