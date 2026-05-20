/**
 * ValidatorMissionsPage — Human Validation Program surface for participants.
 *
 * Same UI for /client/validation and /developer/validation. Validator is NOT
 * a separate role — it's an opt-in capability flag (users.features.validation_enabled).
 * Both clients (buyers of confidence) and developers (extra-earning side-channel)
 * can participate to earn credits when admin marks their feedback "useful".
 *
 * Backend (single source of truth):
 *   GET  /api/validator/status         → {enabled, profile?}
 *   POST /api/validator/opt-in         → enable + create profile
 *   GET  /api/validator/missions       → list active missions for me
 *   GET  /api/validator/missions/{id}  → mission detail + my_submission
 *   POST /api/validator/missions/{id}/submit → submit feedback
 */
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Loader2, CheckCircle2, AlertTriangle, Eye, ExternalLink, Sparkles, Award } from 'lucide-react';

const API = process.env.REACT_APP_BACKEND_URL ? `${process.env.REACT_APP_BACKEND_URL}/api` : '/api';

const ValidatorMissionsPage = ({ persona = 'client' }) => {
  const [status, setStatus] = useState(null);
  const [missions, setMissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [optingIn, setOptingIn] = useState(false);
  const [activeMission, setActiveMission] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ kind: 'looks_good', category: '', comment: '', platform_hint: '' });

  const load = useCallback(async () => {
    try {
      setErr(null);
      const s = await axios.get(`${API}/validator/status`, { withCredentials: true });
      setStatus(s.data);
      if (s.data?.enabled) {
        const m = await axios.get(`${API}/validator/missions`, { withCredentials: true });
        setMissions(Array.isArray(m.data) ? m.data : []);
      } else {
        setMissions([]);
      }
    } catch (e) {
      setErr(e?.response?.data?.detail || e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const optIn = async () => {
    setOptingIn(true);
    try {
      await axios.post(`${API}/validator/opt-in`, {}, { withCredentials: true });
      await load();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Opt-in failed');
    } finally {
      setOptingIn(false);
    }
  };

  const openMission = (m) => {
    setActiveMission(m);
    setForm({ kind: 'looks_good', category: '', comment: '', platform_hint: '' });
  };

  const submit = async () => {
    if (!activeMission) return;
    setSubmitting(true);
    try {
      await axios.post(
        `${API}/validator/missions/${activeMission.campaign_id}/submit`,
        {
          kind: form.kind,
          category: form.category || null,
          comment: form.comment || null,
          platform_hint: form.platform_hint || null,
        },
        { withCredentials: true },
      );
      setActiveMission(null);
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── LOADING / ERROR ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }
  if (err) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">{err}</div>
      </div>
    );
  }

  // ─── OPT-IN STATE ─────────────────────────────────────────────────────────
  if (!status?.enabled) {
    return (
      <div className="max-w-3xl mx-auto p-6" data-testid="validator-optin-screen">
        <div className="space-y-2 mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-card border border-border">
            <Sparkles className="w-3 h-3" style={{ color: 'var(--t-signal)' }} />
            <span className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Human Validation Program
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            {persona === 'developer'
              ? 'Earn extra credits between work units.'
              : 'Help review products. Earn credits.'}
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            {persona === 'developer'
              ? 'Spot real UX issues on pre-release products from other teams. Admin judges each observation — useful ones earn credits, no money down. Side-channel income while you wait for assignments.'
              : 'Open pre-release products from other clients, scan for visual / UX issues, submit observations. Admin judges. Useful feedback earns credits + reputation.'}
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 mb-8">
          <Bullet num="01" title="Open mission" text="Pick a public mission. Open the preview URL on your device." />
          <Bullet num="02" title="Spot one thing" text="Layout glitch, broken interaction, confusing copy — anything real." />
          <Bullet num="03" title="Submit + earn" text="Admin marks it useful → credits land in your balance. No money risk." />
        </div>

        <button
          onClick={optIn}
          disabled={optingIn}
          className="inline-flex items-center gap-2 font-semibold px-6 py-3.5 rounded-xl text-white transition-all disabled:opacity-50 hover:translate-y-[-1px]"
          style={{ background: 'var(--t-signal)', boxShadow: '0 10px 26px rgba(11,143,94,0.28)' }}
          data-testid="validator-optin-btn"
        >
          {optingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Join the Human Validation Program
        </button>
        <p className="text-xs text-muted-foreground mt-3">
          Free. Reversible — opt out anytime. No effect on your {persona} role.
        </p>
      </div>
    );
  }

  // ─── MISSION DETAIL ───────────────────────────────────────────────────────
  if (activeMission) {
    return (
      <div className="max-w-3xl mx-auto p-6" data-testid="validator-mission-detail">
        <button
          onClick={() => setActiveMission(null)}
          className="text-sm text-[var(--t-signal)] font-semibold mb-4 hover:underline"
        >
          ← Back to missions
        </button>

        <h2 className="text-2xl font-semibold tracking-tight mb-1">{activeMission.project_title}</h2>
        <p className="text-sm text-muted-foreground mb-6">{activeMission.goal}</p>

        {activeMission.preview_url && (
          <a
            href={activeMission.preview_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-card border border-border hover:bg-muted transition-colors text-sm font-medium mb-6"
            data-testid="mission-preview-link"
          >
            <ExternalLink className="w-4 h-4" />
            Open preview to review
          </a>
        )}

        <div className="space-y-4 bg-card border border-border rounded-xl p-5">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Outcome</label>
            <div className="flex gap-2">
              <KindOption
                active={form.kind === 'looks_good'}
                onClick={() => setForm({ ...form, kind: 'looks_good' })}
                label="👍 Looks good"
                accent="#10B981"
              />
              <KindOption
                active={form.kind === 'issue'}
                onClick={() => setForm({ ...form, kind: 'issue' })}
                label="⚠ Issue"
                accent="#F59E0B"
              />
            </div>
          </div>

          {form.kind === 'issue' && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Category</label>
              <div className="flex flex-wrap gap-2">
                {(activeMission.checklist || []).map((c) => (
                  <button
                    key={c}
                    onClick={() => setForm({ ...form, category: c })}
                    className={`text-xs px-3 py-1.5 rounded-md border transition ${
                      form.category === c
                        ? 'bg-[var(--t-signal)] text-white border-[var(--t-signal)]'
                        : 'bg-card border-border text-foreground hover:bg-muted'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
              Comment (optional)
            </label>
            <textarea
              value={form.comment}
              onChange={(e) => setForm({ ...form, comment: e.target.value.slice(0, 600) })}
              rows={3}
              placeholder="What did you notice? Be specific — admin reads this to judge usefulness."
              className="w-full bg-background text-foreground border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--t-signal)] resize-none"
            />
            <div className="text-xs text-muted-foreground mt-1 text-right">{form.comment.length} / 600</div>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
              Platform / browser (optional)
            </label>
            <input
              value={form.platform_hint}
              onChange={(e) => setForm({ ...form, platform_hint: e.target.value.slice(0, 40) })}
              placeholder="e.g. iOS 17 / Safari, Chrome 128 / macOS"
              className="w-full bg-background text-foreground border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--t-signal)]"
            />
          </div>

          <button
            onClick={submit}
            disabled={submitting || (form.kind === 'issue' && !form.category && !form.comment.trim())}
            className="w-full inline-flex items-center justify-center gap-2 font-semibold px-6 py-3 rounded-xl text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--t-signal)' }}
            data-testid="mission-submit-btn"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Submit observation
          </button>
          <p className="text-xs text-muted-foreground">
            Admin reviews each observation. Useful ones earn credits (~{activeMission.reward_per_useful || 25}c).
            Irrelevant submissions reduce your reputation. One submission per mission.
          </p>
        </div>
      </div>
    );
  }

  // ─── DEFAULT: missions list + profile ────────────────────────────────────
  const profile = status.profile || {};
  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6" data-testid="validator-missions-screen">
      {/* Profile header */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Credits" value={profile.credits_balance ?? 0} accent="var(--t-signal)" icon={Award} />
        <Stat label="Reputation" value={`${profile.reputation_score ?? 50}/100`} />
        <Stat label="Useful" value={profile.useful_count ?? 0} accent="#10B981" />
        <Stat label="Submissions" value={profile.total_submissions ?? 0} />
      </div>

      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Open missions</h1>
          <p className="text-sm text-muted-foreground">
            {persona === 'developer'
              ? 'Pre-release products from other teams. Spot real issues → earn credits.'
              : 'Help other teams find issues before launch. Earn credits when useful.'}
          </p>
        </div>
      </div>

      {missions.length === 0 && (
        <div className="bg-card border border-border rounded-xl p-10 text-center">
          <Eye className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <div className="text-lg font-semibold mb-1">No open missions right now</div>
          <p className="text-sm text-muted-foreground">
            Check back later — admin launches sessions as projects approach release.
          </p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        {missions.map((m) => (
          <button
            key={m.campaign_id}
            onClick={() => openMission(m)}
            className="text-left bg-card border border-border rounded-xl p-4 hover:border-[var(--t-signal)] transition-colors"
            data-testid={`mission-card-${m.campaign_id}`}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="font-semibold text-foreground line-clamp-2">{m.project_title}</div>
              <div className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-[var(--t-signal)]/10 text-[var(--t-signal)]">
                ~{m.reward_per_useful || 25}c
              </div>
            </div>
            <div className="text-xs text-muted-foreground mb-3">{m.goal}</div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">
                {m.validators_count || 0}/{m.max_validators} validators
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="text-foreground font-medium">{labelDeadline(m.deadline_at)}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

const Bullet = ({ num, title, text }) => (
  <div className="bg-card border border-border rounded-xl p-4">
    <div className="text-[10px] font-bold text-[var(--t-signal)] mb-2">{num}</div>
    <div className="font-semibold mb-1">{title}</div>
    <div className="text-sm text-muted-foreground">{text}</div>
  </div>
);

const KindOption = ({ active, onClick, label, accent }) => (
  <button
    onClick={onClick}
    className={`flex-1 px-4 py-3 rounded-lg border-2 transition text-sm font-semibold ${
      active ? 'border-[var(--t-signal)] bg-[var(--t-signal)]/5' : 'border-border bg-card hover:bg-muted'
    }`}
    style={active ? { borderColor: accent } : {}}
  >
    {label}
  </button>
);

const Stat = ({ label, value, accent, icon: Icon }) => (
  <div className="bg-card border border-border rounded-xl p-4">
    <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">
      {Icon && <Icon className="w-3.5 h-3.5" />}
      {label}
    </div>
    <div className="text-2xl font-bold" style={accent ? { color: accent } : {}}>
      {value}
    </div>
  </div>
);

function labelDeadline(iso) {
  try {
    const dl = new Date(iso).getTime();
    const hours = Math.max(0, Math.round((dl - Date.now()) / 36e5));
    if (hours < 1) return 'closing soon';
    if (hours < 24) return `${hours}h left`;
    return `${Math.round(hours / 24)}d left`;
  } catch { return ''; }
}

export default ValidatorMissionsPage;
