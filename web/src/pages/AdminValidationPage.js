import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = process.env.REACT_APP_BACKEND_URL ? `${process.env.REACT_APP_BACKEND_URL}/api` : '/api';

/**
 * Admin Validation Campaigns — Human Validation Layer orchestration.
 *
 * Admin:
 *   1) Lists active/closed campaigns + stats (submissions, useful, pending)
 *   2) Creates new campaign for a project (goal, max validators, reward pool, deadline)
 *   3) Drills into a campaign → sees submissions → marks each useful|duplicate|irrelevant
 *
 * Validator NEVER approves anything. Admin verdict is final.
 */
export default function AdminValidationPage() {
  const [campaigns, setCampaigns] = useState([]);
  const [projects, setProjects] = useState([]);
  const [suggested, setSuggested] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [activeCamp, setActiveCamp] = useState(null);
  const [subs, setSubs] = useState([]);
  const [activeSub, setActiveSub] = useState(null);
  const [bootstrapping, setBootstrapping] = useState(null); // project_id while in-flight

  const load = useCallback(async () => {
    try {
      const [c, p, s] = await Promise.all([
        axios.get(`${API}/admin/validation/campaigns`, { withCredentials: true }),
        axios.get(`${API}/admin/projects`, { withCredentials: true }).catch(() => ({ data: [] })),
        // Suggested = projects with hvl_tier set; status tells us idempotency.
        axios.get(`${API}/admin/validation/suggested-projects`, { withCredentials: true })
          .catch(() => ({ data: [] })),
      ]);
      setCampaigns(Array.isArray(c.data) ? c.data : []);
      setProjects(Array.isArray(p.data) ? p.data : (p.data?.projects || []));
      setSuggested(Array.isArray(s.data) ? s.data : []);
    } catch (e) {
      console.error(e);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  /**
   * One-click HVL bootstrap — spawn a validation campaign directly from
   * the suggested-projects row. Idempotent on backend: if a session
   * already exists with source=project_hvl_tier we re-surface it
   * instead of creating a dup. Defaults come straight from the row's
   * `suggested` block (server-controlled, single source of truth).
   */
  const oneClickCreate = async (row) => {
    if (bootstrapping) return;
    setBootstrapping(row.project_id);
    try {
      const r = await axios.post(
        `${API}/admin/validation/campaigns`,
        {
          project_id: row.project_id,
          goal: row.suggested.goal,
          max_validators: row.suggested.max_validators,
          reward_pool_credits: row.suggested.reward_pool_credits,
          deadline_hours: row.suggested.deadline_hours,
          preview_url: row.suggested.preview_url || null,
          source: 'project_hvl_tier',
          source_tier: row.suggested.source_tier,
        },
        { withCredentials: true },
      );
      await load();
      if (r.data?.campaign_id) {
        const fresh = (Array.isArray(r.data) ? r.data : [r.data])[0] || r.data;
        // Refetch the campaign with stats and open it.
        const c = (await axios.get(`${API}/admin/validation/campaigns`, { withCredentials: true })).data || [];
        const opened = c.find((x) => x.campaign_id === fresh.campaign_id);
        if (opened) openCampaign(opened);
      }
    } catch (e) {
      alert(e?.response?.data?.message || e?.response?.data?.detail || 'Bootstrap failed');
    } finally {
      setBootstrapping(null);
    }
  };

  const openCampaign = async (camp) => {
    setActiveCamp(camp);
    setActiveSub(null);
    try {
      const r = await axios.get(
        `${API}/admin/validation/campaigns/${camp.campaign_id}/submissions`,
        { withCredentials: true },
      );
      setSubs(r.data?.submissions || []);
    } catch (e) { console.error(e); }
  };

  const openSubmission = async (s) => {
    try {
      const r = await axios.get(`${API}/admin/validation/submissions/${s.submission_id}`, { withCredentials: true });
      setActiveSub(r.data);
    } catch (e) { console.error(e); }
  };

  const review = async (verdict, admin_note) => {
    if (!activeSub) return;
    try {
      await axios.post(
        `${API}/admin/validation/submissions/${activeSub.submission_id}/review`,
        { verdict, admin_note: admin_note || null },
        { withCredentials: true },
      );
      setActiveSub(null);
      await openCampaign(activeCamp);
      await load();
    } catch (e) {
      alert(e?.response?.data?.message || e?.response?.data?.detail || 'Review failed');
    }
  };

  // ---------- DRILLDOWN: single submission ----------
  if (activeSub) {
    return (
      <div style={S.page}>
        <button style={S.linkBtn} onClick={() => setActiveSub(null)}>← Back to submissions</button>
        <h2 style={S.h2}>{activeSub.kind === 'looks_good' ? 'Looks good' : (activeSub.category || 'Issue')}</h2>
        <div style={S.meta}>
          By <b>{activeSub.validator_name}</b> · {activeSub.platform_hint || 'unknown platform'}
          {' · '}
          {new Date(activeSub.created_at).toLocaleString()}
        </div>
        {activeSub.comment && <div style={S.commentBox}>{activeSub.comment}</div>}
        {activeSub.screenshot_b64 ? (
          <div style={S.screenshotBox}>
            <div style={S.metaTiny}>SCREENSHOT</div>
            <img alt="screenshot" src={activeSub.screenshot_b64} style={{ maxWidth: '100%', borderRadius: 8, marginTop: 8 }} />
          </div>
        ) : null}
        <div style={S.reviewRow}>
          <ReviewBtn label="Useful" color="#10B981" onClick={() => review('useful')} />
          <ReviewBtn label="Duplicate" color="#3B82F6" onClick={() => review('duplicate')} />
          <ReviewBtn label="Irrelevant" color="#94A3B8" onClick={() => review('irrelevant')} />
        </div>
        <div style={S.note}>
          Validator earns credits only on "Useful". Reputation drops on "Irrelevant".
          This verdict is final — validator cannot appeal.
        </div>
      </div>
    );
  }

  // ---------- DRILLDOWN: single campaign ----------
  if (activeCamp) {
    return (
      <div style={S.page}>
        <button style={S.linkBtn} onClick={() => { setActiveCamp(null); setSubs([]); load(); }}>← Back to campaigns</button>
        <div style={S.campHeader}>
          <div>
            <div style={S.metaTiny}>{activeCamp.goal.toUpperCase()}</div>
            <h2 style={S.h2}>{activeCamp.project_title}</h2>
            <div style={S.meta}>
              {activeCamp.stats?.total ?? 0} submissions ·{' '}
              {activeCamp.stats?.pending_review ?? 0} pending review ·{' '}
              {activeCamp.stats?.useful ?? 0} useful
            </div>
          </div>
        </div>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Validator</th>
              <th style={S.th}>Kind</th>
              <th style={S.th}>Category</th>
              <th style={S.th}>Verdict</th>
              <th style={S.th}>Credits</th>
              <th style={S.th}></th>
            </tr>
          </thead>
          <tbody>
            {subs.length === 0 && (
              <tr><td colSpan={6} style={{ ...S.td, color: '#94A3B8', textAlign: 'center', padding: 20 }}>No submissions yet.</td></tr>
            )}
            {subs.map((s) => (
              <tr key={s.submission_id}>
                <td style={S.td}>{s.validator_name}</td>
                <td style={S.td}>{s.kind === 'looks_good' ? '👍 Looks good' : '⚠ Issue'}</td>
                <td style={S.td}>{s.category || '—'}</td>
                <td style={S.td}>
                  <VerdictPill verdict={s.admin_verdict} />
                </td>
                <td style={S.td}>{s.credits_awarded || 0}</td>
                <td style={S.td}>
                  <button style={S.smallBtn} onClick={() => openSubmission(s)}>Open</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // ---------- DEFAULT: campaigns list ----------
  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={S.h1}>Human Validation</h1>
          <div style={S.meta}>Optional perception layer. Admin orchestrates campaigns and judges signal quality.</div>
        </div>
        <button style={S.primaryBtn} onClick={() => setShowCreate(true)}>+ New campaign</button>
      </div>

      {showCreate && (
        <CreateCampaignForm
          projects={projects}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}

      {/* ─── Suggested from projects (HVL one-click bootstrap) ──────────
          Every project whose client picked an HVL tier at checkout shows
          up here with pre-filled session defaults. Idempotent: a row
          flips from "not_started" → "active" the moment a session is
          spawned, so admins can't accidentally double-launch. */}
      {suggested.length > 0 && (
        <div style={S.suggestedBlock}>
          <div style={S.suggestedHeader}>
            <div>
              <div style={S.metaTiny}>FROM CHECKOUT</div>
              <h3 style={S.h3}>Suggested validation sessions</h3>
              <div style={S.meta}>Projects whose client selected a Human Validation tier at checkout.</div>
            </div>
          </div>
          <div style={S.suggestedGrid}>
            {suggested.map((row) => {
              const isActive = row.campaign_status === 'active';
              const isExpired = row.campaign_status === 'expired' || row.campaign_status === 'closed';
              const busy = bootstrapping === row.project_id;
              return (
                <div key={row.project_id} style={S.suggestedCard}>
                  <div style={S.suggestedTop}>
                    <TierBadge tier={row.hvl_tier} />
                    <SessionStatusBadge status={row.campaign_status} />
                  </div>
                  <div style={S.suggestedTitle}>{row.project_name}</div>
                  <div style={S.suggestedMeta}>
                    {row.suggested.max_validators} reviewers · {row.suggested.reward_pool_credits} credits ·{' '}
                    {row.suggested.deadline_hours}h window
                  </div>
                  <div style={S.suggestedCtaRow}>
                    {isActive ? (
                      <button
                        style={S.suggestedOpenBtn}
                        onClick={() => {
                          const c = campaigns.find((x) => x.campaign_id === row.campaign_id);
                          if (c) openCampaign(c);
                        }}
                      >
                        Open session →
                      </button>
                    ) : isExpired ? (
                      <button
                        style={S.suggestedRebootBtn}
                        onClick={() => oneClickCreate(row)}
                        disabled={busy}
                      >
                        {busy ? 'Working…' : 'Start new session'}
                      </button>
                    ) : (
                      <button
                        style={S.suggestedCreateBtn}
                        onClick={() => oneClickCreate(row)}
                        disabled={busy}
                      >
                        {busy ? 'Working…' : 'Create validation session'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={S.grid}>
        {campaigns.length === 0 && (
          <div style={S.empty}>No campaigns yet. Click "+ New campaign" to launch one.</div>
        )}
        {campaigns.map((c) => (
          <div key={c.campaign_id} style={S.campCard} onClick={() => openCampaign(c)}>
            <div style={S.metaTiny}>{c.goal.toUpperCase()}</div>
            <div style={S.campTitle}>{c.project_title}</div>
            <div style={S.statsRow}>
              <Stat label="Submitted" value={c.stats?.total ?? 0} />
              <Stat label="Pending" value={c.stats?.pending_review ?? 0} color="#F59E0B" />
              <Stat label="Useful" value={c.stats?.useful ?? 0} color="#10B981" />
            </div>
            <div style={S.metaBetween}>
              <span>Pool: {c.reward_pool_credits} credits</span>
              <span><StatusBadge status={c.status} /></span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CreateCampaignForm({ projects, onClose, onCreated }) {
  const [projectId, setProjectId] = useState('');
  const [goal, setGoal] = useState('mobile polish');
  const [maxV, setMaxV] = useState(3);
  const [pool, setPool] = useState(150);
  const [deadlineH, setDeadlineH] = useState(48);
  const [previewUrl, setPreviewUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!projectId) { alert('Pick a project'); return; }
    setBusy(true);
    try {
      await axios.post(`${API}/admin/validation/campaigns`,
        { project_id: projectId, goal, max_validators: Number(maxV), reward_pool_credits: Number(pool),
          deadline_hours: Number(deadlineH), preview_url: previewUrl || null, public: true },
        { withCredentials: true });
      onCreated();
    } catch (e) {
      alert(e?.response?.data?.message || 'Create failed');
    } finally { setBusy(false); }
  };
  return (
    <div style={S.modalBg} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: 0, marginBottom: 8 }}>New validation campaign</h3>
        <label style={S.label}>Project</label>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={S.input}>
          <option value="">— Pick a project —</option>
          {projects.map((p) => (
            <option key={p.project_id} value={p.project_id}>{p.name || p.title || p.project_id}</option>
          ))}
        </select>
        <label style={S.label}>Goal</label>
        <input style={S.input} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. mobile polish, pre-release review" />
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={S.label}>Max validators</label>
            <input style={S.input} type="number" min={1} max={20} value={maxV} onChange={(e) => setMaxV(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={S.label}>Reward pool (credits)</label>
            <input style={S.input} type="number" min={0} max={5000} value={pool} onChange={(e) => setPool(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={S.label}>Deadline (hours)</label>
            <input style={S.input} type="number" min={1} max={720} value={deadlineH} onChange={(e) => setDeadlineH(e.target.value)} />
          </div>
        </div>
        <label style={S.label}>Preview URL (where validators click around)</label>
        <input style={S.input} value={previewUrl} onChange={(e) => setPreviewUrl(e.target.value)} placeholder="https://staging.yourapp.com/" />
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <button style={S.ghostBtn} onClick={onClose}>Cancel</button>
          <button style={S.primaryBtn} disabled={busy} onClick={submit}>{busy ? 'Creating…' : 'Launch campaign'}</button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div>
      <div style={S.metaTiny}>{label.toUpperCase()}</div>
      <div style={{ ...S.statValue, color: color || '#0F172A' }}>{value}</div>
    </div>
  );
}

function VerdictPill({ verdict }) {
  const m = {
    pending:    { bg: '#FEF3C7', fg: '#92400E', label: 'pending' },
    useful:     { bg: '#D1FAE5', fg: '#065F46', label: 'useful' },
    duplicate:  { bg: '#DBEAFE', fg: '#1E40AF', label: 'duplicate' },
    irrelevant: { bg: '#F1F5F9', fg: '#475569', label: 'noise' },
  }[verdict] || { bg: '#F1F5F9', fg: '#475569', label: verdict };
  return <span style={{ background: m.bg, color: m.fg, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{m.label}</span>;
}

function StatusBadge({ status }) {
  const m = {
    active:  { bg: '#D1FAE5', fg: '#065F46' },
    closed:  { bg: '#F1F5F9', fg: '#475569' },
    expired: { bg: '#FEE2E2', fg: '#991B1B' },
  }[status] || { bg: '#F1F5F9', fg: '#475569' };
  return <span style={{ background: m.bg, color: m.fg, padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>{status}</span>;
}

function ReviewBtn({ label, color, onClick }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: '12px 16px', borderRadius: 8, border: `1px solid ${color}`,
      background: color, color: 'white', fontWeight: 700, cursor: 'pointer',
    }}>{label}</button>
  );
}

/**
 * TierBadge — visually identifies which HVL tier the client chose at
 * checkout. Colour palette is consistent across the suggested grid and
 * the project-detail HVL block.
 */
function TierBadge({ tier }) {
  const m = {
    basic:   { bg: '#E0F2FE', fg: '#075985', label: 'BASIC' },
    pro:     { bg: '#DBEAFE', fg: '#1E40AF', label: 'PRO' },
    managed: { bg: '#EDE9FE', fg: '#5B21B6', label: 'MANAGED' },
  };
  const x = m[tier] || { bg: '#F1F5F9', fg: '#475569', label: (tier || '—').toUpperCase() };
  return (
    <span style={{
      background: x.bg, color: x.fg, padding: '2px 8px', borderRadius: 4,
      fontSize: 10, fontWeight: 800, letterSpacing: 1.5,
    }}>{x.label}</span>
  );
}

function SessionStatusBadge({ status }) {
  const m = {
    not_started: { bg: '#F1F5F9', fg: '#64748B', label: 'NOT STARTED' },
    active:      { bg: '#D1FAE5', fg: '#065F46', label: 'ACTIVE' },
    expired:     { bg: '#FEE2E2', fg: '#991B1B', label: 'EXPIRED' },
    closed:      { bg: '#E2E8F0', fg: '#334155', label: 'CLOSED' },
  };
  const x = m[status] || m.not_started;
  return (
    <span style={{
      background: x.bg, color: x.fg, padding: '2px 8px', borderRadius: 4,
      fontSize: 10, fontWeight: 800, letterSpacing: 1.5,
    }}>{x.label}</span>
  );
}

const S = {
  page: { padding: 24, color: '#0F172A', background: '#F8FAFC', minHeight: '100vh' },
  h1: { margin: 0, fontSize: 24, fontWeight: 800 },
  h2: { margin: 0, fontSize: 20, fontWeight: 700 },
  meta: { fontSize: 13, color: '#64748B' },
  metaTiny: { fontSize: 10, letterSpacing: 1.5, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase' },
  metaBetween: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#64748B', marginTop: 8 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 },
  campCard: { background: 'white', borderRadius: 12, padding: 16, border: '1px solid #E2E8F0', cursor: 'pointer' },
  campTitle: { fontSize: 16, fontWeight: 700, marginTop: 4 },
  statsRow: { display: 'flex', gap: 16, marginTop: 12 },
  statValue: { fontSize: 18, fontWeight: 800 },
  campHeader: { background: 'white', borderRadius: 12, padding: 16, border: '1px solid #E2E8F0', marginBottom: 16 },
  table: { width: '100%', background: 'white', borderRadius: 12, overflow: 'hidden', border: '1px solid #E2E8F0', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: 12, fontSize: 11, fontWeight: 700, color: '#64748B', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' },
  td: { padding: 12, fontSize: 13, borderBottom: '1px solid #F1F5F9' },
  empty: { color: '#94A3B8', padding: 32, textAlign: 'center', background: 'white', borderRadius: 12, border: '1px dashed #CBD5E1' },
  commentBox: { background: 'white', borderRadius: 8, padding: 16, marginTop: 12, border: '1px solid #E2E8F0', lineHeight: 1.5 },
  screenshotBox: { background: 'white', borderRadius: 8, padding: 16, marginTop: 12, border: '1px solid #E2E8F0' },
  reviewRow: { display: 'flex', gap: 8, marginTop: 16 },
  note: { marginTop: 12, fontSize: 12, color: '#94A3B8' },
  linkBtn: { background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', padding: 0, marginBottom: 12 },
  primaryBtn: { background: '#0F172A', color: 'white', border: 'none', padding: '10px 16px', borderRadius: 8, fontWeight: 700, cursor: 'pointer' },
  ghostBtn: { background: 'white', color: '#0F172A', border: '1px solid #CBD5E1', padding: '10px 16px', borderRadius: 8, fontWeight: 600, cursor: 'pointer' },
  smallBtn: { background: '#F1F5F9', border: '1px solid #CBD5E1', padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  modalBg: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { background: 'white', padding: 24, borderRadius: 16, width: 480, maxWidth: '90vw' },
  label: { fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 12, marginBottom: 4, display: 'block', fontWeight: 700 },
  input: { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 14, marginBottom: 8, boxSizing: 'border-box' },

  // ─── Suggested from projects (HVL one-click bootstrap) ───
  suggestedBlock: {
    background: 'white',
    border: '1px solid #E2E8F0',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  suggestedHeader: { marginBottom: 12 },
  h3: { margin: '4px 0', fontSize: 16, fontWeight: 800 },
  suggestedGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 12,
  },
  suggestedCard: {
    background: '#F8FAFC',
    border: '1px solid #E2E8F0',
    borderRadius: 10,
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  suggestedTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  suggestedTitle: { fontSize: 15, fontWeight: 700, color: '#0F172A' },
  suggestedMeta: { fontSize: 12, color: '#64748B' },
  suggestedCtaRow: { marginTop: 4 },
  suggestedCreateBtn: {
    width: '100%',
    background: '#0F172A',
    color: 'white',
    border: 'none',
    padding: '8px 12px',
    borderRadius: 8,
    fontWeight: 700,
    cursor: 'pointer',
    fontSize: 13,
  },
  suggestedOpenBtn: {
    width: '100%',
    background: 'white',
    color: '#1E40AF',
    border: '1px solid #BFDBFE',
    padding: '8px 12px',
    borderRadius: 8,
    fontWeight: 700,
    cursor: 'pointer',
    fontSize: 13,
  },
  suggestedRebootBtn: {
    width: '100%',
    background: 'white',
    color: '#0F172A',
    border: '1px solid #CBD5E1',
    padding: '8px 12px',
    borderRadius: 8,
    fontWeight: 700,
    cursor: 'pointer',
    fontSize: 13,
  },
};
