// AuthGate — just-in-time auth modal.
//
// Flow (matches the production architecture spec):
//   1. App lets user wander (anonymous reads, anonymous wizard, anonymous chat
//      reads). When the user attempts a *protected* action (send a message,
//      approve, pay) the caller wraps it with `requireAuth(action)`.
//   2. If a session exists, the action fires immediately.
//   3. Otherwise this modal slides up: email → 6-digit code → on success the
//      original action is auto-replayed and the modal closes.
//
// State of the user (anonymous wizard / chat / pending lead) is preserved
// across the auth gate so the experience feels like "the system was already
// working for me, I just saved my place."
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';
import { useAuth } from './auth';
import T from './theme';

type Step = 'email' | 'code';

type Pending = {
  action: () => void | Promise<void>;
  reason?: string;     // e.g. "Sign in to send a message"
};

type Ctx = {
  /** Run `action` immediately if signed in, else open the modal and run it
   *  after a successful verify. */
  requireAuth: (action: () => void | Promise<void>, reason?: string) => void;
  /** Programmatic open (rarely used — prefer requireAuth). */
  open: (reason?: string) => void;
  isOpen: boolean;
};

const AuthGateContext = createContext<Ctx | null>(null);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function errorMessage(e: any, fallback = 'Something went wrong'): string {
  const detail = e?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((d: any) => d?.msg || d).filter(Boolean).join(', ');
  return e?.message || fallback;
}

export function AuthGateProvider({ children }: { children: React.ReactNode }) {
  const { user, verifyCode } = useAuth();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | undefined>();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [isExisting, setIsExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [warning, setWarning] = useState('');

  const pending = useRef<Pending | null>(null);

  const reset = () => {
    setStep('email'); setEmail(''); setCode(''); setName('');
    setIsExisting(false); setBusy(false); setError('');
    setDevCode(null); setWarning('');
    pending.current = null;
  };

  const close = useCallback(() => { setOpen(false); reset(); }, []);

  const triggerOpen = useCallback((r?: string) => {
    reset();
    setReason(r);
    setOpen(true);
  }, []);

  const requireAuth = useCallback((action: () => void | Promise<void>, r?: string) => {
    if (user) {
      Promise.resolve(action()).catch(() => {});
      return;
    }
    pending.current = { action, reason: r };
    triggerOpen(r);
  }, [user, triggerOpen]);

  const sendCode = async (silent = false) => {
    const e = email.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) { setError('Enter a valid email'); return; }
    if (!silent) setBusy(true);
    setError('');
    try {
      const r = await api.post('/auth/send-code', { email: e });
      setDevCode(r.data?.dev_code || null);
      setWarning(r.data?.delivery_warning || '');
      setIsExisting(!r.data?.is_new_user);
      setStep('code');
    } catch (err: any) {
      setError(errorMessage(err, 'Could not send code'));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    const e = email.trim().toLowerCase();
    const c = code.trim();
    if (c.length < 6) { setError('Enter the 6-digit code'); return; }
    setBusy(true); setError('');
    try {
      await verifyCode(e, c, name.trim() || undefined);
      // Replay the gated action, then close.
      const action = pending.current?.action;
      pending.current = null;
      setOpen(false); reset();
      // Tiny delay so callers see the modal close before their callback fires.
      if (action) setTimeout(() => { Promise.resolve(action()).catch(() => {}); }, 80);

      // Claim a pending lead, if any (project-attach pattern).
      try {
        const leadId = await AsyncStorage.getItem('atlas_pending_lead_id');
        if (leadId) {
          await api.post(`/leads/${leadId}/claim`).catch(() => {});
          await AsyncStorage.removeItem('atlas_pending_lead_id');
        }
      } catch { /* non-blocking */ }
    } catch (err: any) {
      setError(errorMessage(err, 'Invalid code'));
    } finally {
      setBusy(false);
    }
  };

  const ctx = useMemo<Ctx>(() => ({ requireAuth, open: triggerOpen, isOpen: open }), [requireAuth, triggerOpen, open]);

  return (
    <AuthGateContext.Provider value={ctx}>
      {children}
      <Modal
        visible={open}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={close}
      >
        <View style={s.backdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={s.kbWrap}
          >
            <View style={s.sheet} testID="authgate-sheet">
              <View style={s.handle} />

              <View style={s.headerRow}>
                <Text style={s.title}>
                  {step === 'email'
                    ? (reason || 'Save your progress')
                    : (isExisting ? 'Welcome back' : 'Almost there')}
                </Text>
                <TouchableOpacity testID="authgate-close" onPress={close} style={s.closeBtn} hitSlop={8}>
                  <Ionicons name="close" size={20} color={T.textMuted} />
                </TouchableOpacity>
              </View>

              <Text style={s.sub}>
                {step === 'email'
                  ? 'Enter your email — we\'ll send a 6-digit code. No password needed.'
                  : `We sent a code to ${email}.`}
              </Text>

              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 4 }}>
                {step === 'email' && (
                  <>
                    <Text style={s.label}>EMAIL</Text>
                    <TextInput
                      testID="authgate-email"
                      style={[s.input, error && s.inputErr]}
                      placeholder="you@company.com"
                      placeholderTextColor={T.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="email-address"
                      autoFocus
                      value={email}
                      onChangeText={(v) => { setEmail(v); if (error) setError(''); }}
                      onSubmitEditing={() => sendCode()}
                      returnKeyType="go"
                      maxLength={120}
                    />
                  </>
                )}

                {step === 'code' && (
                  <>
                    {devCode && (
                      <TouchableOpacity
                        testID="authgate-devcode"
                        style={s.devBanner}
                        onPress={() => { setCode(devCode); setError(''); }}
                      >
                        <Ionicons name="information-circle" size={16} color={T.risk} />
                        <Text style={s.devBannerText}>
                          DEV mode — tap to use code <Text style={s.devCode}>{devCode}</Text>
                        </Text>
                      </TouchableOpacity>
                    )}
                    {warning && !devCode && (
                      <Text style={s.warningText} numberOfLines={3}>{warning}</Text>
                    )}

                    <Text style={s.label}>6-DIGIT CODE</Text>
                    <TextInput
                      testID="authgate-code"
                      style={[s.input, s.codeInput, error && s.inputErr]}
                      placeholder="000000"
                      placeholderTextColor={T.textMuted}
                      keyboardType="number-pad"
                      autoFocus
                      maxLength={6}
                      value={code}
                      onChangeText={(v) => {
                        const clean = v.replace(/\D/g, '').slice(0, 6);
                        setCode(clean);
                        if (error) setError('');
                      }}
                      onSubmitEditing={verify}
                      returnKeyType="go"
                    />

                    {!isExisting && (
                      <>
                        <Text style={s.label}>YOUR NAME (optional)</Text>
                        <TextInput
                          testID="authgate-name"
                          style={s.input}
                          placeholder="Your name"
                          placeholderTextColor={T.textMuted}
                          value={name}
                          onChangeText={setName}
                          maxLength={80}
                        />
                      </>
                    )}
                  </>
                )}

                {error ? <Text style={s.errText} testID="authgate-error">{error}</Text> : null}
              </ScrollView>

              <TouchableOpacity
                testID="authgate-primary"
                style={[s.primary, busy && { opacity: 0.6 }]}
                disabled={busy}
                onPress={step === 'email' ? () => sendCode() : verify}
              >
                {busy
                  ? <ActivityIndicator color={T.bg} />
                  : <Text style={s.primaryText}>{step === 'email' ? 'Send code' : 'Verify & continue →'}</Text>}
              </TouchableOpacity>

              {step === 'code' && (
                <View style={s.altRow}>
                  <TouchableOpacity testID="authgate-back" onPress={() => { setStep('email'); setCode(''); setError(''); setDevCode(null); }}>
                    <Text style={s.altLink}>← Change email</Text>
                  </TouchableOpacity>
                  <TouchableOpacity testID="authgate-resend" onPress={() => sendCode(true)}>
                    <Text style={s.altLink}>Resend code</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </AuthGateContext.Provider>
  );
}

export function useAuthGate(): Ctx {
  const v = useContext(AuthGateContext);
  if (!v) throw new Error('useAuthGate must be used inside <AuthGateProvider>');
  return v;
}

/** Convenience: pass an action; runs it directly if signed in, else through gate. */
export function useRequireAuth() {
  return useAuthGate().requireAuth;
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  kbWrap: { width: '100%' },
  sheet: {
    backgroundColor: T.surface1,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 22, paddingTop: 8, paddingBottom: 28,
    borderTopWidth: 1, borderColor: T.border,
  },
  handle: {
    alignSelf: 'center', width: 44, height: 5,
    borderRadius: 3, backgroundColor: T.border, marginBottom: 14,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: T.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.3, flex: 1 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: T.surface2, alignItems: 'center', justifyContent: 'center',
  },
  sub: { color: T.textSecondary, fontSize: 13, marginTop: 6, marginBottom: 18, lineHeight: 19 },

  label: { color: T.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1.4, marginTop: 8, marginBottom: 6 },
  input: {
    backgroundColor: T.surface2,
    borderRadius: 12, borderWidth: 1, borderColor: T.border,
    paddingHorizontal: 14, paddingVertical: 14,
    color: T.text, fontSize: 16,
  },
  codeInput: {
    fontSize: 28, letterSpacing: 8,
    textAlign: 'center', fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  inputErr: { borderColor: T.danger },

  devBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: T.riskTint, borderWidth: 1, borderColor: T.riskBorder,
    borderRadius: 10, padding: 12, marginBottom: 12,
  },
  devBannerText: { color: T.risk, fontSize: 13, fontWeight: '700', flex: 1 },
  devCode: { fontSize: 16, letterSpacing: 2, fontVariant: ['tabular-nums'] },
  warningText: { color: T.textMuted, fontSize: 11, marginBottom: 10, fontStyle: 'italic' },

  errText: { color: T.danger, fontSize: 13, fontWeight: '600', marginTop: 10 },

  primary: {
    marginTop: 16, backgroundColor: T.primary,
    borderRadius: 14, paddingVertical: 16,
    alignItems: 'center',
  },
  primaryText: { color: T.bg, fontSize: 16, fontWeight: '800' },

  altRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  altLink: { color: T.primary, fontSize: 13, fontWeight: '700' },
});
