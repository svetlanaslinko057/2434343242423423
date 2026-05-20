/**
 * AdminLeadsPage — moderation cockpit for anonymous `/api/estimate`
 * submissions (a.k.a. "leads").
 *
 * Lifecycle of a lead:
 *   new        → just submitted by a visitor (anonymous)
 *   contacted  → admin reached out (manual outreach)
 *   converted  → visitor registered + claimed it (project_id set)
 *   archived   → discarded by admin
 *
 * Backend surface (added in this iteration):
 *   GET   /api/admin/leads?status=...&limit=&skip=
 *   PATCH /api/admin/leads/{lead_id}     { status?, admin_notes? }
 *
 * Visitor-side claim (idempotent):
 *   POST  /api/leads/{lead_id}/claim     → creates project, sets status=converted
 *
 * No mocks. Real DB rows from `db.anonymous_leads`. Filter chips show counts
 * pulled from the `total` field of each filtered request so admins see queue
 * pressure at a glance.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  Inbox,
  Users,
  CheckCircle2,
  Archive,
  Phone,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Globe,
  Clock,
  DollarSign,
  Sparkles,
  Loader2,
  Filter,
} from 'lucide-react';
import { API } from '@/App';

const STATUS_TABS = [
  { key: 'all',       label: 'All',       icon: Inbox,        color: 'var(--muted-foreground)' },
  { key: 'new',       label: 'New',       icon: Sparkles,     color: 'var(--t-signal)' },
  { key: 'contacted', label: 'Contacted', icon: Phone,        color: '#3b82f6' },
  { key: 'converted', label: 'Converted', icon: CheckCircle2, color: '#10b981' },
  { key: 'archived',  label: 'Archived',  icon: Archive,      color: '#64748b' },
];

function relTime(iso) {
  if (!iso) return '';
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function fmtMoney(n) {
  if (n == null) return '—';
  return `$${Math.round(Number(n)).toLocaleString()}`;
}

const statusBadgeColor = (status) => {
  switch (status) {
    case 'new':       return { bg: 'rgba(11,143,94,0.10)', text: 'var(--t-signal)', border: 'rgba(11,143,94,0.30)' };
    case 'contacted': return { bg: 'rgba(59,130,246,0.10)', text: '#3b82f6', border: 'rgba(59,130,246,0.30)' };
    case 'converted': return { bg: 'rgba(16,185,129,0.10)', text: '#10b981', border: 'rgba(16,185,129,0.30)' };
    case 'archived':  return { bg: 'rgba(100,116,139,0.10)', text: '#64748b', border: 'rgba(100,116,139,0.30)' };
    default:          return { bg: 'transparent', text: 'var(--muted-foreground)', border: 'var(--border)' };
  }
};

export default function AdminLeadsPage() {
  const [statusFilter, setStatusFilter] = useState('new');
  const [leads, setLeads] = useState([]);
  const [counts, setCounts] = useState({ all: 0, new: 0, contacted: 0, converted: 0, archived: 0 });
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState('');
  const noteDraftRef = useRef({});

  const cfg = useMemo(() => {
    const tok = localStorage.getItem('token');
    return tok ? { headers: { Authorization: `Bearer ${tok}` }, withCredentials: true } : { withCredentials: true };
  }, []);

  const loadLeads = async () => {
    setLoading(true);
    setError('');
    try {
      const qs = statusFilter === 'all' ? '' : `?status=${statusFilter}`;
      const r = await axios.get(`${API}/admin/leads${qs}`, cfg);
      setLeads(r.data?.items || []);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to load leads');
      setLeads([]);
    } finally {
      setLoading(false);
    }
  };

  const loadCounts = async () => {
    try {
      // Cheap: 5 small queries in parallel. Each returns `{total}` w/o full items
      // pressure (limit=1).
      const keys = ['new', 'contacted', 'converted', 'archived'];
      const [all, ...rest] = await Promise.all([
        axios.get(`${API}/admin/leads?limit=1`, cfg),
        ...keys.map((k) => axios.get(`${API}/admin/leads?status=${k}&limit=1`, cfg)),
      ]);
      const next = { all: all.data?.total || 0 };
      keys.forEach((k, i) => { next[k] = rest[i].data?.total || 0; });
      setCounts(next);
    } catch {
      /* counts are non-blocking */
    }
  };

  useEffect(() => {
    loadLeads();
    loadCounts();
    const i = setInterval(() => { loadLeads(); loadCounts(); }, 12000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const patchLead = async (leadId, patch) => {
    setSavingId(leadId);
    try {
      const r = await axios.patch(`${API}/admin/leads/${leadId}`, patch, cfg);
      const updated = r.data;
      setLeads((prev) => prev.map((l) => (l.lead_id === leadId ? updated : l)));
      // Refresh counts immediately if status changed
      if (patch.status) {
        loadCounts();
      }
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Update failed');
    } finally {
      setSavingId(null);
    }
  };

  const copyLeadDetails = (lead) => {
    const lines = [
      `Lead: ${lead.lead_id}`,
      `Goal: ${lead.goal}`,
      `Final price: ${fmtMoney(lead.estimate?.final_price)}`,
      `Hours: ${lead.estimate?.estimated_hours || '—'}`,
      `Multiplier: ×${lead.estimate?.reality_multiplier?.toFixed?.(2) || '—'}`,
      `Submitted: ${lead.created_at}`,
      lead.user_agent ? `UA: ${lead.user_agent}` : null,
      lead.ip ? `IP: ${lead.ip}` : null,
    ].filter(Boolean).join('\n');
    try { navigator.clipboard.writeText(lines); } catch {}
  };

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="admin-leads-page">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase mb-1">
              Admin · Visitor leads
            </div>
            <h1 className="text-3xl font-semibold tracking-tight" data-testid="leads-title">
              Anonymous estimates
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Every visitor who completed `/describe` lives here until they sign up & claim the estimate (auto → status: converted) or you archive them.
            </p>
          </div>
          <button
            onClick={() => { loadLeads(); loadCounts(); }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-card border border-border hover:bg-muted transition-colors"
            data-testid="leads-refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-2 mb-6" data-testid="leads-filters">
          {STATUS_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = statusFilter === tab.key;
            const count = counts[tab.key] ?? 0;
            return (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full border text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-transparent text-white'
                    : 'border-border bg-card text-foreground hover:bg-muted'
                }`}
                style={isActive ? { background: tab.color } : undefined}
                data-testid={`leads-filter-${tab.key}`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
                <span
                  className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-mono rounded-full"
                  style={isActive ? { background: 'rgba(255,255,255,0.18)' } : { background: 'var(--muted)', color: 'var(--muted-foreground)' }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-600" data-testid="leads-error">
            {error}
          </div>
        )}

        {/* List */}
        {loading && leads.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading leads…
          </div>
        ) : leads.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground" data-testid="leads-empty">
            <Inbox className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <div className="font-medium text-foreground">No leads in this bucket</div>
            <div className="text-sm">When visitors hit /describe and submit an estimate, they show up here.</div>
          </div>
        ) : (
          <div className="space-y-3" data-testid="leads-list">
            {leads.map((lead) => {
              const expanded = expandedId === lead.lead_id;
              const colors = statusBadgeColor(lead.status);
              const est = lead.estimate || {};
              const modules = lead.modules_detailed || [];
              const noteValue = noteDraftRef.current[lead.lead_id] ?? (lead.admin_notes || '');
              return (
                <div
                  key={lead.lead_id}
                  className="rounded-xl bg-card border border-border overflow-hidden"
                  data-testid={`lead-card-${lead.lead_id}`}
                >
                  {/* Summary row */}
                  <button
                    onClick={() => setExpandedId(expanded ? null : lead.lead_id)}
                    className="w-full text-left px-5 py-4 flex items-start gap-4 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono uppercase tracking-wider border"
                          style={{ background: colors.bg, color: colors.text, borderColor: colors.border }}
                          data-testid={`lead-status-${lead.lead_id}`}
                        >
                          {lead.status || 'new'}
                        </span>
                        <span className="text-[11px] text-muted-foreground font-mono">{lead.lead_id}</span>
                        <span className="text-[11px] text-muted-foreground">· {relTime(lead.created_at)}</span>
                      </div>
                      <div className="text-sm text-foreground line-clamp-2" data-testid={`lead-goal-${lead.lead_id}`}>
                        {lead.goal || '(no goal)'}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1 font-mono">
                          <DollarSign className="w-3 h-3" /> {fmtMoney(est.final_price)}
                        </span>
                        <span className="inline-flex items-center gap-1 font-mono">
                          <Clock className="w-3 h-3" /> {est.estimated_hours || '—'}h
                        </span>
                        <span className="font-mono">×{est.reality_multiplier?.toFixed?.(2) || '—'}</span>
                        <span>{(modules?.length || 0)} modules</span>
                        {lead.ip && <span className="font-mono">{lead.ip}</span>}
                      </div>
                    </div>
                    <div className="shrink-0 self-center">
                      {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </div>
                  </button>

                  {/* Expanded details */}
                  {expanded && (
                    <div className="px-5 pb-5 pt-1 border-t border-border space-y-4" data-testid={`lead-detail-${lead.lead_id}`}>
                      {/* Full goal */}
                      <div>
                        <div className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase mb-1.5">Full brief</div>
                        <div className="text-sm whitespace-pre-wrap bg-muted/40 rounded-lg p-3 border border-border">{lead.goal}</div>
                      </div>

                      {/* Pricing block */}
                      <div className="grid grid-cols-3 gap-3">
                        <DetailStat label="Implementation" value={fmtMoney(est.implementation_price)} />
                        <DetailStat label="Multiplier" value={`×${est.reality_multiplier?.toFixed?.(2) || '—'}`} highlight />
                        <DetailStat label="Final price" value={fmtMoney(est.final_price)} />
                      </div>

                      {/* Modules */}
                      {modules.length > 0 && (
                        <div>
                          <div className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase mb-1.5">
                            Scope ({modules.length} modules)
                          </div>
                          <div className="space-y-1.5 max-h-60 overflow-auto pr-1">
                            {modules.map((m, i) => (
                              <div key={i} className="flex items-baseline justify-between text-sm gap-2">
                                <div className="min-w-0">
                                  <div className="font-medium truncate">{m.name || m.module_id}</div>
                                  {m.description && <div className="text-xs text-muted-foreground truncate">{m.description}</div>}
                                </div>
                                <div className="shrink-0 font-mono text-xs text-muted-foreground">{m.hours || 0}h</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Submission meta */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        <MetaCell label="Submitted" value={new Date(lead.created_at).toLocaleString()} />
                        <MetaCell label="IP"        value={lead.ip || '—'} />
                        <MetaCell label="Confidence" value={lead.confidence != null ? `${Math.round(lead.confidence * 100)}%` : '—'} />
                        <MetaCell label="Template"  value={lead.matched_template?.name || '—'} />
                      </div>
                      {lead.user_agent && (
                        <MetaCell label="User agent" value={lead.user_agent} mono />
                      )}

                      {/* Conversion */}
                      {lead.status === 'converted' && (
                        <div
                          className="p-3 rounded-lg border flex items-center gap-2 text-sm"
                          style={{ background: 'rgba(16,185,129,0.06)', borderColor: 'rgba(16,185,129,0.25)' }}
                          data-testid={`lead-converted-banner-${lead.lead_id}`}
                        >
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          Converted to project <span className="font-mono">{lead.project_id}</span> by user <span className="font-mono">{lead.converted_user_id}</span> · {relTime(lead.converted_at)}
                        </div>
                      )}

                      {/* Notes */}
                      <div>
                        <div className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase mb-1.5">Admin notes</div>
                        <textarea
                          defaultValue={lead.admin_notes || ''}
                          onChange={(e) => { noteDraftRef.current[lead.lead_id] = e.target.value; }}
                          placeholder="Outreach status, next-step plan, objections…"
                          className="w-full text-sm rounded-lg border border-border bg-background p-2.5 min-h-[72px] focus:outline-none focus:ring-2 focus:ring-[var(--t-signal)] resize-y"
                          data-testid={`lead-notes-${lead.lead_id}`}
                        />
                        <button
                          onClick={() => patchLead(lead.lead_id, { admin_notes: noteDraftRef.current[lead.lead_id] ?? lead.admin_notes ?? '' })}
                          disabled={savingId === lead.lead_id}
                          className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/70 text-xs font-medium disabled:opacity-50"
                          data-testid={`lead-save-notes-${lead.lead_id}`}
                        >
                          {savingId === lead.lead_id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                          Save notes
                        </button>
                      </div>

                      {/* Actions */}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <ActionButton
                          disabled={lead.status === 'contacted' || savingId === lead.lead_id}
                          onClick={() => patchLead(lead.lead_id, { status: 'contacted' })}
                          icon={<Phone className="w-3.5 h-3.5" />}
                          testid={`lead-action-contacted-${lead.lead_id}`}
                        >
                          Mark contacted
                        </ActionButton>
                        <ActionButton
                          disabled={lead.status === 'converted' || savingId === lead.lead_id}
                          onClick={() => patchLead(lead.lead_id, { status: 'converted' })}
                          icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                          testid={`lead-action-converted-${lead.lead_id}`}
                        >
                          Mark converted
                        </ActionButton>
                        <ActionButton
                          disabled={lead.status === 'archived' || savingId === lead.lead_id}
                          onClick={() => patchLead(lead.lead_id, { status: 'archived' })}
                          icon={<Archive className="w-3.5 h-3.5" />}
                          testid={`lead-action-archive-${lead.lead_id}`}
                        >
                          Archive
                        </ActionButton>
                        <ActionButton
                          onClick={() => copyLeadDetails(lead)}
                          icon={<Copy className="w-3.5 h-3.5" />}
                          testid={`lead-action-copy-${lead.lead_id}`}
                        >
                          Copy summary
                        </ActionButton>
                        {lead.project_id && (
                          <a
                            href={`/api/web-ui/admin/project/${lead.project_id}/scope`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted text-xs font-medium"
                            data-testid={`lead-action-open-project-${lead.lead_id}`}
                          >
                            <ExternalLink className="w-3.5 h-3.5" /> Open project
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const DetailStat = ({ label, value, highlight }) => (
  <div className={`rounded-lg p-3 border ${highlight ? 'border-[var(--t-signal)]' : 'border-border'} bg-background`}>
    <div className="text-[10px] font-semibold tracking-[0.14em] uppercase text-muted-foreground mb-1">{label}</div>
    <div className={`text-xl font-semibold ${highlight ? 'text-[var(--t-signal)]' : 'text-foreground'}`}>{value}</div>
  </div>
);

const MetaCell = ({ label, value, mono }) => (
  <div>
    <div className="text-[10px] font-semibold tracking-[0.14em] uppercase text-muted-foreground mb-0.5">{label}</div>
    <div className={`text-sm ${mono ? 'font-mono text-xs break-all' : ''} text-foreground`}>{value}</div>
  </div>
);

const ActionButton = ({ onClick, disabled, icon, children, testid }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    data-testid={testid}
  >
    {icon} {children}
  </button>
);
