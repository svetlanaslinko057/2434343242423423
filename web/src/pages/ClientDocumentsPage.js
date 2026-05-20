/**
 * Documents page (web) — signed agreements, invoices, payment confirmations,
 * project snapshots. Replaces the "Coming soon" placeholder.
 *
 * Route: /client/documents
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import { FileText, CheckCircle2, Fingerprint, Download, ChevronDown, ChevronUp, Hourglass, Receipt, CreditCard, Package } from 'lucide-react';
import { API } from '@/App';

export default function ClientDocumentsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [err, setErr] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [evidence, setEvidence] = useState({});

  const load = useCallback(async () => {
    try {
      const r = await runtime.get(`/api/contracts/my`);
      setItems(r.data?.items || []);
      setErr(null);
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Could not load documents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadEvidence = async (id) => {
    if (evidence[id]) return;
    try {
      const r = await runtime.get(`/api/contracts/${id}/evidence`);
      setEvidence((e) => ({ ...e, [id]: r.data }));
    } catch (e) {
      setEvidence((ev) => ({ ...ev, [id]: { error: true } }));
    }
  };

  const signed = items.filter((i) => i.state === 'signed');
  const pending = items.filter((i) => i.state !== 'signed');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-10" data-testid="documents-page">
      <h1 className="text-3xl font-extrabold mb-2">Documents</h1>
      <p className="text-muted-foreground mb-8">
        Signed agreements, invoices, payment confirmations and project snapshots.
      </p>

      {err && (
        <div className="mb-6 p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-sm text-red-400">{err}</div>
      )}

      <Section title="Signed agreements" count={signed.length}>
        {signed.length === 0 ? (
          <EmptyCard icon={<FileText className="w-5 h-5 text-muted-foreground" />} text="No signed agreements yet." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {signed.map((c) => (
              <ContractCard
                key={c.contract_id}
                c={c}
                expanded={expanded === c.contract_id}
                evidence={evidence[c.contract_id]}
                onToggle={() => {
                  const next = expanded === c.contract_id ? null : c.contract_id;
                  setExpanded(next);
                  if (next) loadEvidence(c.contract_id);
                }}
              />
            ))}
          </div>
        )}
      </Section>

      {pending.length > 0 && (
        <Section title="In progress" count={pending.length}>
          <div className="space-y-3">
            {pending.map((c) => (
              <div key={c.contract_id}
                   className="flex items-center gap-3 p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5">
                <Hourglass className="w-5 h-5 text-yellow-500" />
                <div className="flex-1">
                  <div className="font-bold text-foreground">{c.project_title || 'Untitled project'}</div>
                  <div className="text-xs text-muted-foreground">{stateLabel(c.state)}</div>
                </div>
                <button
                  onClick={() => navigate(`/client/sign-agreement/${c.contract_id}`)}
                  className="text-sm text-primary font-bold"
                  data-testid={`resume-${c.contract_id}`}
                >
                  Continue →
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Invoices" count={0}>
        <EmptyCard icon={<Receipt className="w-5 h-5 text-muted-foreground" />} text="Invoices will appear here after your first payment." />
      </Section>
      <Section title="Payment confirmations" count={0}>
        <EmptyCard icon={<CreditCard className="w-5 h-5 text-muted-foreground" />} text="No payment confirmations yet." />
      </Section>
      <Section title="Project snapshots" count={0}>
        <EmptyCard icon={<Cube className="w-5 h-5 text-muted-foreground" />} text="Snapshots are created when a contract is signed." />
      </Section>
    </div>
  );
}

function Section({ title, count, children }) {
  return (
    <section className="mb-10">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-xs font-extrabold uppercase tracking-wider text-foreground">{title}</h2>
        {count > 0 && (
          <span className="text-[11px] font-extrabold text-muted-foreground bg-card border border-border px-2 py-0.5 rounded-full">{count}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function EmptyCard({ icon, text }) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-lg bg-card border border-border">
      {icon}
      <span className="text-sm text-muted-foreground">{text}</span>
    </div>
  );
}

function ContractCard({ c, expanded, evidence, onToggle }) {
  const pdfAvailable = c.pdf_status === 'generated';
  const htmlUrl = `/api/contracts/${c.contract_id}/html`;
  return (
    <div className="bg-card border border-border rounded-xl p-5" data-testid={`doc-card-${c.contract_id}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="inline-flex items-center gap-1 bg-primary text-primary-foreground text-[10px] font-extrabold px-2 py-0.5 rounded-full">
          <CheckCircle2 className="w-3 h-3" />
          Signed
        </span>
        <span className="text-[11px] text-muted-foreground">{(c.signed_at || '').slice(0, 10)}</span>
      </div>
      <div className="text-sm font-extrabold text-foreground">{c.project_title || 'Untitled project'}</div>
      <div className="text-lg font-extrabold text-foreground mt-1 mb-2">{c.price || '—'}</div>

      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono mb-3">
        <Fingerprint className="w-3 h-3" />
        <span className="truncate">{(c.sha256_hash || '').slice(0, 28)}…</span>
      </div>

      <div className="flex gap-2">
        <a
          href={htmlUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-background border border-border text-xs font-bold hover:bg-accent"
          data-testid={`doc-view-${c.contract_id}`}
        >
          <Download className="w-3.5 h-3.5" />
          {pdfAvailable ? 'Download PDF' : 'View HTML'}
        </a>
        <button
          onClick={onToggle}
          className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-background border border-border text-xs font-bold hover:bg-accent"
          data-testid={`doc-evidence-${c.contract_id}`}
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {expanded ? 'Hide evidence' : 'View evidence'}
        </button>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-border text-[11px] space-y-1" data-testid={`doc-evidence-body-${c.contract_id}`}>
          {!evidence ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="w-3 h-3 border-2 border-border border-t-primary rounded-full animate-spin" />
              Loading…
            </div>
          ) : evidence.error ? (
            <div className="text-red-400">Could not load evidence.</div>
          ) : (
            <>
              <KV k="Signed at" v={(evidence.signature?.signed_at || '').slice(0, 19).replace('T', ' ')} />
              <KV k="IP" v={evidence.signature?.ip || '—'} />
              <KV k="User agent" v={(evidence.signature?.user_agent || '').slice(0, 48)} />
              <KV k="OTP channel" v={evidence.signature?.otp_channel || '—'} />
              <KV k="Template" v={`${evidence.template_version} · ${evidence.terms_version}`} />
              <KV k="Hash (sha256)" v={evidence.sha256_hash || '—'} mono />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function KV({ k, v, mono }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground shrink-0">{k}</span>
      <span className={`text-foreground text-right truncate ${mono ? 'font-mono' : ''}`}>{v}</span>
    </div>
  );
}

function stateLabel(st) {
  if (st === 'draft') return 'Draft — not yet submitted';
  if (st === 'awaiting_signature') return 'Awaiting your signature';
  return st;
}
