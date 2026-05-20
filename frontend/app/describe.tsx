import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator, StyleSheet,
  Pressable, Image,
} from 'react-native';
import {
  useFonts as useInstrument,
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
} from '@expo-google-fonts/instrument-sans';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { useAudioRecorder, AudioModule, RecordingPresets } from 'expo-audio';
import { useAuth } from '../src/auth';
import { useMe } from '../src/use-me';
import api from '../src/api';
import { runtime } from '../src/runtime';
import { ApiError } from '../src/runtime-client';
import { resolveUserEntry } from '../src/resolve-entry';
import {
  hasWelcomeBeenSeenInSession,
  consumeJustLeftWelcome,
} from '../src/welcome-session';
import { F, usePalette, type Palette } from '../src/design-tokens';
import { useTheme } from '../src/theme-context';
import { GravityCTA } from '../src/gravity-cta';

/**
 * L0 entry point — Visitor describe-your-product flow.
 *
 * Conservative material-only pass over the cognitive-monochrome grammar
 * established in /welcome. Everything that affects mechanics
 * (validation, autosave timing, flow order, estimation sequencing) is
 * preserved verbatim from the previous implementation. Only the
 * surface — substrate, typography, signal expression, telemetry,
 * field materiality, CTA gravity, quiet states — has been transformed.
 *
 * Hero typography deliberately relaxed from the landing's 42px
 * declaration to a 28px utilitarian heading: input flow is cognition
 * under interaction, not rhetoric. Less gravity, more breathing room
 * for the user to think inside.
 *
 * Error state: no red box, no alarm icon. Quiet `ERR ·` mono prefix +
 * primary text. Quiet seriousness, not alarm semantics.
 *
 * Mode cards: neutral substrate with sage-only signal for the active
 * choice. Per-mode marketing colors (purple/sage/amber from the data
 * model) are intentionally NOT rendered — modes differentiate through
 * typography hierarchy and active state, not loud chromatic identity.
 */

type Mode = 'ai' | 'hybrid' | 'dev';

/**
 * MODES represent three PRODUCTION METHODS of the same product scope.
 * Data identical to previous implementation — visual rendering changed.
 */
const MODES: {
  id: Mode;
  label: string;
  headline: string;
  bullets: string[];
  popular?: boolean;
}[] = [
  {
    id: 'ai',
    label: 'AI Build',
    headline: 'Fastest, lowest cost',
    bullets: [
      'Full product scope',
      'Built entirely with AI-generated code',
      'Delivered quickly',
      'May require post-launch fixes',
    ],
  },
  {
    id: 'hybrid',
    label: 'AI + Engineering',
    headline: 'Balanced speed & quality',
    bullets: [
      'AI foundation + human review',
      'Production-ready',
      'Optimized architecture',
      'Stable launch',
    ],
    popular: true,
  },
  {
    id: 'dev',
    label: 'Full Engineering',
    headline: 'Maximum quality & control',
    bullets: [
      'Built by senior developers',
      'Custom architecture',
      'Full QA & validation',
      'Highest reliability',
    ],
  },
];

const MIN_GOAL = 40;
const MAX_GOAL = 3000;
const MAX_FILE_BYTES = 400_000;

// Detect a URL anywhere in free-form goal text. We re-use this in two
// places:
//   1. `estimateProduct` — if the textarea has a URL we auto-route through
//      /api/estimate/analyze-url BEFORE checking the 40-char minimum, so
//      pasting "https://fomo.cx/" alone is enough to proceed.
//   2. The mode pill under the textarea — gives the user a live signal
//      whether their input is "text", "link", or "link + your notes" so the
//      40-char rule never feels arbitrary.
const URL_REGEX = /\bhttps?:\/\/\S+/i;

/** Gibberish / nonsense detector — UNCHANGED. */
function isGibberish(text: string): boolean {
  const clean = text.trim();
  if (clean.length < MIN_GOAL) return true;
  const letters = clean.replace(/[^a-zA-Zа-яА-ЯёЁ]/g, '');
  if (letters.length < 20) return true;
  const words = clean.split(/\s+/).filter(w => w.length > 1);
  if (words.length < 5) return true;
  if (/(.)\1{5,}/.test(clean)) return true;
  if (/^([^\s])\1+$/.test(clean.replace(/\s/g, ''))) return true;
  return false;
}

export default function Index() {
  const router = useRouter();
  const P = usePalette();
  const { theme } = useTheme();
  // Asset filenames are reversed in this codebase: `evax-logo.png` is the
  // WHITE wordmark (for dark substrate); `evax-logo-light.png` is the BLACK
  // wordmark (for light substrate). Pick the one that contrasts with the
  // active substrate so the brand mark is always visible.
  const brandLogo = theme === 'dark'
    ? require('../assets/images/evax-logo.png')
    : require('../assets/images/evax-logo-light.png');
  const s = useMemo(() => makeStyles(P), [P]);
  const { token, loading: authLoading } = useAuth();
  const { me, loading: meLoading } = useMe();
  const [fontsLoaded] = useInstrument({
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    JetBrainsMono_500Medium,
  });
  // True for one render after the user clicked "See my product plan" on
  // /welcome. Drives the visual continuity strip ("STEP 1 OF 3").
  const [cameFromWelcome, setCameFromWelcome] = useState(false);

  // Authed redirect: if a signed-in visitor lands here, send them to their
  // role-specific home. (Guests reach /describe only via the welcome CTA;
  // the / route handles the guest → /welcome gate centrally.)
  useEffect(() => {
    if (authLoading || meLoading) return;
    if (token && me) router.replace(resolveUserEntry(me) as any);
  }, [authLoading, meLoading, token, me, router]);

  useEffect(() => {
    if (hasWelcomeBeenSeenInSession() && consumeJustLeftWelcome()) {
      setCameFromWelcome(true);
    }
  }, []);

  const [goal, setGoal] = useState('');
  const [mode, setMode] = useState<Mode>('hybrid');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>('');
  const [attachment, setAttachment] = useState<{ name: string; text: string } | null>(null);

  const goalLen = goal.length;
  // Inline URL detection — if the textarea holds a URL we relax the 40-char
  // floor (URL alone is a valid intent; analyze-url will fill in the brief).
  const urlInGoal = (goal.match(URL_REGEX) || [])[0] || null;
  const textWithoutUrl = urlInGoal ? goal.replace(urlInGoal, '').trim() : goal.trim();
  const hasOwnNotes = textWithoutUrl.length >= 10;
  // `isTooShort` controls the inline guidance copy + the submit guard. A
  // URL counts as a valid signal even if total length is < 40.
  const isTooShort = !urlInGoal && (goalLen < MIN_GOAL || isGibberish(goal));
  const charHint =
    urlInGoal
      ? (hasOwnNotes ? 'Link + your notes' : 'URL detected — link will be analyzed')
      : goalLen === 0
        ? 'min 40 chars (or paste a link)'
        : isTooShort
          ? `${goalLen} / 40 — keep going (or paste a link)`
          : `${goalLen} / ${MAX_GOAL}`;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [parsing, setParsing] = useState(false);

  // URL-based competitor / inspiration analysis. Visitor pastes a link →
  // backend scrapes + LLM produces a structured brief → we drop it into the
  // goal textarea (editable, same as voice). Closed bottom-sheet by default.
  const [urlSheetOpen, setUrlSheetOpen] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [urlBusy, setUrlBusy] = useState(false);
  // Captured on a successful analyze — forwarded to /estimate-result so it
  // can show a "Based on competitor: <host>" badge. Reset if the user
  // clears the attachment chip or wipes the textarea.
  const [sourceUrl, setSourceUrl] = useState<string>('');
  const [sourceTitle, setSourceTitle] = useState<string>('');

  // ─── Device hint for telemetry ──────────────────────────────────────────
  // Native (iOS/Android) is always 'mobile'. On web we slice by viewport
  // width — same threshold as our responsive breakpoint. Pure cosmetic for
  // analytics; we never dispatch on it. Captured at first call to avoid
  // re-renders flapping the value when the device rotates.
  const deviceHint = useMemo<'mobile' | 'desktop'>(() => {
    if (Platform.OS !== 'web') return 'mobile';
    try {
      // @ts-ignore — window is available on web
      return (typeof window !== 'undefined' && window.innerWidth < 768) ? 'mobile' : 'desktop';
    } catch { return 'mobile'; }
  }, []);

  const analyzeCompetitorUrl = async () => {
    if (urlBusy) return;
    const raw = urlInput.trim();
    if (!raw) { setError('Paste a website link first.'); return; }
    setError('');
    setUrlBusy(true);
    // Fire user-intent event BEFORE the network call so we can measure
    // "tried to analyze" independently of "network said yes/no". Without
    // this we conflate user friction with backend friction.
    api.post('/estimate/analyze-url/telemetry', {
      event: 'analyze_url_started',
      url: raw,
      surface: 'visitor',
      device: deviceHint,
    }).catch(() => undefined);
    try {
      const { data } = await api.post('/estimate/analyze-url', {
        url: raw,
        surface: 'visitor',
        device: deviceHint,
      }, { timeout: 60000 });
      const text = String(data?.text || '').trim();
      const title = String(data?.title || '').trim();
      const finalUrl = String(data?.url || raw).trim();
      if (!text) {
        setError('Site reached but the analysis came back empty. Try a different page.');
        return;
      }
      // Drop the brief into the goal field so the visitor can edit before
      // /estimate. If the user already wrote something in the main goal
      // field (e.g. "but for the EU market with Stripe payouts"), we put
      // their text FIRST and the reference SECOND — the LLM weights user
      // intent higher when it's positioned before the reference block.
      // This is the canonical "URL + text" combine flow. Cap at MAX_GOAL.
      const userTextAlreadyTyped = goal.trim();
      const referenceBlock = `Reference (${finalUrl}):\n${text}`;
      const combined = userTextAlreadyTyped
        ? `${userTextAlreadyTyped}\n\n${referenceBlock}`
        : text;
      setGoal(combined.slice(0, MAX_GOAL));
      const hostname = (() => {
        try { return new URL(finalUrl).hostname.replace(/^www\./, ''); }
        catch { return finalUrl; }
      })();
      setAttachment({ name: title || hostname, text });
      setSourceUrl(finalUrl);
      setSourceTitle(title || hostname);
      setUrlSheetOpen(false);
      setUrlInput('');
    } catch (e: any) {
      // Backend returns a canonical envelope:
      //   { ok:false, code, message, hint?, details:{kind,message,hint,detail}, status, ... }
      // We prefer `message` + `hint` (human narrative) over technical strings.
      const env = e?.response?.data || {};
      const msg = String(env.message || e?.response?.data?.detail || e?.message || 'Could not analyze that link.');
      const hint = env.hint ? `\n${env.hint}` : '';
      setError(`${msg}${hint}`);
    } finally {
      setUrlBusy(false);
    }
  };

  const onPickFile = async () => {
    if (parsing) return;
    if (Platform.OS === 'web') {
      fileInputRef.current?.click();
      return;
    }
    try {
      const res = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: ['text/*', 'application/pdf', 'application/vnd.openxmlformats-officedocument.*', 'image/*'],
      });
      if (res.canceled) return;
      const f = res.assets?.[0];
      if (!f) return;
      const blobRes = await fetch(f.uri);
      const blob = await blobRes.blob();
      if (blob.size > MAX_FILE_BYTES) {
        setError('File too large. Please keep brief under 400KB.');
        return;
      }
      const file = new File([blob], f.name || 'brief', { type: f.mimeType || blob.type });
      await parseAndAttach(file);
    } catch (e: any) {
      setError(e?.message || 'Could not read file.');
    }
  };

  const onFileChosen = async (e: any) => {
    const file: File | undefined = e?.target?.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError('File too large. Please keep brief under 400KB.');
      e.target.value = '';
      return;
    }
    await parseAndAttach(file);
    e.target.value = '';
  };

  const parseAndAttach = async (file: File) => {
    setParsing(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file as any);
      const { data } = await api.post('/estimate/parse-file', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      });
      const text = String(data?.text || '').trim();
      const name = String(data?.name || file.name);
      if (!text) {
        setError('Could not extract text from this file. Type or paste your idea instead.');
        return;
      }
      setAttachment({ name, text });
      if (goal.trim().length === 0) setGoal(text.slice(0, MAX_GOAL));
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'File parsing failed.');
    } finally {
      setParsing(false);
    }
  };

  // ── Voice brief ────────────────────────────────────────────────────────────
  // The visitor can describe their product by speaking instead of typing.
  // Whisper-1 transcribes the recording (provider chosen by admin in
  // /admin/integrations: openai vs emergent). The transcript drops into the
  // goal field — editable before /estimate, never silently submitted.
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recState, setRecState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [recElapsed, setRecElapsed] = useState(0);     // seconds, live
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recStartRef = useRef<number>(0);
  // Hard ceiling so a forgotten recording can't grow past Whisper's 25 MB —
  // ~3 minutes of m4a is comfortably under that.
  const MAX_REC_SECONDS = 180;

  useEffect(() => {
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      // Best-effort: stop the recorder on unmount to free the mic.
      try { (recorder as any)?.stop?.(); } catch { /* ignore */ }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startVoiceBrief = async () => {
    if (recState !== 'idle' || parsing || busy) return;
    setError('');
    try {
      // Web (Chrome / Safari on MacBook etc.): expo-audio's permissions API
      // does NOT call getUserMedia under the hood, so the browser's native
      // mic prompt never appears. We prime it ourselves — the call below
      // both surfaces the system popup and gives us a real status when the
      // user denies / has no device. The probe stream is released straight
      // away; expo-audio asks for its own when the actual recording starts.
      if (Platform.OS === 'web') {
        const isSecure = typeof window !== 'undefined'
          && (window.isSecureContext
            || window.location.protocol === 'https:'
            || window.location.hostname === 'localhost');
        if (!isSecure) {
          setError('Voice input needs HTTPS. Reload over https:// and try again.');
          return;
        }
        try {
          const stream = await (navigator as any).mediaDevices?.getUserMedia?.({ audio: true });
          if (stream && typeof stream.getTracks === 'function') {
            stream.getTracks().forEach((t: any) => t.stop?.());
          }
        } catch (e: any) {
          const name = e?.name || '';
          if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
            setError('Microphone access blocked. Allow microphone in your browser settings (lock icon → Site settings → Microphone → Allow), then reload and try again.');
          } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
            setError('No microphone detected. Plug one in or pick the correct input device, then try again.');
          } else if (name === 'NotReadableError') {
            setError('Microphone is busy (another app is using it). Close it and try again.');
          } else {
            setError(`Microphone error: ${e?.message || e}`);
          }
          return;
        }
      }
      // Native (iOS/Android): this DOES trigger the OS-level mic prompt the
      // first time. On web it's effectively a no-op after the getUserMedia
      // probe above already granted access.
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError(
          perm.canAskAgain
            ? 'Microphone access is needed to record a voice brief. Tap the mic again to allow.'
            : 'Microphone access blocked. Enable it in your browser/OS settings, then retry.',
        );
        return;
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
      recStartRef.current = Date.now();
      setRecElapsed(0);
      setRecState('recording');
      recTimerRef.current = setInterval(() => {
        const sec = Math.floor((Date.now() - recStartRef.current) / 1000);
        setRecElapsed(sec);
        if (sec >= MAX_REC_SECONDS) {
          // Auto-stop at the hard ceiling so we never blow past Whisper's
          // upload limit while the user is mid-thought.
          // eslint-disable-next-line @typescript-eslint/no-use-before-define
          stopVoiceBrief().catch(() => { /* ignore */ });
        }
      }, 250);
    } catch (e: any) {
      setRecState('idle');
      setError(e?.message || 'Could not start recording.');
    }
  };

  const cancelVoiceBrief = async () => {
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
    try { await recorder.stop(); } catch { /* ignore */ }
    setRecState('idle');
    setRecElapsed(0);
  };

  const stopVoiceBrief = async () => {
    if (recState !== 'recording') return;
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
    setRecState('transcribing');
    try {
      await recorder.stop();
      const uri = (recorder as any).uri as string | undefined;
      if (!uri) throw new Error('No recording captured. Try again.');

      // Fetch the recorded blob/file and POST it to whisper.
      // expo-audio gives a file:// URI on native and a blob: URI on web.
      const blobRes = await fetch(uri);
      const blob = await blobRes.blob();
      if (blob.size < 1024) {
        throw new Error('Recording too short. Press and hold to record at least 1 second.');
      }
      const filename = `voice-brief-${Date.now()}.m4a`;
      const file = new File([blob], filename, { type: blob.type || 'audio/m4a' });

      const fd = new FormData();
      fd.append('file', file as any);
      const { data } = await api.post('/estimate/transcribe-voice', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 90000,
      });
      const text = String(data?.text || '').trim();
      if (!text) {
        setError('We couldn\'t make out any speech. Try again in a quieter spot.');
        return;
      }
      // Append to existing goal so a second recording doesn't wipe what's
      // already there. Cap at MAX_GOAL.
      const combined = goal.trim()
        ? `${goal.trim()}\n\n${text}`
        : text;
      setGoal(combined.slice(0, MAX_GOAL));
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 503) {
        setError('Voice transcription is not configured. An admin must enable an LLM provider.');
      } else if (status === 422) {
        setError(e?.response?.data?.detail || 'We couldn\'t make out any speech in that clip.');
      } else {
        setError(e?.response?.data?.detail || e?.message || 'Transcription failed. Try again.');
      }
    } finally {
      setRecState('idle');
      setRecElapsed(0);
    }
  };

  const onVoicePress = () => {
    if (recState === 'recording') {
      stopVoiceBrief();
    } else if (recState === 'idle') {
      startVoiceBrief();
    }
    // 'transcribing' state: button is disabled, nothing to do.
  };

  const fmtRec = (sec: number) => {
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
  };


  const estimateProduct = async () => {
    if (busy) return;
    let g = goal.trim();
    // Inline URL flow — if the user pasted a URL into the main textarea
    // (alone, or with their own notes), we transparently route through
    // /api/estimate/analyze-url first to synthesize a brief, then feed the
    // combined text into /api/estimate. This means the 40-char minimum
    // doesn't fire when the user has a perfectly valid URL-based intent.
    const urlMatch = (g.match(URL_REGEX) || [])[0];
    const restAfterUrl = urlMatch ? g.replace(urlMatch, '').trim() : '';
    const userHasNotes = restAfterUrl.length >= 10;

    if (urlMatch && (g.length < MIN_GOAL || isGibberish(g) || userHasNotes)) {
      setBusy(true);
      setError('');
      try {
        const { data } = await api.post('/estimate/analyze-url', {
          url: urlMatch,
          surface: 'visitor',
          device: deviceHint,
        }, { timeout: 60000 });
        const briefText = String(data?.text || '').trim();
        const briefTitle = String(data?.title || '').trim();
        const finalUrl = String(data?.url || urlMatch).trim();
        const hostname = (() => {
          try { return new URL(finalUrl).hostname.replace(/^www\./, ''); }
          catch { return finalUrl; }
        })();
        if (briefText) {
          // Combine: user notes (if any) at the top — they signal priority
          // to the LLM — then the reference brief.
          g = userHasNotes
            ? `${restAfterUrl}\n\nReference (${finalUrl}):\n${briefText}`.slice(0, MAX_GOAL)
            : briefText.slice(0, MAX_GOAL);
          setGoal(g);
          setAttachment({ name: briefTitle || hostname, text: briefText });
          setSourceUrl(finalUrl);
          setSourceTitle(briefTitle || hostname);
        } else if (!userHasNotes) {
          // No brief came back AND no user notes — keep a raw URL hint so
          // /api/estimate at least has *something*.
          g = `Build a product similar to ${urlMatch}`;
        }
      } catch {
        // Graceful: if URL analysis fails AND user has no notes, surface
        // an actionable error instead of silently 40-char-blocking them.
        if (!userHasNotes) {
          setError('Could not analyze that link. Try again, or describe your idea in your own words.');
          setBusy(false);
          return;
        }
        g = restAfterUrl;  // fall back to whatever the user typed
      }
      setBusy(false);
      // intentional fallthrough — `g` is now ready for the standard guards
    }

    if (!urlMatch && (g.length < MIN_GOAL || isGibberish(g))) {
      setError('Please describe your product more fully. Minimum 40 characters, 5+ words — or paste a competitor link.');
      return;
    }
    setBusy(true);
    setError('');
    // Funnel: visitor passed validation and is committing. Fired BEFORE the
    // /api/estimate call so a slow / failing backend still counts as a
    // completed describe step — drop-off vs. failure is then visible as
    // `describe_completed > estimate_generated`.
    _logFunnelEvent('describe_completed', {
      goal_chars: g.length,
      mode,
      has_attachment: !!attachment,
      has_source_url: !!sourceUrl,
    });
    try {
      const body: any = { goal: g, mode };
      if (attachment) body.attachment = { name: attachment.name, text: attachment.text };
      // /api/estimate runs LLM clarity-check + decomposition. Realistic
      // backend wall-clock is 5-10s; cold provider or budget-throttled
      // retries can push it past the default 20s runtime timeout. 90s gives
      // headroom while still failing fast on a wedged backend.
      const { data } = await runtime.post<any>('/api/estimate', body, { timeoutMs: 90000 });
      // Funnel: estimate came back. Distinguish high/low-clarity paths so
      // we can tell if low-clarity is killing the funnel later.
      _logFunnelEvent('estimate_generated', {
        clarity: data?.clarity || 'unknown',
        mode,
      });
      if (data?.clarity === 'low') {
        router.push({
          pathname: '/estimate-improve',
          params: {
            goal: g, mode,
            message: data.message || '',
            suggestions: JSON.stringify(data.suggestions || []),
            sourceUrl: sourceUrl || '',
            sourceTitle: sourceTitle || '',
          },
        } as any);
        return;
      }
      router.push({
        pathname: '/estimate-result',
        params: {
          data: JSON.stringify(data),
          goal: g,
          mode,
          sourceUrl: sourceUrl || '',
          sourceTitle: sourceTitle || '',
        },
      } as any);
    } catch (e: any) {
      // Map machine errors to human narratives — never surface raw
      // `Request timed out after 20000ms` / axios stacks. Mirrors the
      // graceful-failure pattern already used by /estimate/analyze-url.
      let msg: string;
      let hint = '';
      if (e instanceof ApiError) {
        if (e.code === 'TIMEOUT') {
          msg = 'AI is taking longer than usual to plan this.';
          hint = 'Try again — usually the second attempt comes back in a few seconds.';
        } else if (e.code === 'NETWORK_ERROR') {
          msg = 'Lost connection while planning your product.';
          hint = 'Check your internet and retry.';
        } else if (e.code === 'RATE_LIMITED') {
          msg = 'We\'re briefly rate-limited. Try again in a moment.';
          hint = e.hint || '';
        } else {
          msg = e.message || 'Could not calculate. Try again.';
          hint = e.hint || '';
        }
      } else {
        msg = e?.response?.data?.message || e?.response?.data?.detail || e?.message || 'Could not calculate. Try again.';
        hint = e?.response?.data?.hint || '';
      }
      setError(hint ? `${msg}\n${hint}` : msg);
    } finally {
      setBusy(false);
    }
  };

  const goLogin = () => router.push('/auth?mode=login' as any);

  // ─── Funnel telemetry ───────────────────────────────────────────────────
  // Three load-bearing events for "where do people drop off?":
  //   • describe_opened     — page reached (any auth state)
  //   • describe_completed  — visitor passed gibberish check + clicked CTA
  //                            (fired immediately before /api/estimate)
  //   • estimate_generated  — backend returned a plan
  // Fire-and-forget — never blocks UX. Auth-free endpoint on backend.
  const _logFunnelEvent = (event: string, props?: Record<string, any>) => {
    try {
      api.post('/funnel/event', {
        event,
        surface: token ? 'authed' : 'visitor',
        device: deviceHint,
        props: props || {},
      }).catch(() => undefined);
    } catch { /* swallow */ }
  };

  const describeOpenedSent = useRef(false);
  useEffect(() => {
    if (describeOpenedSent.current) return;
    describeOpenedSent.current = true;
    _logFunnelEvent('describe_opened');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Splash gate — was previously blocking the visitor on Google Fonts +
  // /me + auth hydration. Funnel-integrity rewrite (May 17 2026):
  //   1. Never wait for Google Fonts — system-font fallback renders
  //      immediately, custom faces swap in on `fontsLoaded`. The describe
  //      surface is an INTENT capture surface, not a typography showcase.
  //   2. Never wait for /me — guests have no /me to wait on (useMe shortcuts
  //      on !token). Only block when we already know there is a token but
  //      haven't resolved it yet, so authed users don't flash the form
  //      they're about to be redirected away from.
  //   3. Auth hydration grace: even with a token, hold the splash at most
  //      1.5s — beyond that, render the page anyway (the redirect effect
  //      will still fire on its own when /me resolves).
  const [authGraceExpired, setAuthGraceExpired] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setAuthGraceExpired(true), 1500);
    return () => clearTimeout(id);
  }, []);
  const blockOnAuth = !!token && (authLoading || meLoading) && !authGraceExpired;

  if (blockOnAuth) {
    return (
      <View style={s.loading} testID="visitor-loading">
        <ActivityIndicator size="small" color={P.signal} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={s.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={s.container}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        testID="visitor-home"
      >
        {/* Self-contained brand mark — replaces the global AppHeader which
            is suppressed on visitor entrance surfaces. ALWAYS the canonical
            PNG — never text — so the wordmark cannot drift through refactors. */}
        <View
          style={{ marginBottom: 32, alignItems: 'flex-start' }}
          testID="visitor-brand"
        >
          <Image
            source={brandLogo}
            style={{ width: 140, height: 32 }}
            resizeMode="contain"
            accessibilityLabel="EVA-X"
          />
        </View>

        {/* Continuity strip — when user comes from /welcome.
            Demoted from glowing primary card to mono telemetry band. */}
        {cameFromWelcome && (
          <View style={s.continuity} testID="continuity-strip">
            <Text style={s.continuityEyebrow}>STEP 01 / 03</Text>
            <Text style={s.continuityTitle}>Let&apos;s build your product</Text>
            <Text style={s.continuitySub}>Describe your idea below ↓</Text>
          </View>
        )}
        {!cameFromWelcome && (
          <Text style={s.heroTitle}>Build products.{'\n'}Not tickets.</Text>
        )}
        <Text style={s.heroSub}>
          {cameFromWelcome
            ? 'A few sentences is enough. We turn it into a full product plan with modules, timeline, and price.'
            : 'Describe what you want. See the real plan in 30 seconds — no sign-up required.'}
        </Text>

        {/* Field eyebrow + character counter — mono telemetry */}
        <View style={s.eyebrowRow}>
          <Text style={s.eyebrow}>DESCRIBE YOUR PRODUCT</Text>
          <Text
            style={[
              s.charHint,
              isTooShort && goalLen > 0 && { color: P.textSecondary },
            ]}
          >
            {charHint}
          </Text>
        </View>

        {/* Textarea — warm institutional surface. Generous padding (16/14),
            substrate Layer 2 fill, subtle 1px border. NO glow on focus,
            NO heavy outline. The error state nudges the border to a quiet
            warm gray; it does NOT flip to red alarm. */}
        <TextInput
          testID="visitor-goal-input"
          style={[s.input, error && isTooShort ? s.inputError : null]}
          placeholder={'Describe your product, paste a reference link, or both. Example: "https://uber.com — but for freelance chefs in Eastern Europe, Stripe payouts, Russian + English."'}
          placeholderTextColor={P.textTertiary}
          value={goal}
          onChangeText={(v) => {
            const trimmed = v.length > MAX_GOAL ? v.slice(0, MAX_GOAL) : v;
            setGoal(trimmed);
            if (error) setError('');
          }}
          maxLength={MAX_GOAL}
          multiline
          textAlignVertical="top"
        />

        {/* Attachment row — institutional, mono label, no green.
            Two options live here side by side: attach a written brief, or
            record one. Voice button is the same mono-mass material as the
            file picker — equal weight, equal affordance. */}
        <View style={s.attachRow}>
          <TouchableOpacity
            testID="visitor-attach-btn"
            style={s.attachBtn}
            onPress={onPickFile}
            disabled={parsing || recState !== 'idle'}
            activeOpacity={0.7}
          >
            {parsing
              ? <ActivityIndicator size="small" color={P.textSecondary} />
              : <Text style={s.attachGlyph}>+</Text>}
            <Text style={s.attachText} numberOfLines={1} ellipsizeMode="middle">
              {parsing
                ? 'READING FILE…'
                : attachment
                  ? `ATTACHED · ${attachment.name.toUpperCase()}`
                  : 'ATTACH BRIEF'}
            </Text>
          </TouchableOpacity>
          {attachment && !parsing && (
            <TouchableOpacity
              testID="visitor-attach-clear"
              onPress={() => {
                setAttachment(null);
                setSourceUrl('');
                setSourceTitle('');
              }}
              hitSlop={8}
            >
              <Text style={s.attachClear}>×</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            testID="visitor-voice-btn"
            style={[
              s.voiceBtn,
              recState === 'recording' && s.voiceBtnActive,
              recState === 'transcribing' && s.voiceBtnBusy,
            ]}
            onPress={onVoicePress}
            disabled={parsing || recState === 'transcribing'}
            activeOpacity={0.7}
            accessibilityLabel={
              recState === 'recording'
                ? 'Stop recording and transcribe'
                : recState === 'transcribing'
                  ? 'Transcribing'
                  : 'Record voice brief'
            }
          >
            {recState === 'transcribing'
              ? <ActivityIndicator size="small" color={P.textSecondary} />
              : (
                <Text
                  style={[
                    s.voiceGlyph,
                    recState === 'recording' && { color: P.substrate },
                  ]}
                >
                  {recState === 'recording' ? '■' : '●'}
                </Text>
              )}
            <Text
              style={[
                s.voiceText,
                recState === 'recording' && { color: P.substrate },
              ]}
              numberOfLines={1}
            >
              {recState === 'recording'
                ? `REC · ${fmtRec(recElapsed)}`
                : recState === 'transcribing'
                  ? 'TRANSCRIBING…'
                  : 'VOICE'}
            </Text>
          </TouchableOpacity>
          {recState === 'recording' && (
            <TouchableOpacity
              testID="visitor-voice-cancel"
              onPress={cancelVoiceBrief}
              hitSlop={8}
              accessibilityLabel="Cancel recording"
            >
              <Text style={s.attachClear}>×</Text>
            </TouchableOpacity>
          )}
          {Platform.OS === 'web' && (
            // @ts-ignore — only exists on web
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.markdown,.pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.webp,.heic,.heif,.bmp,.gif,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,image/*"
              style={{ display: 'none' }}
              onChange={onFileChosen}
            />
          )}
        </View>

        {/* "Like this site →" entry point. Visitors very often arrive with
            a URL of a competitor or reference site and ask "make me one
            like this". A third equal-weight institutional affordance opens
            an inline URL field; result drops into the goal textarea, fully
            editable before /estimate. */}
        <View style={s.urlBlock}>
          <TouchableOpacity
            testID="visitor-url-btn"
            style={s.urlToggleBtn}
            onPress={() => {
              setUrlSheetOpen((v) => !v);
              if (error) setError('');
            }}
            disabled={urlBusy || parsing || recState !== 'idle'}
            activeOpacity={0.7}
          >
            <Text style={s.attachGlyph}>↗</Text>
            <Text style={s.attachText} numberOfLines={1}>
              {urlSheetOpen ? 'CANCEL · ANALYZE SITE' : 'ANALYZE A SITE LINK'}
            </Text>
          </TouchableOpacity>
          {urlSheetOpen && (
            <View style={s.urlSheet} testID="visitor-url-sheet">
              <Text style={s.urlHint}>
                Paste a competitor or reference URL. We&apos;ll fetch the page,
                identify features and complexity, and drop a brief here that
                you can edit before pricing.{'\n\n'}
                Tip: if you already wrote something in the main field above
                (e.g. &ldquo;but for the European market with Stripe payouts&rdquo;),
                we&apos;ll automatically combine your text with the link.
              </Text>
              <TextInput
                testID="visitor-url-input"
                style={s.urlInput}
                placeholder="https://example.com"
                placeholderTextColor={P.textTertiary}
                value={urlInput}
                onChangeText={setUrlInput}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={Platform.OS === 'web' ? 'default' : 'url'}
                editable={!urlBusy}
                onSubmitEditing={analyzeCompetitorUrl}
                returnKeyType="go"
              />
              <TouchableOpacity
                testID="visitor-url-submit"
                style={[s.urlSubmit, (!urlInput.trim() || urlBusy) && s.urlSubmitDisabled]}
                onPress={analyzeCompetitorUrl}
                disabled={!urlInput.trim() || urlBusy}
                activeOpacity={0.8}
              >
                {urlBusy
                  ? <ActivityIndicator size="small" color={P.substrate} />
                  : <Text style={s.urlSubmitText}>{goal.trim().length >= 10 ? 'ANALYZE + COMBINE' : 'ANALYZE'}</Text>}
              </TouchableOpacity>
            </View>
          )}
        </View>


        {/* Autosave / analyzing signal — quiet mono telemetry. The dot is
            tertiary while the user is still typing (system is observing,
            not asserting) and shifts to sage when input is plan-ready.
            NO pulse, NO animation — institutional background calm. */}
        {!error && goalLen > 0 && (
          <View style={s.analyzingRow} testID="visitor-analyzing">
            <View
              style={[
                s.signalDot,
                { backgroundColor: isTooShort ? P.textTertiary : P.signal },
              ]}
            />
            <Text style={s.analyzingText}>
              {isTooShort ? 'ANALYZING · KEEP DESCRIBING' : 'READY TO PLAN'}
            </Text>
          </View>
        )}

        {/* Error state — quiet seriousness, NOT alarm. Single mono
            `ERR ·` prefix + primary text. No red bg, no icon, no border. */}
        {error ? (
          <View style={s.errorRow} testID="visitor-error">
            <Text style={s.errorPrefix}>ERR ·</Text>
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Section header — production methods */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Choose how we build your product</Text>
          <Text style={s.sectionSub}>
            All options deliver the full product. The difference is speed,
            cost, and reliability.
          </Text>
        </View>

        {/* Mode cards — neutral substrate, sage signal on active only.
            Per-mode marketing colors intentionally NOT rendered. Identity
            comes from typography + state, not chromatic tier. */}
        {MODES.map((m) => {
          const active = mode === m.id;
          return (
            <Pressable
              key={m.id}
              testID={`visitor-mode-${m.id}`}
              onPress={() => setMode(m.id)}
              style={[s.modeCard, active && s.modeCardActive]}
            >
              {m.popular && (
                <Text style={s.modePopular}>// RECOMMENDED</Text>
              )}
              <View style={s.modeHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.modeLabel}>{m.label}</Text>
                  <Text style={s.modeHeadline}>{m.headline}</Text>
                </View>
                <Text
                  style={[
                    s.modeStateMark,
                    active ? { color: P.signal } : { color: P.textTertiary },
                  ]}
                >
                  {active ? '●' : '○'}
                </Text>
              </View>
              <View style={s.modeBullets}>
                {m.bullets.map((b, i) => (
                  <View key={i} style={s.modeBulletRow}>
                    <View style={s.modeBulletBar} />
                    <Text style={s.modeBulletText}>{b}</Text>
                  </View>
                ))}
              </View>
            </Pressable>
          );
        })}

        {/* Footer — reinforce "same product" */}
        <Text style={s.sameProductNote}>
          Same product scope across all three options. You're choosing the
          build method, not the feature set.
        </Text>

        {/* Primary CTA — shared GravityCTA. Busy state shifts label to
            "PLANNING…" with mono marker, never spins, never pulses. */}
        <View style={s.ctaBlock}>
          <GravityCTA
            testID="visitor-start-cta"
            label="See my product plan"
            busyLabel="Planning…"
            onPress={estimateProduct}
            disabled={isTooShort}
            busy={busy}
          />
          <Text style={s.ctaHint}>
            REAL PLAN &amp; PRICE · NO SIGN-UP · 30 SECONDS
          </Text>
        </View>

        {/* Tiny login link */}
        <TouchableOpacity
          testID="visitor-login-link"
          onPress={goLogin}
          style={s.loginLink}
        >
          <View style={s.loginRow}>
            <Text style={s.loginText}>Already have an account?</Text>
            <Text style={s.loginAction}>Log in</Text>
          </View>
        </TouchableOpacity>

        {/* Developer entry — separate institutional surface, no green CTA */}
        <View style={s.devDivider} />
        <View style={s.devCard} testID="visitor-dev-card">
          <Text style={s.devCardEyebrow}>FOR DEVELOPERS</Text>
          <Text style={s.devCardTitle}>
            Join the team building real client products
          </Text>
          <Text style={s.devCardSub}>
            Open tasks, performance tracking, payouts, and growth — all in
            one workspace.
          </Text>
          <TouchableOpacity
            testID="visitor-developer-cta"
            style={s.devCta}
            onPress={() => router.push('/auth?intent=developer' as any)}
            activeOpacity={0.8}
          >
            <Text style={s.devCtaText}>Join as developer</Text>
            <Text style={s.devCtaMarker}>→</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (P: Palette) => StyleSheet.create({
  flex: { flex: 1, backgroundColor: P.substrate },
  container: { flex: 1, backgroundColor: P.substrate },
  content: { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 80 },
  loading: {
    flex: 1,
    backgroundColor: P.substrate,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Continuity strip — mono telemetry band, NOT a glowing primary card */
  continuity: {
    marginHorizontal: -24,
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: P.operational,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: P.borderSubtle,
    marginBottom: 24,
  },
  continuityEyebrow: {
    fontFamily: F.mono,
    fontSize: 10,
    color: P.signal,
    letterSpacing: 1,
    marginBottom: 8,
  },
  continuityTitle: {
    fontFamily: F.sansMedium,
    fontSize: 22,
    color: P.textPrimary,
    lineHeight: 28,
    letterSpacing: -0.4,
  },
  continuitySub: {
    fontFamily: F.sans,
    fontSize: 13,
    color: P.textSecondary,
    marginTop: 6,
  },

  /* Hero — RELAXED from landing's 42px. Input flow is cognition under
     interaction, not declaration. Less rhetorical gravity. */
  heroTitle: {
    fontFamily: F.sansMedium,
    fontSize: 28,
    color: P.textPrimary,
    lineHeight: 32,
    letterSpacing: -0.6,
    marginTop: 8,
  },
  heroSub: {
    fontFamily: F.sans,
    fontSize: 15,
    color: P.textSecondary,
    lineHeight: 22,
    marginTop: 14,
    maxWidth: '95%',
  },

  /* Eyebrow + char hint — twin mono telemetry lines */
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 36,
    marginBottom: 10,
  },
  eyebrow: {
    fontFamily: F.mono,
    fontSize: 10,
    color: P.textTertiary,
    letterSpacing: 1,
  },
  charHint: {
    fontFamily: F.mono,
    fontSize: 10,
    color: P.textTertiary,
    letterSpacing: 0.5,
  },

  /* Textarea — warm institutional surface */
  input: {
    backgroundColor: P.operational,
    borderWidth: 1,
    borderColor: P.borderSubtle,
    borderRadius: 4,
    color: P.textPrimary,
    fontFamily: F.sans,
    fontSize: 15,
    lineHeight: 22,
    padding: 16,
    minHeight: 132,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  },
  inputError: {
    // Quiet seriousness — NOT a red alarm. A slightly contrasted border
    // tells the user "this surface noticed something" without panicking.
    borderColor: P.borderContrast,
  },

  /* Attach row — mono label, no icons */
  attachRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  attachBtn: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: P.borderSubtle,
    borderRadius: 4,
    backgroundColor: P.operational,
  },
  attachGlyph: {
    fontFamily: F.mono,
    fontSize: 14,
    color: P.textSecondary,
    width: 14,
    textAlign: 'center',
  },
  attachText: {
    flex: 1,
    fontFamily: F.mono,
    fontSize: 10,
    color: P.textSecondary,
    letterSpacing: 0.8,
  },
  attachClear: {
    fontFamily: F.mono,
    fontSize: 16,
    color: P.textTertiary,
    paddingHorizontal: 4,
  },
  voiceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: P.borderSubtle,
    borderRadius: 4,
    backgroundColor: P.operational,
    minWidth: 96,
  },
  voiceBtnActive: {
    backgroundColor: P.textPrimary,
    borderColor: P.textPrimary,
  },
  voiceBtnBusy: {
    opacity: 0.7,
  },
  voiceGlyph: {
    fontFamily: F.mono,
    fontSize: 12,
    color: P.textSecondary,
    width: 12,
    textAlign: 'center',
  },
  voiceText: {
    fontFamily: F.mono,
    fontSize: 10,
    color: P.textSecondary,
    letterSpacing: 0.8,
  },

  /* URL analyze block — same institutional weight as attach / voice.
     Collapsed by default; expanded into a small panel with input + CTA. */
  urlBlock: {
    marginTop: 8,
  },
  urlToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: P.borderSubtle,
    borderRadius: 4,
    backgroundColor: P.operational,
  },
  urlSheet: {
    marginTop: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: P.borderSubtle,
    borderRadius: 4,
    backgroundColor: P.operational,
    gap: 10,
  },
  urlHint: {
    fontFamily: F.sans,
    fontSize: 12,
    color: P.textSecondary,
    lineHeight: 18,
  },
  urlInput: {
    backgroundColor: P.substrate,
    borderWidth: 1,
    borderColor: P.borderSubtle,
    borderRadius: 4,
    color: P.textPrimary,
    fontFamily: F.mono,
    fontSize: 13,
    paddingVertical: 10,
    paddingHorizontal: 12,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  },
  urlSubmit: {
    alignSelf: 'flex-start',
    paddingVertical: 9,
    paddingHorizontal: 18,
    backgroundColor: P.textPrimary,
    borderRadius: 4,
  },
  urlSubmitDisabled: {
    opacity: 0.4,
  },
  urlSubmitText: {
    fontFamily: F.mono,
    fontSize: 11,
    color: P.substrate,
    letterSpacing: 1,
  },

  /* Autosave / analyzing — mono telemetry, no animation */
  analyzingRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  signalDot: {
    width: 6,
    height: 6,
    backgroundColor: P.signal,
  },
  analyzingText: {
    fontFamily: F.mono,
    fontSize: 10,
    color: P.textSecondary,
    letterSpacing: 0.8,
  },

  /* Error state — quiet seriousness, NOT alarm */
  errorRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  errorPrefix: {
    fontFamily: F.mono,
    fontSize: 11,
    color: P.textPrimary,
    letterSpacing: 0.8,
    paddingTop: 1,
  },
  errorText: {
    flex: 1,
    fontFamily: F.sans,
    fontSize: 13,
    color: P.textPrimary,
    lineHeight: 20,
  },

  /* Section header — utilitarian, not declaration */
  sectionHeader: { marginTop: 44, marginBottom: 16 },
  sectionTitle: {
    fontFamily: F.sansMedium,
    fontSize: 20,
    color: P.textPrimary,
    lineHeight: 26,
    letterSpacing: -0.3,
  },
  sectionSub: {
    fontFamily: F.sans,
    fontSize: 13,
    color: P.textSecondary,
    lineHeight: 20,
    marginTop: 6,
  },

  /* Mode cards — neutral substrate, sage on active only */
  modeCard: {
    backgroundColor: P.operational,
    borderWidth: 1,
    borderColor: P.borderSubtle,
    borderRadius: 4,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginTop: 10,
  },
  modeCardActive: {
    borderColor: P.signalBorder,
    backgroundColor: P.signalBgSub,
  },
  modePopular: {
    fontFamily: F.mono,
    fontSize: 9,
    color: P.signal,
    letterSpacing: 1,
    marginBottom: 8,
  },
  modeHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  modeLabel: {
    fontFamily: F.sansMedium,
    fontSize: 16,
    color: P.textPrimary,
    letterSpacing: -0.2,
  },
  modeHeadline: {
    fontFamily: F.sans,
    fontSize: 12,
    color: P.textSecondary,
    marginTop: 3,
  },
  modeStateMark: {
    fontFamily: F.mono,
    fontSize: 14,
    lineHeight: 18,
    paddingTop: 1,
  },
  modeBullets: { marginTop: 12, gap: 6 },
  modeBulletRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modeBulletBar: {
    width: 1,
    height: 8,
    backgroundColor: P.textTertiary,
  },
  modeBulletText: {
    fontFamily: F.sans,
    fontSize: 13,
    color: P.textSecondary,
    lineHeight: 18,
  },

  sameProductNote: {
    fontFamily: F.sans,
    fontSize: 12,
    color: P.textTertiary,
    marginTop: 18,
    textAlign: 'center',
    lineHeight: 18,
    fontStyle: 'italic',
  },

  /* CTA block — generous negative space above and below */
  ctaBlock: { marginTop: 36, alignItems: 'center' },
  ctaHint: {
    fontFamily: F.mono,
    fontSize: 10,
    color: P.textTertiary,
    letterSpacing: 1,
    marginTop: 14,
    textAlign: 'center',
  },

  /* Login link */
  loginLink: { marginTop: 32, alignItems: 'center', paddingVertical: 8 },
  loginRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
  },
  loginText: {
    fontFamily: F.sans,
    fontSize: 13,
    color: P.textSecondary,
  },
  loginAction: {
    fontFamily: F.sansMedium,
    color: P.textPrimary,
  },

  /* Dev card — institutional secondary track */
  devDivider: {
    height: 1,
    backgroundColor: P.borderSubtle,
    marginTop: 40,
    marginBottom: 32,
    marginHorizontal: -24,
  },
  devCard: {
    backgroundColor: P.operational,
    borderWidth: 1,
    borderColor: P.borderSubtle,
    borderRadius: 4,
    padding: 20,
  },
  devCardEyebrow: {
    fontFamily: F.mono,
    fontSize: 10,
    color: P.textTertiary,
    letterSpacing: 1,
    marginBottom: 10,
  },
  devCardTitle: {
    fontFamily: F.sansMedium,
    fontSize: 18,
    color: P.textPrimary,
    lineHeight: 24,
    letterSpacing: -0.3,
  },
  devCardSub: {
    fontFamily: F.sans,
    fontSize: 13,
    color: P.textSecondary,
    marginTop: 8,
    lineHeight: 20,
  },
  devCta: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: P.borderContrast,
    borderRadius: 4,
    backgroundColor: P.focus,
  },
  devCtaText: {
    fontFamily: F.sansMedium,
    fontSize: 14,
    color: P.textPrimary,
  },
  devCtaMarker: {
    fontFamily: F.mono,
    fontSize: 14,
    color: P.textPrimary,
  },
});
