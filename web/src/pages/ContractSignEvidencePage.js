/**
 * Evidence-based contract signing (web).
 *
 * 5-step flow backed by /api/contracts/*, mirrors the mobile screen.
 *   1. Legal details  →  2. Preview  →  3. Acknowledgements
 *   4. OTP            →  5. Signed (continue to payment)
 *
 * Route: /client/sign-agreement/:contractId
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { ArrowLeft, ArrowRight, CheckCircle2, ShieldCheck, Mail, FileText } from 'lucide-react';
import { API } from '@/App';

const EMPTY_PROFILE = {
  full_name: '',
  tax_id: '',
  registered_address: '',
  country: '',
  phone: '',
};
const EMPTY_ACKS = {
  legal_details_correct: false,
  scope_terms_agreed: false,
  start_after_payment_understood: false,
};

export default function ContractSignEvidencePage() {
  const { contractId } = useParams();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);
  const [contract, setContract] = useState(null);
  const [html, setHtml] = useState('');
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [acks, setAcks] = useState(EMPTY_ACKS);
  const [otpMeta, setOtpMeta] = useState(null);
  const [otpCode, setOtpCode] = useState('');

  const load = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([
        axios.get(`${API}/contracts/${contractId}`, { withCredentials: true }),
        axios.get(`${API}/legal/profile`, { withCredentials: true }),
      ]);
      setContract(c.data.contract);
      setHtml(c.data.html || '');
      const existing = p.data?.profile;
      if (existing) {
        setProfile({
          full_name: existing.full_name || '',
          tax_id: existing.tax_id || '',
          registered_address: existing.registered_address || '',
          country: existing.country || '',
          phone: existing.phone || '',
        });
      }
      if (c.data.is_signed) setStep(5);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Could not load contract');
    } finally {
      setLoading(false);
    }
  }, [contractId]);

  useEffect(() => { load(); }, [load]);

  const profileValid =
    profile.full_name.trim().length >= 2 &&
    profile.tax_id.trim().length >= 3 &&
    profile.registered_address.trim().length >= 3 &&
    profile.country.trim().length >= 2;

  const allAcked = acks.legal_details_correct && acks.scope_terms_agreed && acks.start_after_payment_understood;

  const sendOtp = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      const r = await axios.post(
        `${API}/contracts/${contractId}/sign/request-otp`,
        { legal_profile: profile },
        { withCredentials: true },
      );
      setOtpMeta(r.data.otp || {});
      setStep(4);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Could not send code');
    } finally {
      setSubmitting(false);
    }
  };

  const confirm = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      const r = await axios.post(
        `${API}/contracts/${contractId}/sign/confirm`,
        {
          legal_profile: profile,
          acknowledgements: acks,
          otp_code: otpCode.trim(),
          terms_version: 'v1.0',
        },
        { withCredentials: true },
      );
      setContract(r.data.contract);
      setStep(5);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Could not confirm');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
          data-testid="contract-sign-back"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <StepHeader step={step} />

        {err && (
          <div className="mb-4 p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-sm text-red-400" data-testid="contract-sign-error">
            {err}
          </div>
        )}

        {step === 1 && (
          <Step1 profile={profile} setProfile={setProfile} valid={profileValid} onNext={() => setStep(2)} />
        )}
        {step === 2 && (
          <Step2 contract={contract} html={html} onBack={() => setStep(1)} onNext={() => setStep(3)} />
        )}
        {step === 3 && (
          <Step3
            acks={acks}
            setAcks={setAcks}
            allAcked={allAcked}
            submitting={submitting}
            onBack={() => setStep(2)}
            onNext={sendOtp}
          />
        )}
        {step === 4 && (
          <Step4
            otpCode={otpCode}
            setOtpCode={setOtpCode}
            otpMeta={otpMeta}
            submitting={submitting}
            onBack={() => setStep(3)}
            onConfirm={confirm}
            onResend={sendOtp}
          />
        )}
        {step === 5 && <Step5 contract={contract} onPay={() => {
          const pid = contract?.project_id;
          navigate(pid ? `/client/project/${pid}` : '/client/dashboard');
        }} onDocs={() => navigate('/client/documents')} />}
      </div>
    </div>
  );
}

/* ---------- Steps ---------- */
function StepHeader({ step }) {
  const items = ['Details', 'Preview', 'Confirm', 'Verify', 'Signed'];
  return (
    <div className="flex items-center justify-between mb-8 gap-2">
      {items.map((label, i) => {
        const n = i + 1;
        const active = step === n;
        const done = step > n;
        return (
          <div key={label} className="flex-1 flex flex-col items-center relative">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-extrabold border ${
                active || done
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-muted-foreground border-border'
              }`}
            >
              {done ? <CheckCircle2 className="w-4 h-4" /> : n}
            </div>
            <div className={`mt-1 text-[10px] font-semibold ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
              {label}
            </div>
            {i < items.length - 1 && (
              <div className="absolute top-3 left-[60%] right-[-40%] h-px bg-border" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Step1({ profile, setProfile, valid, onNext }) {
  const set = (k) => (e) => setProfile({ ...profile, [k]: e.target.value });
  return (
    <div>
      <h1 className="text-2xl font-extrabold mb-2">Legal details</h1>
      <p className="text-sm text-muted-foreground mb-6">
        We only ask for this at the moment of signing your first agreement.
      </p>
      <div className="grid grid-cols-1 gap-4">
        <Field label="Full name" value={profile.full_name} onChange={set('full_name')} testId="legal-full-name" />
        <Field label="Tax ID / РНОКПП / ЄДРПОУ" value={profile.tax_id} onChange={set('tax_id')} testId="legal-tax-id" />
        <Field label="Registered address" value={profile.registered_address} onChange={set('registered_address')} testId="legal-address" multiline />
        <Field label="Country" value={profile.country} onChange={set('country')} testId="legal-country" />
        <Field label="Phone (optional)" value={profile.phone} onChange={set('phone')} testId="legal-phone" />
      </div>
      <div className="mt-6 flex justify-end">
        <button
          onClick={onNext}
          disabled={!valid}
          data-testid="legal-next"
          className="inline-flex items-center gap-2 px-5 py-3 bg-primary text-primary-foreground rounded-lg font-bold disabled:opacity-40"
        >
          Continue <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, testId, multiline }) {
  const Cmp = multiline ? 'textarea' : 'input';
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      <Cmp
        value={value}
        onChange={onChange}
        data-testid={testId}
        className="mt-1 w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
        rows={multiline ? 2 : undefined}
      />
    </label>
  );
}

function Step2({ contract, html, onBack, onNext }) {
  return (
    <div>
      <h1 className="text-2xl font-extrabold mb-2">Review agreement</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Project: <span className="font-extrabold text-foreground">{contract?.project_title || '—'}</span>{'  ·  '}
        Price: <span className="font-extrabold text-foreground">{contract?.price || '—'}</span>
      </p>
      <div
        className="prose prose-sm max-w-none bg-card border border-border rounded-xl p-6 mb-6 contract-html"
        data-testid="contract-preview-html"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div className="flex justify-between">
        <button onClick={onBack} className="px-4 py-2.5 rounded-lg border border-border bg-card text-sm font-bold inline-flex items-center gap-2" data-testid="preview-back">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button onClick={onNext} className="px-5 py-3 rounded-lg bg-primary text-primary-foreground text-sm font-bold inline-flex items-center gap-2" data-testid="preview-next">
          Continue <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function Step3({ acks, setAcks, allAcked, submitting, onBack, onNext }) {
  const toggle = (k) => () => setAcks({ ...acks, [k]: !acks[k] });
  const items = [
    { k: 'legal_details_correct', label: 'I confirm my legal details are correct.' },
    { k: 'scope_terms_agreed', label: 'I agree to the project scope, payment schedule and terms.' },
    { k: 'start_after_payment_understood', label: 'I understand development starts after initial payment.' },
  ];
  return (
    <div>
      <h1 className="text-2xl font-extrabold mb-2">Confirm & sign</h1>
      <p className="text-sm text-muted-foreground mb-4">All three confirmations are required.</p>
      <div className="space-y-3 mb-6">
        {items.map((it) => (
          <button
            key={it.k}
            onClick={toggle(it.k)}
            data-testid={`ack-${it.k}`}
            className={`w-full text-left flex items-start gap-3 p-4 rounded-lg border ${
              acks[it.k]
                ? 'bg-primary/5 border-primary/40'
                : 'bg-card border-border hover:border-border/80'
            }`}
          >
            <div className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center border ${
              acks[it.k] ? 'bg-primary border-primary' : 'bg-card border-border'
            }`}>
              {acks[it.k] && <CheckCircle2 className="w-4 h-4 text-primary-foreground" />}
            </div>
            <span className="text-sm text-foreground">{it.label}</span>
          </button>
        ))}
      </div>
      <div className="flex justify-between">
        <button onClick={onBack} className="px-4 py-2.5 rounded-lg border border-border bg-card text-sm font-bold inline-flex items-center gap-2" data-testid="acks-back">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={onNext}
          disabled={!allAcked || submitting}
          data-testid="acks-send-otp"
          className="px-5 py-3 rounded-lg bg-primary text-primary-foreground text-sm font-bold inline-flex items-center gap-2 disabled:opacity-40"
        >
          <Mail className="w-4 h-4" />
          {submitting ? 'Sending…' : 'Send verification code'}
        </button>
      </div>
    </div>
  );
}

function Step4({ otpCode, setOtpCode, otpMeta, submitting, onBack, onConfirm, onResend }) {
  return (
    <div>
      <h1 className="text-2xl font-extrabold mb-2">Verify it's you</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Enter the 6-digit code we sent to your email to confirm your signature.
      </p>
      {otpMeta?.dev_code && (
        <div className="mb-4 p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 text-yellow-500 text-sm">
          DEV code: <span className="font-extrabold tracking-widest">{otpMeta.dev_code}</span>
          <div className="text-xs text-muted-foreground mt-1">
            Shown because the email provider isn't configured on this environment.
          </div>
        </div>
      )}
      <input
        value={otpCode}
        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric"
        maxLength={6}
        placeholder="• • • • • •"
        data-testid="otp-input"
        className="w-full bg-card border border-border rounded-xl px-4 py-5 text-3xl font-bold text-center tracking-[0.5em] mb-3 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
      />
      <div className="flex justify-center mb-6">
        <button onClick={onResend} disabled={submitting} className="text-xs text-primary font-bold hover:underline" data-testid="otp-resend">
          Resend code
        </button>
      </div>
      <div className="flex justify-between">
        <button onClick={onBack} className="px-4 py-2.5 rounded-lg border border-border bg-card text-sm font-bold inline-flex items-center gap-2" data-testid="otp-back">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={onConfirm}
          disabled={otpCode.length < 4 || submitting}
          data-testid="otp-confirm"
          className="px-5 py-3 rounded-lg bg-primary text-primary-foreground text-sm font-bold inline-flex items-center gap-2 disabled:opacity-40"
        >
          <ShieldCheck className="w-4 h-4" />
          {submitting ? 'Signing…' : 'Sign agreement & continue'}
        </button>
      </div>
    </div>
  );
}

function Step5({ contract, onPay, onDocs }) {
  return (
    <div data-testid="contract-signed">
      <div className="bg-card border border-border rounded-2xl p-8 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <CheckCircle2 className="w-10 h-10 text-primary" />
          <div>
            <h1 className="text-2xl font-extrabold">Agreement signed</h1>
            <p className="text-sm text-muted-foreground">Next step: continue to payment.</p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-y-2 gap-x-6 text-sm mt-4">
          <dt className="text-muted-foreground">Project</dt>
          <dd className="text-foreground font-bold text-right">{contract?.project_title || '—'}</dd>
          <dt className="text-muted-foreground">Amount</dt>
          <dd className="text-foreground font-bold text-right">{contract?.price || '—'}</dd>
          <dt className="text-muted-foreground">Signed at</dt>
          <dd className="text-foreground font-bold text-right">
            {(contract?.signed_at || '').slice(0, 19).replace('T', ' ')}
          </dd>
          <dt className="text-muted-foreground">Evidence hash</dt>
          <dd className="text-foreground font-mono text-xs text-right truncate">
            {(contract?.sha256_hash || '').slice(0, 20)}…
          </dd>
        </dl>
      </div>
      <div className="flex gap-3">
        <button onClick={onPay} data-testid="continue-to-payment"
                className="flex-1 px-5 py-3 rounded-lg bg-primary text-primary-foreground text-sm font-bold inline-flex items-center justify-center gap-2">
          Continue to payment <ArrowRight className="w-4 h-4" />
        </button>
        <button onClick={onDocs} data-testid="view-in-documents"
                className="px-5 py-3 rounded-lg border border-border bg-card text-sm font-bold inline-flex items-center gap-2">
          <FileText className="w-4 h-4" />
          View in Documents
        </button>
      </div>
    </div>
  );
}
