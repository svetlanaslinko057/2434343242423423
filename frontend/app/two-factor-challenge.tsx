/**
 * Two-factor challenge — login-step.
 *
 * Arrives here after /api/mobile/auth/login returned `requires_2fa: true`
 * with a `challenge_token`. We collect a 6-digit TOTP (or a recovery code
 * `XXXXX-XXXXX`) and POST to /api/mobile/auth/2fa/verify, which returns the
 * real session token.
 *
 * Lifetime: 5 minutes. Backend rejects after 5 wrong attempts.
 */
import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { T } from '../src/theme';
import { useAuth } from '../src/auth';
import api from '../src/api';
import { resolveUserEntry } from '../src/resolve-entry';
import { runtime } from '../src/runtime';

export default function TwoFactorChallenge() {
  const router = useRouter();
  const params = useLocalSearchParams<{ challenge_token?: string; email?: string }>();
  const { refresh } = useAuth();

  const challengeToken = params.challenge_token as string;
  const email = (params.email as string) || '';

  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(5 * 60);

  useEffect(() => {
    if (!challengeToken) {
      router.replace('/auth' as any);
    }
  }, [challengeToken, router]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft((v) => Math.max(0, v - 1)), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  const ttlLabel =
    secondsLeft > 0
      ? `${Math.floor(secondsLeft / 60)}:${(secondsLeft % 60).toString().padStart(2, '0')}`
      : 'expired';

  const submit = async () => {
    if (!challengeToken) return;
    const cleaned = code.trim();
    if (!cleaned) { setError('Enter the code from your authenticator'); return; }
    setBusy(true); setError('');
    try {
      const r = await api.post('/mobile/auth/2fa/verify', {
        challenge_token: challengeToken,
        code: cleaned,
      });
      // Persist session — exact same flow as `login()` in src/auth.tsx.
      await AsyncStorage.setItem('atlas_token', r.data.token);
      await runtime.primeToken();
      await refresh();
      // Route to the user's entry point.
      try {
        const me = await api.get('/me');
        router.replace(resolveUserEntry(me.data) as any);
      } catch {
        router.replace('/');
      }
    } catch (e: any) {
      const detail = e.response?.data?.detail || e.response?.data?.message || 'Invalid code';
      setError(detail);
      setCode('');
      // Expired → bounce to /auth so user signs in again.
      if (e.response?.status === 410 || /expired|sign in/i.test(detail)) {
        setTimeout(() => router.replace('/auth?mode=login' as any), 1500);
      }
    } finally { setBusy(false); }
  };

  const restart = () => router.replace('/auth?mode=login' as any);

  const isTotp = mode === 'totp';

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Verify it\'s you',
          headerStyle: { backgroundColor: T.bg },
          headerTitleStyle: { color: T.text, fontWeight: '800' },
          headerTintColor: T.text,
          headerBackVisible: false,
        }}
      />
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
          <View style={s.iconCircle}>
            <Ionicons name="shield-checkmark" size={42} color={T.primary} />
          </View>

          <Text style={s.h1}>Two-factor verification</Text>
          <Text style={s.p}>
            Signing in to <Text style={s.bold}>{email || 'your account'}</Text>.
            Enter the {isTotp ? '6-digit code from your authenticator app' : 'recovery code you saved'}.
          </Text>

          <View style={s.tabs}>
            <TouchableOpacity
              testID="2fa-tab-totp"
              style={[s.tab, isTotp && s.tabActive]}
              onPress={() => { setMode('totp'); setCode(''); setError(''); }}
            >
              <Text style={[s.tabText, isTotp && s.tabTextActive]}>Authenticator</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="2fa-tab-recovery"
              style={[s.tab, !isTotp && s.tabActive]}
              onPress={() => { setMode('recovery'); setCode(''); setError(''); }}
            >
              <Text style={[s.tabText, !isTotp && s.tabTextActive]}>Recovery code</Text>
            </TouchableOpacity>
          </View>

          {isTotp ? (
            <TextInput
              testID="2fa-challenge-input"
              style={s.codeInput}
              placeholder="000000"
              placeholderTextColor={T.textMuted}
              value={code}
              onChangeText={(v) => { setCode(v.replace(/\D/g, '').slice(0, 6)); if (error) setError(''); }}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
              onSubmitEditing={submit}
            />
          ) : (
            <TextInput
              testID="2fa-challenge-recovery-input"
              style={s.recoveryInput}
              placeholder="ABCDE-12345"
              placeholderTextColor={T.textMuted}
              value={code}
              onChangeText={(v) => { setCode(v.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24)); if (error) setError(''); }}
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              onSubmitEditing={submit}
            />
          )}

          {!!error && <Text style={s.error}>{error}</Text>}

          <Text style={s.ttl}>
            <Ionicons name="time-outline" size={12} color={T.textMuted} />{' '}
            Code request expires in {ttlLabel}
          </Text>

          <TouchableOpacity
            testID="2fa-challenge-submit"
            style={[s.primaryBtn, (busy || code.length < 4 || secondsLeft <= 0) && s.primaryBtnDisabled]}
            onPress={submit}
            disabled={busy || code.length < 4 || secondsLeft <= 0}
          >
            {busy ? <ActivityIndicator color={T.bg} /> : (
              <Text style={s.primaryBtnText}>Verify & sign in</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={restart} style={s.ghostBtn} testID="2fa-challenge-restart">
            <Text style={s.ghostBtnText}>Cancel — back to sign in</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: T.bg },
  container: { padding: T.lg, paddingTop: T.xl },

  iconCircle: {
    width: 70, height: 70, borderRadius: 35, alignSelf: 'center',
    backgroundColor: T.primaryBg, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: T.primaryBorder, marginBottom: T.md,
  },
  h1: { color: T.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  p: { color: T.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  bold: { color: T.text, fontWeight: '800' },

  tabs: {
    flexDirection: 'row', backgroundColor: T.surface, borderRadius: 999,
    padding: 4, marginTop: T.lg, borderWidth: 1, borderColor: T.border,
  },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 999 },
  tabActive: { backgroundColor: T.primaryBg, borderWidth: 1, borderColor: T.primary },
  tabText: { color: T.textMuted, fontSize: 12, fontWeight: '700' },
  tabTextActive: { color: T.primary },

  codeInput: {
    backgroundColor: T.surface, borderRadius: T.radiusSm,
    padding: 16, marginTop: T.md, color: T.text,
    fontSize: 32, letterSpacing: 14, textAlign: 'center', fontWeight: '700',
    borderWidth: 1, borderColor: T.border,
  },
  recoveryInput: {
    backgroundColor: T.surface, borderRadius: T.radiusSm,
    padding: 16, marginTop: T.md, color: T.text,
    fontSize: 18, letterSpacing: 4, textAlign: 'center', fontWeight: '700',
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    borderWidth: 1, borderColor: T.border,
  },
  ttl: { color: T.textMuted, fontSize: 11, textAlign: 'center', marginTop: 12 },

  error: { color: T.danger, fontSize: 13, textAlign: 'center', marginTop: 10 },

  primaryBtn: {
    backgroundColor: T.primary, borderRadius: T.radiusSm,
    padding: 16, alignItems: 'center', marginTop: T.lg,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: T.bg, fontWeight: '800', fontSize: 15 },

  ghostBtn: { padding: 14, alignItems: 'center', marginTop: 6 },
  ghostBtnText: { color: T.textMuted, fontWeight: '600' },
});
