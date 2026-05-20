/**
 * Two-factor enrollment wizard.
 *
 * Three-step flow:
 *   1. INTRO       — explain what 2FA is, "Begin setup" button
 *   2. SCAN        — show QR + manual secret, input field for 6-digit code
 *                    "Why?" link to docs (optional, omitted in v1)
 *   3. RECOVERY    — surface 10 recovery codes ONCE, "I have saved them"
 *                    confirmation before returning to Settings
 *
 * Backend contract (all under /api/account/me/2fa/):
 *   POST /setup            → { secret, otpauth_uri, qr_data_url, ... }
 *   POST /setup/verify     → { recovery_codes: string[], two_factor_enabled }
 *   POST /setup/cancel     → drops pending secret (used on screen exit)
 */
import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Image, Alert, Platform, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { T } from '../src/theme';
import api from '../src/api';

type Step = 'intro' | 'scan' | 'recovery';
type SetupPayload = {
  secret: string;
  otpauth_uri: string;
  qr_data_url: string;
  issuer: string;
  label: string;
};

export default function TwoFactorSetup() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('intro');

  // SCAN state
  const [setupPayload, setSetupPayload] = useState<SetupPayload | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // RECOVERY state
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  // Drop pending secret if the user backs out mid-enrollment (lifecycle hook).
  const cancelRef = useRef(false);
  useEffect(() => {
    return () => {
      // Only cancel if we never reached RECOVERY (= 2FA never activated).
      if (cancelRef.current === false && setupPayload && !recoveryCodes) {
        api.post('/account/me/2fa/setup/cancel').catch(() => {});
      }
    };
  }, [setupPayload, recoveryCodes]);

  const begin = async () => {
    setBusy(true); setError('');
    try {
      const r = await api.post('/account/me/2fa/setup');
      setSetupPayload(r.data);
      setStep('scan');
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Could not start setup');
    } finally { setBusy(false); }
  };

  const verify = async () => {
    const clean = code.replace(/\D/g, '');
    if (clean.length !== 6) { setError('Enter the 6-digit code from your authenticator'); return; }
    setBusy(true); setError('');
    try {
      const r = await api.post('/account/me/2fa/setup/verify', { code: clean });
      setRecoveryCodes(r.data.recovery_codes || []);
      cancelRef.current = true; // succeeded — don't cancel on unmount
      setStep('recovery');
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Invalid code — try again with a fresh one');
      setCode('');
    } finally { setBusy(false); }
  };

  const copySecret = async () => {
    if (!setupPayload) return;
    await Clipboard.setStringAsync(setupPayload.secret);
    Alert.alert('Copied', 'Secret copied to clipboard.');
  };

  const copyRecovery = async () => {
    if (!recoveryCodes) return;
    const text = recoveryCodes.join('\n');
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied', 'Recovery codes copied to clipboard. Paste them somewhere safe.');
  };

  const shareRecovery = async () => {
    if (!recoveryCodes) return;
    const text =
      `ATLAS DevOS — Two-factor recovery codes\n\n` +
      `Keep these somewhere safe. Each code works once.\n\n` +
      recoveryCodes.map((c, i) => `${(i + 1).toString().padStart(2, ' ')}.  ${c}`).join('\n');
    try { await Share.share({ message: text, title: 'ATLAS DevOS recovery codes' }); }
    catch { /* ignore */ }
  };

  const finish = () => {
    if (!acknowledged) {
      Alert.alert('One more thing', 'Tick the confirmation that you have saved the recovery codes.');
      return;
    }
    router.back();
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Two-factor authentication',
          headerStyle: { backgroundColor: T.bg },
          headerTitleStyle: { color: T.text, fontWeight: '800' },
          headerTintColor: T.text,
        }}
      />
      <SafeAreaView style={s.flex} edges={['bottom']}>
        <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled" testID="2fa-setup-screen">
          {step === 'intro' && (
            <View testID="2fa-step-intro">
              <View style={s.iconCircle}>
                <Ionicons name="shield-checkmark" size={48} color={T.primary} />
              </View>
              <Text style={s.h1}>Protect your account</Text>
              <Text style={s.p}>
                Two-factor authentication adds a second check at sign-in —
                a 6-digit code from an authenticator app. Even if someone
                steals your password, they can't get in without your phone.
              </Text>

              <View style={s.bulletCard}>
                <Bullet icon="qr-code-outline" title="1. Scan a QR code" body="Use Google Authenticator, Authy, 1Password, or any TOTP app." />
                <Bullet icon="key-outline" title="2. Verify a code" body="Type the 6-digit code your app generates." />
                <Bullet icon="lock-closed-outline" title="3. Save recovery codes" body="10 single-use codes for emergencies." />
              </View>

              {!!error && <Text style={s.error}>{error}</Text>}

              <TouchableOpacity
                testID="2fa-begin-btn"
                style={[s.primaryBtn, busy && { opacity: 0.6 }]}
                onPress={begin}
                disabled={busy}
              >
                {busy ? <ActivityIndicator color={T.bg} /> : <Text style={s.primaryBtnText}>Begin setup</Text>}
              </TouchableOpacity>
              <TouchableOpacity testID="2fa-back-btn" onPress={() => router.back()} style={s.ghostBtn}>
                <Text style={s.ghostBtnText}>Not now</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 'scan' && setupPayload && (
            <View testID="2fa-step-scan">
              <Text style={s.h1}>Scan with your authenticator</Text>
              <Text style={s.p}>
                Open your authenticator app and scan this QR code. If you
                can't scan, copy the secret below and enter it manually.
              </Text>

              <View style={s.qrCard}>
                <Image
                  source={{ uri: setupPayload.qr_data_url }}
                  style={s.qrImg}
                  testID="2fa-qr-image"
                />
              </View>

              <Text style={s.secretLabel}>SECRET</Text>
              <TouchableOpacity onPress={copySecret} style={s.secretRow} testID="2fa-copy-secret">
                <Text style={s.secretText} selectable>{setupPayload.secret}</Text>
                <Ionicons name="copy-outline" size={18} color={T.primary} />
              </TouchableOpacity>

              <Text style={s.codeLabel}>ENTER THE 6-DIGIT CODE</Text>
              <TextInput
                testID="2fa-verify-input"
                style={s.codeInput}
                placeholder="000000"
                placeholderTextColor={T.textMuted}
                keyboardType="number-pad"
                maxLength={6}
                value={code}
                onChangeText={(v) => { setCode(v.replace(/\D/g, '').slice(0, 6)); if (error) setError(''); }}
                onSubmitEditing={verify}
                autoFocus
              />

              {!!error && <Text style={s.error}>{error}</Text>}

              <TouchableOpacity
                testID="2fa-verify-btn"
                style={[s.primaryBtn, (code.length !== 6 || busy) && s.primaryBtnDisabled]}
                onPress={verify}
                disabled={code.length !== 6 || busy}
              >
                {busy ? <ActivityIndicator color={T.bg} /> : <Text style={s.primaryBtnText}>Verify & enable</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.back()} style={s.ghostBtn} testID="2fa-cancel-btn">
                <Text style={s.ghostBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 'recovery' && recoveryCodes && (
            <View testID="2fa-step-recovery">
              <View style={s.iconCircle}>
                <Ionicons name="key" size={48} color={T.warning} />
              </View>
              <Text style={s.h1}>Save your recovery codes</Text>
              <Text style={s.p}>
                If you lose your phone, these codes are your only way back
                in. Each code works <Text style={s.bold}>once</Text>. Save
                them somewhere offline — a password manager, a printed copy
                in a safe, anywhere a thief wouldn't think to look.
              </Text>

              <View style={s.recoveryGrid}>
                {recoveryCodes.map((c, i) => (
                  <View key={c} style={s.recoveryCell} testID={`2fa-recovery-code-${i}`}>
                    <Text style={s.recoveryNumber}>{(i + 1).toString().padStart(2, '0')}</Text>
                    <Text style={s.recoveryCode} selectable>{c}</Text>
                  </View>
                ))}
              </View>

              <View style={s.actionRow}>
                <TouchableOpacity onPress={copyRecovery} style={s.actionBtn} testID="2fa-copy-recovery">
                  <Ionicons name="copy-outline" size={16} color={T.text} />
                  <Text style={s.actionBtnText}>Copy</Text>
                </TouchableOpacity>
                {Platform.OS !== 'web' && (
                  <TouchableOpacity onPress={shareRecovery} style={s.actionBtn} testID="2fa-share-recovery">
                    <Ionicons name="share-outline" size={16} color={T.text} />
                    <Text style={s.actionBtnText}>Share</Text>
                  </TouchableOpacity>
                )}
              </View>

              <TouchableOpacity
                style={s.checkRow}
                onPress={() => setAcknowledged((v) => !v)}
                testID="2fa-recovery-ack"
                activeOpacity={0.7}
              >
                <View style={[s.checkbox, acknowledged && s.checkboxOn]}>
                  {acknowledged && <Ionicons name="checkmark" size={14} color={T.bg} />}
                </View>
                <Text style={s.checkText}>
                  I have saved these codes somewhere safe.
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                testID="2fa-finish-btn"
                style={[s.primaryBtn, !acknowledged && s.primaryBtnDisabled]}
                onPress={finish}
                disabled={!acknowledged}
              >
                <Text style={s.primaryBtnText}>Done — 2FA is on</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

function Bullet({ icon, title, body }: { icon: any; title: string; body: string }) {
  return (
    <View style={s.bulletRow}>
      <View style={s.bulletIcon}>
        <Ionicons name={icon} size={18} color={T.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.bulletTitle}>{title}</Text>
        <Text style={s.bulletBody}>{body}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: T.bg },
  container: { padding: T.lg, paddingBottom: 60 },

  iconCircle: {
    width: 80, height: 80, borderRadius: 40, alignSelf: 'center',
    backgroundColor: T.primaryBg, alignItems: 'center', justifyContent: 'center',
    marginTop: 12, marginBottom: T.md,
    borderWidth: 1, borderColor: T.primaryBorder,
  },

  h1: { color: T.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  p: { color: T.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  bold: { fontWeight: '800', color: T.text },

  bulletCard: {
    backgroundColor: T.surface, borderRadius: T.radius, borderWidth: 1, borderColor: T.border,
    padding: T.md, marginTop: T.lg, gap: T.md,
  },
  bulletRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  bulletIcon: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: T.primaryBg,
    alignItems: 'center', justifyContent: 'center',
  },
  bulletTitle: { color: T.text, fontWeight: '700', fontSize: 14 },
  bulletBody: { color: T.textMuted, fontSize: 12, marginTop: 2 },

  qrCard: {
    backgroundColor: '#fff',
    padding: 18, borderRadius: T.radius, alignSelf: 'center',
    marginTop: T.lg, marginBottom: T.md,
    borderWidth: 1, borderColor: T.border,
  },
  qrImg: { width: 220, height: 220 },

  secretLabel: { color: T.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 2, marginTop: T.sm },
  secretRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: T.surface, borderRadius: T.radiusSm, padding: 12, marginTop: 6,
    borderWidth: 1, borderColor: T.border, gap: 8,
  },
  secretText: { color: T.text, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 13, flex: 1 },

  codeLabel: { color: T.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 2, marginTop: T.lg },
  codeInput: {
    backgroundColor: T.surface, borderRadius: T.radiusSm,
    padding: 16, marginTop: 6, color: T.text,
    fontSize: 28, letterSpacing: 12, textAlign: 'center', fontWeight: '700',
    borderWidth: 1, borderColor: T.border,
  },

  primaryBtn: {
    backgroundColor: T.primary, borderRadius: T.radiusSm,
    padding: 16, alignItems: 'center', marginTop: T.lg,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: T.bg, fontWeight: '800', fontSize: 15 },

  ghostBtn: { padding: 14, alignItems: 'center', marginTop: 6 },
  ghostBtnText: { color: T.textMuted, fontWeight: '600' },

  error: { color: T.danger, fontSize: 13, textAlign: 'center', marginTop: T.sm },

  recoveryGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    marginTop: T.lg,
  },
  recoveryCell: {
    width: '48%',
    backgroundColor: T.surface, borderRadius: T.radiusSm,
    paddingVertical: 10, paddingHorizontal: 12,
    borderWidth: 1, borderColor: T.border,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  recoveryNumber: { color: T.textMuted, fontSize: 10, fontWeight: '700', width: 18 },
  recoveryCode: {
    color: T.text, fontSize: 14,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontWeight: '700',
  },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: T.md },
  actionBtn: {
    flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6,
    backgroundColor: T.surface, borderRadius: T.radiusSm, padding: 12,
    borderWidth: 1, borderColor: T.border,
  },
  actionBtnText: { color: T.text, fontWeight: '700', fontSize: 13 },

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: T.lg },
  checkbox: {
    width: 22, height: 22, borderRadius: 5,
    borderWidth: 1.5, borderColor: T.border, backgroundColor: T.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: T.primary, borderColor: T.primary },
  checkText: { color: T.text, fontSize: 13, flex: 1 },
});
