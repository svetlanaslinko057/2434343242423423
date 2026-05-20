import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Linking,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../src/api';
import T from '../src/theme';

/**
 * Documents — replaces the old "Coming soon" placeholder.
 *
 * Shows signed agreements with:
 *   - Project / amount / signed_at
 *   - Evidence hash (first 16 chars, monospace)
 *   - Download PDF (if pdf_status=='generated')
 *     or View HTML (fallback using html_snapshot endpoint)
 *   - Evidence → navigates to audit trail view (inline details)
 *
 * Backend endpoints used:
 *   GET  /api/contracts/my
 *   GET  /api/contracts/:id/html          (HTMLResponse for viewing)
 *   GET  /api/contracts/:id/evidence      (audit trail JSON)
 *   GET  /api/client/invoices             (Stage 2 — wired May 2026)
 *
 * Stage 2 honesty note (May 9, 2026): the "Project snapshots" section was
 * intentionally REMOVED. Signed agreements already serve as the canonical
 * project snapshot (immutable, hashed, evidence-chained). Adding a parallel
 * "snapshots" section would be a fake-state UI lie — there is no second
 * snapshot artefact in the system. If the product later introduces a
 * separate snapshot type (e.g. delivery archives), wire it explicitly.
 */

type ContractItem = {
  contract_id: string;
  project_id?: string | null;
  project_title?: string;
  price?: string;
  state: string;
  signed_at?: string | null;
  created_at: string;
  sha256_hash?: string | null;
  pdf_status?: string;
};

type InvoiceItem = {
  invoice_id: string;
  project_id?: string;
  project_title?: string;
  amount: number;
  status: string;            // 'pending' | 'paid' | 'overdue' | etc
  created_at?: string;
  paid_at?: string | null;
  number?: string;
};

const BACKEND = (process.env.EXPO_PUBLIC_BACKEND_URL as string) || '';

export default function DocumentsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<ContractItem[]>([]);
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Record<string, any>>({});

  const load = useCallback(async () => {
    try {
      // Parallel fetch — contracts + invoices. Failure of one doesn't kill the
      // other (Stage 2 honesty: empty-state per-section, not whole-screen-error).
      const [contractsRes, invoicesRes] = await Promise.allSettled([
        api.get('/contracts/my'),
        api.get('/client/invoices'),
      ]);
      if (contractsRes.status === 'fulfilled') {
        setItems(contractsRes.value.data?.items || []);
      }
      if (invoicesRes.status === 'fulfilled') {
        const raw = invoicesRes.value.data;
        const arr: InvoiceItem[] = Array.isArray(raw)
          ? raw
          : (raw?.invoices || raw?.items || []);
        setInvoices(arr);
      }
      setErr(null);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Could not load documents');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  const loadEvidence = async (contractId: string) => {
    if (evidence[contractId]) return;
    try {
      const r = await api.get(`/contracts/${contractId}/evidence`);
      setEvidence((e) => ({ ...e, [contractId]: r.data }));
    } catch (e) {
      setEvidence((ev) => ({ ...ev, [contractId]: { error: true } }));
    }
  };

  const openHtml = async (contractId: string) => {
    const url = `${BACKEND}/api/contracts/${contractId}/html`;
    try {
      await Linking.openURL(url);
    } catch {
      // silent
    }
  };

  const signed = items.filter((i) => i.state === 'signed');
  const pending = items.filter((i) => i.state !== 'signed');
  const paidInvoices = invoices.filter((i) => i.status === 'paid');
  const openInvoices = invoices.filter((i) => i.status !== 'paid');

  if (loading) {
    return <View style={s.center}><ActivityIndicator size="large" color={T.primary} /></View>;
  }

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.primary} />}
      testID="documents-screen"
    >
      <View style={s.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} testID="documents-back">
          <Ionicons name="arrow-back" size={20} color={T.text} />
        </TouchableOpacity>
        <Text style={s.h1}>Documents</Text>
      </View>
      <Text style={s.lede}>Signed agreements, invoices and payment confirmations.</Text>

      {err ? <Text style={s.errorText}>{err}</Text> : null}

      {/* Signed agreements */}
      <Section title="Signed agreements" count={signed.length}>
        {signed.length === 0 ? (
          <EmptyCard icon="document-text-outline" text="No signed agreements yet." />
        ) : (
          signed.map((c) => (
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
              onOpenHtml={() => openHtml(c.contract_id)}
            />
          ))
        )}
      </Section>

      {pending.length > 0 && (
        <Section title="In progress" count={pending.length}>
          {pending.map((c) => (
            <View key={c.contract_id} style={s.pendingCard}>
              <Ionicons name="hourglass" size={18} color={T.warning} />
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>{c.project_title || 'Untitled project'}</Text>
                <Text style={s.cardMeta}>{stateLabel(c.state)}</Text>
              </View>
              <TouchableOpacity
                style={s.linkBtn}
                onPress={() => router.push(`/contract/${c.contract_id}/sign` as any)}
                testID={`documents-resume-${c.contract_id}`}
              >
                <Text style={s.linkBtnText}>Continue</Text>
                <Ionicons name="chevron-forward" size={14} color={T.primary} />
              </TouchableOpacity>
            </View>
          ))}
        </Section>
      )}

      {/* Invoices — wired to GET /api/client/invoices */}
      <Section title="Invoices" count={openInvoices.length}>
        {openInvoices.length === 0 ? (
          <EmptyCard icon="receipt-outline" text="No outstanding invoices." />
        ) : (
          openInvoices.map((inv) => (
            <InvoiceRow
              key={inv.invoice_id}
              inv={inv}
              onPress={() => router.push(`/client/billing` as any)}
            />
          ))
        )}
      </Section>

      {/* Payment confirmations = paid invoices (single source of truth) */}
      <Section title="Payment confirmations" count={paidInvoices.length}>
        {paidInvoices.length === 0 ? (
          <EmptyCard icon="card-outline" text="No payments yet." />
        ) : (
          paidInvoices.map((inv) => (
            <InvoiceRow
              key={inv.invoice_id}
              inv={inv}
              onPress={() => router.push(`/client/billing` as any)}
            />
          ))
        )}
      </Section>
    </ScrollView>
  );
}

/* ---------- Pieces ---------- */

function Section({ title, count, children }: { title: string; count: number; children: any }) {
  return (
    <View style={{ marginBottom: T.lg }}>
      <View style={s.sectionHead}>
        <Text style={s.sectionTitle}>{title}</Text>
        {count > 0 ? <Text style={s.sectionCount}>{count}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function EmptyCard({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={s.emptyCard}>
      <Ionicons name={icon} size={22} color={T.textMuted} />
      <Text style={s.emptyText}>{text}</Text>
    </View>
  );
}

function InvoiceRow({ inv, onPress }: { inv: InvoiceItem; onPress: () => void }) {
  const isPaid = inv.status === 'paid';
  const dateIso = (isPaid ? inv.paid_at : inv.created_at) || '';
  const date = dateIso.slice(0, 10);
  return (
    <TouchableOpacity
      style={s.invoiceRow}
      onPress={onPress}
      testID={`documents-invoice-${inv.invoice_id}`}
    >
      <Ionicons
        name={isPaid ? 'checkmark-circle' : 'receipt-outline'}
        size={18}
        color={isPaid ? T.success : T.textMuted}
      />
      <View style={{ flex: 1 }}>
        <Text style={s.cardTitle}>
          {inv.number || inv.invoice_id.slice(0, 8)} · ${inv.amount.toLocaleString()}
        </Text>
        <Text style={s.cardMeta}>
          {(inv.project_title || 'Project')} · {date || '—'} · {inv.status}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={14} color={T.textMuted} />
    </TouchableOpacity>
  );
}

function ContractCard({
  c,
  expanded,
  evidence,
  onToggle,
  onOpenHtml,
}: {
  c: ContractItem;
  expanded: boolean;
  evidence: any;
  onToggle: () => void;
  onOpenHtml: () => void;
}) {
  const pdfAvailable = c.pdf_status === 'generated';
  return (
    <View style={s.card} testID={`documents-card-${c.contract_id}`}>
      <View style={s.cardTop}>
        <View style={s.signedBadge}>
          <Ionicons name="checkmark-circle" size={12} color={T.primaryInk} />
          <Text style={s.signedBadgeText}>Signed</Text>
        </View>
        <Text style={s.cardDate}>{(c.signed_at || '').slice(0, 10)}</Text>
      </View>
      <Text style={s.cardTitle}>{c.project_title || 'Untitled project'}</Text>
      <Text style={s.cardAmount}>{c.price || '—'}</Text>

      <View style={s.hashRow}>
        <Ionicons name="finger-print" size={12} color={T.textMuted} />
        <Text style={s.hashText} numberOfLines={1}>
          {(c.sha256_hash || '').slice(0, 24)}…
        </Text>
      </View>

      <View style={s.cardActions}>
        <TouchableOpacity
          style={s.cardBtn}
          onPress={onOpenHtml}
          testID={`documents-view-${c.contract_id}`}
        >
          <Ionicons name={pdfAvailable ? 'document' : 'code-slash'} size={14} color={T.text} />
          <Text style={s.cardBtnText}>{pdfAvailable ? 'Download PDF' : 'View HTML'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.cardBtn}
          onPress={onToggle}
          testID={`documents-evidence-${c.contract_id}`}
        >
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={T.text} />
          <Text style={s.cardBtnText}>{expanded ? 'Hide evidence' : 'View evidence'}</Text>
        </TouchableOpacity>
      </View>

      {expanded ? (
        <View style={s.evidenceBox} testID={`documents-evidence-body-${c.contract_id}`}>
          {!evidence ? (
            <ActivityIndicator color={T.primary} />
          ) : evidence.error ? (
            <Text style={s.evidenceErr}>Could not load evidence.</Text>
          ) : (
            <>
              <EvidenceKV k="Signed at" v={(evidence.signature?.signed_at || '').slice(0, 19).replace('T', ' ')} />
              <EvidenceKV k="IP" v={evidence.signature?.ip || '—'} />
              <EvidenceKV k="User agent" v={evidence.signature?.user_agent?.slice(0, 48) || '—'} />
              <EvidenceKV k="OTP channel" v={evidence.signature?.otp_channel || '—'} />
              <EvidenceKV k="Template" v={`${evidence.template_version} · ${evidence.terms_version}`} />
              <EvidenceKV k="Hash (sha256)" v={evidence.sha256_hash || '—'} mono />
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

function EvidenceKV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <View style={s.kvRow}>
      <Text style={s.kvK}>{k}</Text>
      <Text style={[s.kvV, mono && s.monoText]} numberOfLines={2}>{v}</Text>
    </View>
  );
}

function stateLabel(st: string): string {
  switch (st) {
    case 'draft': return 'Draft — not yet submitted';
    case 'awaiting_signature': return 'Awaiting your signature';
    default: return st;
  }
}

/* ---------- Styles ---------- */
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.md, paddingBottom: T.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: T.bg },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  backBtn: { padding: 6, marginLeft: -6 },
  h1: { color: T.text, fontSize: 24, fontWeight: '800' },
  lede: { color: T.textSecondary, fontSize: T.body, marginBottom: T.lg, lineHeight: 20 },
  errorText: { color: T.danger, marginBottom: T.md },

  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { color: T.text, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },
  sectionCount: {
    color: T.textMuted, fontSize: 11, fontWeight: '800',
    backgroundColor: T.surface2, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
  },

  emptyCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderRadius: T.radiusSm,
    backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border,
  },
  emptyText: { color: T.textMuted, fontSize: T.small, flex: 1 },

  card: {
    backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border,
    borderRadius: T.radius, padding: T.md, marginBottom: 10,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  signedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: T.primary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
  },
  signedBadgeText: { color: T.primaryInk, fontSize: 10, fontWeight: '800' },
  cardDate: { color: T.textMuted, fontSize: T.tiny },
  cardTitle: { color: T.text, fontSize: T.body, fontWeight: '800', marginBottom: 2 },
  cardAmount: { color: T.text, fontSize: T.h3, fontWeight: '800', marginBottom: 8 },
  cardMeta: { color: T.textMuted, fontSize: T.small },
  hashRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  hashText: { color: T.textMuted, fontSize: T.tiny, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  cardActions: { flexDirection: 'row', gap: 8, marginTop: 2 },
  cardBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: T.radiusSm,
    backgroundColor: T.surface2, borderWidth: 1, borderColor: T.border, flex: 1, justifyContent: 'center',
  },
  cardBtnText: { color: T.text, fontSize: T.small, fontWeight: '700' },

  evidenceBox: {
    marginTop: 10, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: T.border,
  },
  evidenceErr: { color: T.danger, fontSize: T.small },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 4 },
  kvK: { color: T.textMuted, fontSize: T.tiny, flexShrink: 0 },
  kvV: { color: T.text, fontSize: T.tiny, flex: 1, textAlign: 'right' },
  monoText: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  pendingCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: T.radiusSm,
    backgroundColor: T.surface1, borderWidth: 1, borderColor: T.warningBorder, marginBottom: 8,
  },
  invoiceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: T.radiusSm,
    backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border, marginBottom: 8,
  },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6 },
  linkBtnText: { color: T.primary, fontSize: T.small, fontWeight: '800' },
});
