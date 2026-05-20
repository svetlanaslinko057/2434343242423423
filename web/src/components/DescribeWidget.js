/**
 * DescribeWidget — inline describe-your-product form for landing hero.
 *
 * Mirrors the Expo /describe flow (/app/frontend/app/describe.tsx) but
 * laptop-native: text/URL input + file upload, no voice. Smart URL
 * detection auto-routes to /api/estimate/analyze-url, file upload to
 * /api/estimate/parse-file, plain text to /api/estimate.
 *
 * Two surface modes:
 *   - "inline"  — compact widget for the hero CTA (default)
 *   - "full"    — expanded form for the dedicated /describe page
 *
 * Calls runtime.* directly (visitor mode — no auth required for analyze/parse).
 * On success, navigates to /estimate-result with the response in router state.
 *
 * The two-pass /api/estimate (Pass 1 generator + Pass 2 operational hardening
 * for reliability + qa) is invisible at this layer — it just returns the
 * combined module list with `_source` metadata which EstimateResultPage uses
 * to render hardening badges.
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Loader2, ArrowRight, FileText, X } from 'lucide-react';
import { runtime } from '@/runtime';

const URL_REGEX = /\bhttps?:\/\/\S+/i;
const MAX_GOAL = 1200;
const MIN_GOAL = 40;
const ACCEPTED_FILE_TYPES = '.pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.webp';
const MAX_FILE_MB = 10;

// Build modes — must mirror /app/frontend/app/describe.tsx `MODES`. The
// backend (server.py /api/estimate) clamps to {'ai','hybrid','dev'} so
// these IDs are the wire contract — do not rename.
const BUILD_MODES = [
  {
    id: 'ai',
    label: 'AI Build',
    headline: 'Fastest, lowest cost',
    bullets: ['Full product scope', 'Built entirely with AI-generated code', 'Delivered quickly'],
  },
  {
    id: 'hybrid',
    label: 'AI + Engineering',
    headline: 'Balanced speed & quality',
    bullets: ['AI foundation + human review', 'Production-ready', 'Optimized architecture'],
    popular: true,
  },
  {
    id: 'dev',
    label: 'Full Engineering',
    headline: 'Maximum quality & control',
    bullets: ['Built by senior developers', 'Custom architecture', 'Full QA & validation'],
  },
];

const DescribeWidget = ({ mode = 'inline' }) => {
  const navigate = useNavigate();
  const [goal, setGoal] = useState('');
  const [selectedMode, setSelectedMode] = useState('hybrid'); // 'ai' | 'hybrid' | 'dev'
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyStage, setBusyStage] = useState('');
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const isURL = URL_REGEX.test(goal.trim());
  const goalLen = goal.trim().length;
  const canSubmit = !busy && (file || isURL || goalLen >= MIN_GOAL);

  const handleFilePick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`File too large (max ${MAX_FILE_MB} MB)`);
      return;
    }
    setFile(f);
    setError(null);
  };

  const handleFileDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`File too large (max ${MAX_FILE_MB} MB)`);
      return;
    }
    setFile(f);
    setError(null);
  };

  const clearFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);

    try {
      let resolvedGoal = goal.trim();
      const userText = resolvedGoal;            // what user typed verbatim
      const urlInGoal = (resolvedGoal.match(URL_REGEX) || [])[0] || null;
      // Text portion stripped of the URL — used to detect "URL + own notes" mode.
      const textWithoutUrl = urlInGoal
        ? resolvedGoal.replace(urlInGoal, '').trim()
        : resolvedGoal;
      const hasOwnNotes = textWithoutUrl.length >= 10;

      // Step A — if file present, parse it into goal text
      if (file) {
        setBusyStage('Reading your file…');
        const fd = new FormData();
        fd.append('file', file);
        try {
          const { data } = await runtime.post('/api/estimate/parse-file', fd, { timeoutMs: 60000 });
          if (data?.text) {
            resolvedGoal = `${resolvedGoal ? resolvedGoal + '\n\n' : ''}${data.text}`.trim().slice(0, MAX_GOAL);
          }
        } catch (e) {
          // Graceful: file parse failure shouldn't block — fallback to filename mention
          resolvedGoal = `${resolvedGoal ? resolvedGoal + '\n\n' : ''}[Attached file: ${file.name}]`.slice(0, MAX_GOAL);
        }
      }

      // Step B — if a URL is present, ALWAYS analyze it (drop the old length
      // gate that skipped analysis when text was "too long"). Three modes:
      //   1. URL only            → use the synthesized brief as the goal
      //   2. URL + own notes     → synthesize brief + append user notes
      //                            ("Reference: …  ·  User notes: …")
      //   3. No URL              → fall through with raw text
      // analyze-url failure is graceful — we keep what we have and continue.
      if (urlInGoal) {
        setBusyStage(hasOwnNotes ? 'Analyzing reference + your notes…' : 'Analyzing the link…');
        try {
          const { data } = await runtime.post('/api/estimate/analyze-url', {
            url: urlInGoal,
          }, { timeoutMs: 45000 });

          // Prefer the structured `text` brief (backend canonical shape on
          // /describe). Fall back to the snapshot synthesis used by the
          // older inline endpoint variant.
          let synthesized = '';
          if (data?.text) {
            synthesized = String(data.text).trim();
          } else if (data?.snapshot) {
            const s = data.snapshot;
            synthesized = [
              s.product_summary || '',
              s.target_audience ? `Target: ${s.target_audience}` : '',
              s.key_features?.length ? `Features: ${s.key_features.join(', ')}` : '',
            ].filter(Boolean).join('. ');
          }

          if (synthesized) {
            if (hasOwnNotes) {
              // URL + own notes — combine. User intent takes precedence at
              // the top so /api/estimate's LLM weights it correctly.
              resolvedGoal = `${textWithoutUrl}\n\nReference (${urlInGoal}):\n${synthesized}`.slice(0, MAX_GOAL);
            } else {
              // URL-only — synthesized brief becomes the goal.
              resolvedGoal = synthesized.slice(0, MAX_GOAL);
            }
          } else if (!hasOwnNotes && !file) {
            // No synthesis came back AND user didn't add any notes AND
            // no file — keep the raw URL as a hint so /api/estimate at
            // least has *something*.
            resolvedGoal = `Build a product similar to ${urlInGoal}`;
          }
        } catch {
          // Graceful: continue with userText (and file content if any).
          // If user typed nothing else, fall back to raw URL hint.
          if (!hasOwnNotes && !file) {
            resolvedGoal = `Build a product similar to ${urlInGoal}`;
          }
        }
      }

      // Step C — call main /api/estimate (Pass 1 + Pass 2 hardening).
      // Block ONLY pure-text inputs that are too short. If a URL or file
      // was processed, we always proceed — the synthesis (or hint) gives
      // the LLM enough material.
      if (!urlInGoal && !file && resolvedGoal.length < MIN_GOAL) {
        setError(`Please describe your product a bit more — at least ${MIN_GOAL} characters, or paste a link / attach a file.`);
        setBusy(false);
        return;
      }

      setBusyStage('Calculating scope, modules & price…');
      const { data: estimate } = await runtime.post('/api/estimate', {
        goal: resolvedGoal,
        mode: selectedMode,
        infer_axes: true,
      }, { timeoutMs: 90000 });

      if (estimate?.clarity === 'low') {
        navigate('/describe', { state: { initialGoal: resolvedGoal, clarityHints: estimate.clarity_hints, userText, mode: selectedMode } });
        return;
      }

      navigate('/estimate-result', { state: { estimate, originalGoal: resolvedGoal, userText, sourceUrl: urlInGoal, mode: selectedMode } });
    } catch (err) {
      console.error('describe widget error', err);
      setError(err?.message || 'Estimate failed. Please try again.');
    } finally {
      setBusy(false);
      setBusyStage('');
    }
  };

  const baseInputClass = mode === 'inline'
    ? 'w-full bg-card text-foreground border border-border rounded-xl px-5 py-4 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--t-signal)] resize-none'
    : 'w-full bg-card text-foreground border border-border rounded-xl px-5 py-4 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--t-signal)] resize-none';

  // Helper for the live mode pill — tells the user which of the 3 input
  // modes they're in so the "min 40 chars" rule doesn't feel arbitrary
  // when they paste a URL.
  const userText = goal.trim();
  const urlInGoal = (userText.match(URL_REGEX) || [])[0] || null;
  const textWithoutUrl = urlInGoal ? userText.replace(urlInGoal, '').trim() : userText;
  const inputMode = urlInGoal
    ? (textWithoutUrl.length >= 10 ? 'url+notes' : 'url')
    : (userText.length > 0 ? 'text' : 'empty');

  return (
    <div
      className={mode === 'inline' ? 'space-y-3 max-w-2xl' : 'space-y-4'}
      data-testid="describe-widget"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleFileDrop}
    >
      {/* Input mode indicator — explicit 3-mode pill row so the user
          always knows which validation rule is active. Empty state shows
          all three modes greyed out as hints. */}
      <div className="flex items-center gap-2 flex-wrap" data-testid="describe-widget-modes">
        <ModePill active={inputMode === 'text'} label="TEXT" hint="40+ chars" />
        <ModePill active={inputMode === 'url'} label="LINK" hint="URL only" />
        <ModePill active={inputMode === 'url+notes'} label="LINK + NOTES" hint="combine both" />
      </div>

      {/* Text/URL input */}
      <div className="relative">
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value.slice(0, MAX_GOAL))}
          placeholder={
            mode === 'inline'
              ? 'Paste a link, describe your idea, or both. Example: "https://uber.com — but for freelance chefs, Stripe payouts, EU market"'
              : 'Paste a competitor link and/or describe your product in your own words. Combining both works best — the link becomes the reference and your notes set the priorities.'
          }
          rows={mode === 'inline' ? 3 : 6}
          disabled={busy}
          className={baseInputClass}
          data-testid="describe-widget-input"
        />
      </div>

      {/* File row */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          onChange={handleFilePick}
          disabled={busy}
          className="hidden"
          data-testid="describe-widget-file-input"
        />
        {!file ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-card border border-border text-foreground hover:bg-muted transition-colors text-sm font-medium disabled:opacity-50"
            data-testid="describe-widget-attach-button"
          >
            <Upload className="w-4 h-4" />
            Attach file (PDF, doc, image)
          </button>
        ) : (
          <div
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border text-sm"
            data-testid="describe-widget-file-chip"
          >
            <FileText className="w-4 h-4 text-[var(--t-signal)]" />
            <span className="text-foreground font-medium max-w-[200px] truncate">{file.name}</span>
            <span className="text-muted-foreground text-xs">({(file.size / 1024).toFixed(0)} KB)</span>
            <button
              type="button"
              onClick={clearFile}
              disabled={busy}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Remove file"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Char counter — only relevant for pure-TEXT mode. When a URL is
            present we drop the count entirely; the link itself is the
            valid signal and counting symbols would just confuse the user. */}
        {goal && inputMode === 'text' && (
          <span className="text-xs text-muted-foreground ml-auto" data-testid="describe-widget-counter">
            {goalLen} / {MAX_GOAL}
          </span>
        )}
      </div>

      {/* Build mode selector — 3 cards: AI Build / AI + Engineering / Full
          Engineering. Mirrors the mobile /describe flow so the same scope
          intake produces the same pricing path on both surfaces. Wire ID
          ('ai' | 'hybrid' | 'dev') is the contract with backend
          /api/estimate; do not rename. */}
      <div className="space-y-2" data-testid="describe-widget-build-modes">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Choose how we build it
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {BUILD_MODES.map((m) => {
            const isActive = selectedMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelectedMode(m.id)}
                disabled={busy}
                data-testid={`describe-widget-mode-${m.id}`}
                data-active={isActive ? 'true' : 'false'}
                className="text-left rounded-lg p-3 transition-all disabled:opacity-50"
                style={{
                  border: '1px solid',
                  borderColor: isActive ? 'var(--t-signal)' : 'rgba(120,120,120,0.25)',
                  background: isActive ? 'rgba(11,143,94,0.08)' : 'transparent',
                  boxShadow: isActive ? '0 0 0 3px rgba(11,143,94,0.10)' : 'none',
                }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">{m.label}</span>
                  {m.popular && (
                    <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--t-signal)]">
                      popular
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{m.headline}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* CTA */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="group inline-flex items-center justify-center gap-2 font-semibold px-7 py-4 rounded-xl text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:translate-y-[-1px]"
        style={{
          background: 'var(--t-signal)',
          boxShadow: canSubmit ? '0 10px 26px rgba(11,143,94,0.28)' : 'none',
        }}
        data-testid="describe-widget-submit"
      >
        {busy ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            {busyStage || 'Working…'}
          </>
        ) : (
          <>
            Get my estimate
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </>
        )}
      </button>

      {/* Trust + error */}
      <p className="text-xs text-muted-foreground" data-testid="describe-widget-hint">
        Free · no signup · ~15 seconds · works with{' '}
        <span className="text-foreground font-medium">text</span>,{' '}
        <span className="text-foreground font-medium">a link</span>, or{' '}
        <span className="text-foreground font-medium">both combined</span> — scope, hours and price calculated on the spot.
      </p>
      {error && (
        <div
          className="text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2"
          data-testid="describe-widget-error"
        >
          {error}
        </div>
      )}
    </div>
  );
};

export default DescribeWidget;

// Small status pill — explicit indicator of which of the 3 input modes
// (TEXT / LINK / LINK + NOTES) is currently active. Active pill uses
// the signal color; inactive ones stay muted so the row reads as
// "here are the 3 ways to describe your idea". Helps remove the old
// confusion where a pasted URL felt invalid because of the char count.
const ModePill = ({ active, label, hint }) => (
  <span
    data-testid={`describe-widget-mode-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
    data-active={active ? 'true' : 'false'}
    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider border transition-colors"
    style={{
      borderColor: active ? 'var(--t-signal)' : 'rgba(120,120,120,0.25)',
      background: active ? 'var(--t-signal)' : 'transparent',
      color: active ? '#fff' : 'rgb(120,120,130)',
    }}
  >
    {label}
    <span style={{ opacity: 0.7, fontWeight: 500, textTransform: 'none', letterSpacing: 'normal' }}>
      · {hint}
    </span>
  </span>
);
