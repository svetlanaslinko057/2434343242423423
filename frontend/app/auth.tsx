import { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../src/auth';
import { track } from '../src/metrics';
import api from '../src/api';
import { resolveUserEntry } from '../src/resolve-entry';
import { syncPushTokenWithServer } from '../src/push';
import T from '../src/theme';

/**
 * Auth — NOT "Sign in". "Continue to your product."
 *
 * Default flow (client intent): email-code (OTP). Zero friction.
 *   1. step=email:    enter email → Continue
 *   2. step=code:     we send a 6-digit code → Verify & continue
 *                     (or tap "Use password instead" to fall back)
 *   3. step=password: classic email+password with 👁 eye toggle
 *
 * Developer intent (?intent=developer) keeps the old flow — devs aren't in
 * the lead funnel.
 *
 * Post-auth: if `atlas_pending_lead_id` is in AsyncStorage (set by
 * estimate-result), claim the lead and redirect to /workspace/<new_project>.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function extractErrorMessage(e: any, fallback = 'Auth failed'): string {
  const status = e?.response?.status;
  const detail = e?.response?.data?.detail;
  // A 403 here almost always means the stale pending-lead belongs to a
  // different email — we clear it in afterAuth, but we should never let that
  // low-level error surface on the login screen. Present a clean message.
  if (status === 403 && typeof detail === 'string' && /lead/i.test(detail)) {
    return 'Could not link previous estimate to this email — signed in successfully.';
  }
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const msgs = detail.map((d: any) => (typeof d === 'string' ? d : d?.msg)).filter(Boolean);
    if (msgs.length) return msgs.join(', ');
  }
  if (detail && typeof detail === 'object' && typeof detail.msg === 'string') return detail.msg;
  if (typeof e?.message === 'string') {
    // Replace cryptic axios default. Leave real messages alone.
    if (/Request failed with status code/i.test(e.message)) {
      return status ? `Something went wrong (code ${status}). Try again.` : 'Something went wrong. Try again.';
    }
    return e.message;
  }
  return fallback;
}

type Step = 'email' | 'code' | 'password';

export default function AuthScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ intent?: string; email?: string; lead_id?: string; mode?: string }>();
  const { login, register, verifyCode } = useAuth();

  const intent = (params.intent as string) || '';
  const isDeveloperIntent = intent === 'developer';
  // mode=login → user explicitly clicked "Log in" (has an account). Prefer
  // password flow over OTP — they came here to sign in, not to receive a code.
  const isLoginMode = (params.mode as string) === 'login';
  const prefillEmail = (params.email as string) || '';
  const prefillLeadId = (params.lead_id as string) || '';

  // Persist the lead id the moment auth is opened with it.
  useEffect(() => {
    if (prefillLeadId) AsyncStorage.setItem('atlas_pending_lead_id', prefillLeadId).catch(() => {});
  }, [prefillLeadId]);

  // ───── form state ─────
  // mode=login → caller explicitly came to "sign in", default to password
  //   step the moment we have an email (skip OTP entirely).
  // No mode + prefillEmail (from /lead/workspace) → OTP (zero-friction onboarding).
  // No mode + no prefill → start at email step.
  const initialStep: Step = isLoginMode
    ? 'email'
    : prefillEmail ? 'code' : 'email';
  const [step, setStep] = useState<Step>(initialStep);
  const [email, setEmail] = useState(prefillEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [isExistingUser, setIsExistingUser] = useState<boolean | null>(null);

  // ───── async state ─────
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null); // shown in DEV mode
  const [cooldown, setCooldown] = useState(0);

  const emailClean = email.trim().toLowerCase();
  const emailValid = EMAIL_RE.test(emailClean);
  const codeClean = code.replace(/\D+/g, '').slice(0, 6);
  const pwLen = password.length;
  const pwWeak = pwLen > 0 && pwLen < 6;

  // Auto-send code + probe /auth/exists the first time we land on step=code
  // with a prefilled email (coming from /lead/workspace).
  useEffect(() => {
    if (step !== 'code') return;
    if (!emailValid) return;
    if (devCode || busy) return;
    // Fire the initial send once per email.
    (async () => { await sendCode(true); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, emailValid]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((v) => Math.max(0, v - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const title = useMemo(() => {
    if (isDeveloperIntent) return step === 'email' ? 'Join as developer' : 'Continue to developer portal';
    if (isLoginMode) return 'Welcome back';
    return 'Continue to your product';
  }, [step, isDeveloperIntent, isLoginMode]);

  const subtitle = useMemo(() => {
    if (step === 'email') {
      return isLoginMode
        ? 'Sign in with your email and password.'
        : 'Just your email — no password required.';
    }
    if (step === 'code') return `We sent a 6-digit code to ${emailClean}`;
    return isExistingUser === false
      ? 'One more step and your workspace is live.'
      : 'Welcome back.';
  }, [step, emailClean, isExistingUser, isLoginMode]);

  // ────────────── actions ──────────────

  const continueWithEmail = async () => {
    setError('');
    if (!emailValid) { setError('Enter a valid email, e.g. you@company.com'); return; }
    // Pre-probe existence so we can route to the right next step.
    let exists: boolean | null = null;
    try {
      const r = await api.get(`/auth/exists?email=${encodeURIComponent(emailClean)}`);
      exists = Boolean(r.data?.exists);
      setIsExistingUser(exists);
    } catch { setIsExistingUser(null); }

    // Routing decision:
    //  - explicit login mode → password (user came to sign in)
    //  - existing user (any entry path) → password (they likely know it)
    //  - new user → OTP (zero-friction onboarding)
    //  - unknown (probe failed) → OTP fallback (preserves legacy behaviour)
    if (isLoginMode || exists === true) {
      setStep('password');
    } else {
      setStep('code');
    }
  };

  const sendCode = async (silent = false) => {
    setError('');
    setBusy(true);
    try {
      const r = await api.post('/auth/send-code', { email: emailClean });
      setDevCode(r.data?.dev_code || null);
      setIsExistingUser(r.data?.is_new_user === false);
      setCooldown(30);
    } catch (e: any) {
      if (!silent) setError(extractErrorMessage(e, 'Could not send code'));
    } finally { setBusy(false); }
  };

  const submitCode = async () => {
    setError('');
    if (codeClean.length !== 6) { setError('Enter the 6-digit code'); return; }
    setBusy(true);
    try {
      await verifyCode(emailClean, codeClean, name.trim() || undefined);
      await afterAuth();
    } catch (e: any) {
      setError(extractErrorMessage(e, 'Could not verify code'));
    } finally { setBusy(false); }
  };

  const submitPassword = async () => {
    setError('');
    if (pwWeak) { setError('Use at least 6 characters'); return; }
    if (isExistingUser === false && !name.trim()) { setError('What should we call you?'); return; }
    setBusy(true);
    try {
      if (isExistingUser) {
        await login(emailClean, password);
      } else {
        try {
          await register(emailClean, password, name.trim() || emailClean.split('@')[0], []);
        } catch (e: any) {
          // If register said "already exists", login can still trigger 2FA —
          // bubble that case up to the outer handler.
          if (e?.requires_2fa) throw e;
          const msg = extractErrorMessage(e, '').toLowerCase();
          if (msg.includes('exist') || msg.includes('already')) {
            await login(emailClean, password);
          } else { throw e; }
        }
      }
      await afterAuth();
    } catch (e: any) {
      // 2FA gate — route to the challenge screen with the token in tow.
      if (e?.requires_2fa && e?.challenge_token) {
        setBusy(false);
        router.replace({
          pathname: '/two-factor-challenge' as any,
          params: { challenge_token: e.challenge_token, email: emailClean },
        });
        return;
      }
      setError(extractErrorMessage(e, 'Auth failed'));
    } finally { setBusy(false); }
  };

  const afterAuth = async () => {
    void syncPushTokenWithServer();
    if (isDeveloperIntent) {
      // Dev intent path: enroll as developer and go straight to the dev
      // cabinet. We deliberately SKIP the lead-claim step — claiming a
      // product-estimate lead creates a client-owned project and would
      // route the user into `/workspace/{id}` (a client surface). A dev
      // signing up should land on the dev home, not be converted to a
      // client via a stale pre-auth estimate.
      try { await api.post('/developer/apply'); } catch { /* non-fatal */ }
      try { await AsyncStorage.removeItem('atlas_pending_lead_id'); } catch { /* ignore */ }
      router.replace('/developer/home' as any);
      return;
    }
    try {
      const leadId = await AsyncStorage.getItem('atlas_pending_lead_id');
      if (leadId) {
        try {
          const cr = await api.post(`/leads/${leadId}/claim`);
          await AsyncStorage.removeItem('atlas_pending_lead_id');
          router.replace(`/workspace/${cr.data.project_id}` as any);
          return;
        } catch {
          // Stale lead (different email, already claimed, etc). Clear and
          // fall through to normal routing — we signed in successfully.
          await AsyncStorage.removeItem('atlas_pending_lead_id');
        }
      }
    } catch { /* ignore */ }
    try {
      const r = await api.get('/me');
      router.replace(resolveUserEntry(r.data) as any);
    } catch { router.replace('/'); }
  };

  // ────────────── render ──────────────

  return (
    <KeyboardAvoidingView
      style={s.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.subtitle}>{subtitle}</Text>

          {isDeveloperIntent && step === 'email' && (
            <Text style={s.intentHint} testID="auth-intent-hint">
              Open tasks · performance tracking · payouts · growth
            </Text>
          )}

          {/* ============ STEP: email ============ */}
          {step === 'email' && (
            <>
              <Text style={s.label}>EMAIL</Text>
              <TextInput
                testID="auth-email-input"
                style={s.input}
                placeholder="you@company.com"
                placeholderTextColor={T.textMuted}
                value={email}
                onChangeText={(v) => { setEmail(v); if (error) setError(''); }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoFocus
                onSubmitEditing={continueWithEmail}
                returnKeyType="next"
              />
              {error ? <Text style={s.error}>{error}</Text> : null}

              <TouchableOpacity
                testID="auth-continue-btn"
                style={[s.btn, (!emailValid || busy) && s.btnDisabled]}
                onPress={continueWithEmail}
                disabled={!emailValid || busy}
              >
                {busy ? <ActivityIndicator color={T.bg} /> : <Text style={s.btnText}>Continue</Text>}
              </TouchableOpacity>
            </>
          )}

          {/* ============ STEP: code (email OTP — default) ============ */}
          {step === 'code' && (
            <>
              <View style={s.emailLockRow}>
                <View style={s.emailLockInfo}>
                  <Text style={s.emailLockLabel}>EMAIL</Text>
                  <Text style={s.emailLockValue}>{emailClean}</Text>
                </View>
                <TouchableOpacity
                  testID="auth-change-email"
                  onPress={() => { setStep('email'); setCode(''); setDevCode(null); setError(''); }}
                  style={s.changeBtn}
                >
                  <Text style={s.changeBtnText}>Change</Text>
                </TouchableOpacity>
              </View>

              {/* DEV banner — only shown when backend is in DEV mode
                  (no email delivery wired yet). Tap to auto-fill the input. */}
              {devCode && (
                <TouchableOpacity
                  testID="auth-dev-code-banner"
                  onPress={() => { setCode(devCode); setError(''); }}
                  activeOpacity={0.7}
                  style={s.devBanner}
                >
                  <Ionicons name="information-circle-outline" size={14} color={T.warning} />
                  <Text style={s.devBannerText}>
                    DEV mode — tap to use code{' '}
                    <Text style={s.devBannerCode}>{devCode}</Text>
                  </Text>
                </TouchableOpacity>
              )}

              <Text style={s.label}>6-DIGIT CODE</Text>
              <TextInput
                testID="auth-code-input"
                style={[s.input, s.codeInput]}
                placeholder="000000"
                placeholderTextColor={T.textMuted}
                value={code}
                onChangeText={(v) => { setCode(v.replace(/\D+/g, '').slice(0, 6)); if (error) setError(''); }}
                keyboardType="number-pad"
                autoFocus
                maxLength={6}
                onSubmitEditing={submitCode}
                returnKeyType="go"
              />

              {/* New users — let them tell us their name now */}
              {isExistingUser === false && (
                <>
                  <Text style={s.label}>YOUR NAME (optional)</Text>
                  <TextInput
                    testID="auth-name-input"
                    style={s.input}
                    placeholder="Your name"
                    placeholderTextColor={T.textMuted}
                    value={name}
                    onChangeText={(v) => { setName(v); if (error) setError(''); }}
                    autoCapitalize="words"
                  />
                </>
              )}

              {error ? <Text style={s.error}>{error}</Text> : null}

              <TouchableOpacity
                testID="auth-verify-btn"
                style={[s.btn, (codeClean.length !== 6 || busy) && s.btnDisabled]}
                onPress={submitCode}
                disabled={codeClean.length !== 6 || busy}
              >
                {busy ? <ActivityIndicator color={T.bg} /> : (
                  <Text style={s.btnText}>Verify & continue →</Text>
                )}
              </TouchableOpacity>

              <View style={s.belowRow}>
                <TouchableOpacity
                  testID="auth-resend-code"
                  onPress={() => sendCode(false)}
                  disabled={cooldown > 0 || busy}
                >
                  <Text style={[s.smallLink, (cooldown > 0 || busy) && s.linkDisabled]}>
                    {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="auth-use-password"
                  onPress={() => { setStep('password'); setError(''); }}
                >
                  <Text style={s.smallLink}>Use password instead</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* ============ STEP: password (fallback) ============ */}
          {step === 'password' && (
            <>
              <View style={s.emailLockRow}>
                <View style={s.emailLockInfo}>
                  <Text style={s.emailLockLabel}>EMAIL</Text>
                  <Text style={s.emailLockValue}>{emailClean}</Text>
                </View>
                <TouchableOpacity
                  testID="auth-change-email"
                  onPress={() => { setStep('email'); setPassword(''); setError(''); setIsExistingUser(null); }}
                  style={s.changeBtn}
                >
                  <Text style={s.changeBtnText}>Change</Text>
                </TouchableOpacity>
              </View>

              {isExistingUser === false && (
                <>
                  <Text style={s.label}>YOUR NAME</Text>
                  <TextInput
                    testID="auth-name-input"
                    style={s.input}
                    placeholder="Your name"
                    placeholderTextColor={T.textMuted}
                    value={name}
                    onChangeText={(v) => { setName(v); if (error) setError(''); }}
                    autoCapitalize="words"
                  />
                </>
              )}

              <Text style={s.label}>PASSWORD</Text>
              <View style={s.pwWrap}>
                {Platform.OS === 'web' && (
                  // Hide browser-native password reveal eye (Edge ::-ms-reveal,
                  // Chrome credentials autofill button) so only our custom toggle shows.
                  // eslint-disable-next-line react/no-danger
                  // @ts-ignore — web-only style tag
                  <style dangerouslySetInnerHTML={{ __html: `
                    input[type=password]::-ms-reveal,
                    input[type=password]::-ms-clear { display: none !important; }
                    input[type=password]::-webkit-credentials-auto-fill-button,
                    input[type=password]::-webkit-strong-password-auto-fill-button { visibility: hidden !important; display: none !important; }
                  ` }} />
                )}
                <TextInput
                  testID="auth-password-input"
                  style={s.pwInput}
                  placeholder="At least 6 characters"
                  placeholderTextColor={T.textMuted}
                  value={password}
                  onChangeText={(v) => { setPassword(v); if (error) setError(''); }}
                  secureTextEntry={!showPassword}
                  autoFocus
                  onSubmitEditing={submitPassword}
                  returnKeyType="go"
                />
                <TouchableOpacity
                  testID="auth-password-toggle"
                  style={s.eyeBtn}
                  onPress={() => setShowPassword((v) => !v)}
                  activeOpacity={0.7}
                  hitSlop={8}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={22}
                    color={showPassword ? T.primary : T.text}
                  />
                </TouchableOpacity>
              </View>
              <Text style={[s.hint, pwWeak ? { color: T.danger } : null]}>min 6 chars</Text>

              {error ? <Text style={s.error}>{error}</Text> : null}

              <TouchableOpacity
                testID="auth-submit-btn"
                style={[s.btn, (pwWeak || busy) && s.btnDisabled]}
                onPress={submitPassword}
                disabled={pwWeak || busy}
              >
                {busy ? <ActivityIndicator color={T.bg} /> : (
                  <Text style={s.btnText}>
                    {isExistingUser === false ? 'Create account & continue' : 'Continue to your product'}
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                testID="auth-back-to-code"
                style={s.belowCenterRow}
                onPress={() => { setStep('code'); setError(''); }}
              >
                <Text style={s.smallLink}>← Use email code instead</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <Text style={s.footerNote}>
          Build products. Not tickets.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: T.bg },
  container: { flexGrow: 1, padding: T.lg, justifyContent: 'center' },

  card: {
    backgroundColor: T.surface1,
    borderRadius: T.radiusLg,
    padding: T.lg,
    borderWidth: 1,
    borderColor: T.border,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
  },
  title: { fontSize: T.h2, fontWeight: '800', color: T.text, textAlign: 'center' },
  subtitle: { color: T.textMuted, fontSize: T.small, textAlign: 'center', marginTop: 6, marginBottom: T.lg, lineHeight: 18 },
  intentHint: {
    color: T.textMuted, fontSize: T.tiny,
    textAlign: 'center', marginTop: -T.md + 2, marginBottom: T.lg,
    letterSpacing: 0.3,
  },

  label: {
    color: T.textMuted, fontSize: 10, fontWeight: '800',
    letterSpacing: 2, marginBottom: 6, marginTop: T.xs,
  },

  input: {
    backgroundColor: T.surface2, borderRadius: T.radiusSm,
    padding: 14, color: T.text, fontSize: T.body,
    marginBottom: T.md,
    borderWidth: 1, borderColor: T.border,
  },
  codeInput: {
    fontSize: 28, fontWeight: '700',
    letterSpacing: 8, textAlign: 'center',
    paddingVertical: 16,
  },

  pwWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: T.surface2, borderRadius: T.radiusSm,
    borderWidth: 1, borderColor: T.border,
    overflow: 'hidden',
    paddingRight: 6,
  },
  pwInput: {
    flex: 1, paddingHorizontal: 14, paddingVertical: 14,
    paddingRight: 4,                  // keep text from sliding under the eye
    color: T.text, fontSize: T.body,
    // @ts-ignore — web only: убираем дефолтную обводку браузера на focus,
    // иначе она рисует «двойной бордер» снаружи нашей рамки (см. скрин юзера).
    outlineStyle: 'none',
    outlineWidth: 0,
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  eyeBtn: {
    width: 36, height: 36,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: T.radiusSm,
    marginRight: 4,                   // visible inset from the right border
  },

  hint: { color: T.textMuted, fontSize: T.tiny, marginTop: 4, marginBottom: T.sm, marginLeft: 4 },

  btn: {
    backgroundColor: T.primary, borderRadius: T.radiusSm,
    padding: 16, alignItems: 'center',
    marginTop: T.sm,
  },
  btnText: { color: T.bg, fontWeight: '800', fontSize: T.body, letterSpacing: 0.3 },
  btnDisabled: { opacity: 0.5 },

  demoBtn: {
    backgroundColor: T.surface2, borderRadius: T.radiusSm,
    padding: 14, alignItems: 'center',
    marginTop: T.md,
    borderWidth: 1, borderColor: T.primary,
  },
  demoBtnText: { color: T.primary, fontWeight: '700', fontSize: T.body },

  error: { color: T.danger, fontSize: T.small, textAlign: 'center', marginBottom: T.sm, marginTop: -T.xs },

  emailLockRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: T.sm, paddingHorizontal: T.md,
    borderRadius: T.radiusSm,
    borderWidth: 1, borderColor: T.border,
    backgroundColor: T.surface2,
    marginBottom: T.md,
  },
  emailLockInfo: { flex: 1 },
  emailLockLabel: { color: T.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  emailLockValue: { color: T.text, fontSize: T.small, fontWeight: '600', marginTop: 2 },
  changeBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  changeBtnText: { color: T.primary, fontSize: T.small, fontWeight: '700' },

  devBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: T.md,
    borderRadius: T.radiusSm,
    backgroundColor: '#F59E0B15', borderWidth: 1, borderColor: '#F59E0B55',
    marginBottom: T.md,
  },
  devBannerText: { color: T.warning, fontSize: T.tiny, flex: 1 },
  devBannerCode: { fontWeight: '800', fontSize: T.small, letterSpacing: 2 },

  belowRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    flexWrap: 'wrap', gap: 12,
    marginTop: T.md, paddingHorizontal: 2,
  },
  belowCenterRow: { marginTop: T.md, alignItems: 'center' },
  smallLink: { color: T.primary, fontSize: T.small, fontWeight: '600' },
  linkDisabled: { color: T.textMuted, fontWeight: '400' },

  footerNote: {
    color: T.textMuted, fontSize: T.tiny, opacity: 0.6,
    textAlign: 'center', marginTop: T.lg, letterSpacing: 0.3,
  },
});
