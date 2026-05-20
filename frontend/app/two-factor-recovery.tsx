/**
 * Two-factor recovery-codes management.
 *
 * Shows: unused-codes count, "Regenerate" button.
 * Regenerate requires a fresh TOTP code (NOT a recovery code) — that way a
 * stolen session can't silently rotate the codes the legitimate user is
 * counting on for emergency access.
 *
 * Backend:
 *   GET  /api/account/me/2fa/recovery-codes/status
 *   POST /api/account/me/2fa/recovery-codes/regenerate  { code }  → { recovery_codes }
 */
import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Platform, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { T } from '../src/theme';
import api from '../src/api';

export default function TwoFactorRecovery() {
  const router = useRouter();

  const [status, setStatus] = useState<{ total: number; unused: number; enabled: boolean } | null>(null);
  const [statusBusy, setStatusBusy] = useState(true);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [fresh, setFresh] = useState<string[] | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const load = async () => {
    setStatusBusy(true);
    try {
      const r = await api.get('/account/me/2fa/recovery-codes/status');
      setStatus(r.data);
      if (!r.data?.enabled) {
        Alert.alert('2FA is off', 'Enable 2FA in Settings before managing recovery codes.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    } catch {
      setStatus(null);
    } finally { setStatusBusy(false); }
  };

  useEffect(() => { load(); }, []);

  const regenerate = async () => {
    const clean = code.replace(/\D/g, '');
    if (clean.length !== 6) { setError('Enter the 6-digit code from your authenticator'); return; }
    setBusy(true); setError('');
    try {
      const r = await api.post('/account/me/2fa/recovery-codes/regenerate', { code: clean });
      setFresh(r.data.recovery_codes || []);
      setConfirmOpen(false);
      setCode('');
      // Refresh status
      await load();
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Could not regenerate codes');
    } finally { setBusy(false); }
  };

  const copy = async () => {
    if (!fresh) return;
    await Clipboard.setStringAsync(fresh.join('\n'));
    Alert.alert('Copied', 'Recovery codes copied to clipboard.');
  };

  const share = async () => {
    if (!fresh) return;
    const text =
      `ATLAS DevOS — Two-factor recovery codes\n\n` +
      `Keep these somewhere safe. Each code works once.\n\n` +
      fresh.map((c, i) => `${(i + 1).toString().padStart(2, ' ')}.  ${c}`).join('\n');
    try { await Share.share({ message: text, title: 'ATLAS DevOS recovery codes' }); }
    catch { /* ignore */ }
  };

  const dismiss = () => {
    if (!acknowledged) {
      Alert.alert('Save them first', 'Tick the box to confirm you have saved the new codes — they will not appear again.');
      return;
    }
    setFresh(null);
    setAcknowledged(false);
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Recovery codes',
          headerStyle: { backgroundColor: T.bg },
          headerTitleStyle: { color: T.text, fontWeight: '800' },
          headerTintColor: T.text,
        }}
      />
      <SafeAreaView style={s.flex} edges={['bottom']}>
        <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled" testID="2fa-recovery-screen">
          {statusBusy ? (
            <ActivityIndicator color={T.primary} style={{ marginTop: 40 }} />
          ) : !fresh ? (
            <>
              <View style={s.iconCircle}>
                <Ionicons name="key" size={42} color={T.warning} />
              </View>
              <Text style={s.h1}>Recovery codes</Text>
              <Text style={s.p}>
                These are your one-time backup codes. Use one if you lose
                access to your authenticator app. The originals can't be
                shown again — only regenerated.
              </Text>

              <View style={s.statCard}>
                <Text style={s.statValue} testID="2fa-recovery-unused">
                  {status?.unused ?? 0}
                  <Text style={s.statValueDim}> / {status?.total ?? 0}</Text>
                </Text>
                <Text style={s.statLabel}>Unused codes</Text>
              </View>

              {(status?.unused ?? 0) <= 2 && (status?.enabled ?? false) && (
                <View style={s.warnBanner}>
                  <Ionicons name="warning" size={14} color={T.warning} />
                  <Text style={s.warnText}>
                    Low recovery codes — regenerate before you run out.
                  </Text>
                </View>
              )}

              <TouchableOpacity
                testID="2fa-recovery-regen-btn"
                style={s.primaryBtn}
                onPress={() => { setConfirmOpen(true); setCode(''); setError(''); }}
              >
                <Text style={s.primaryBtnText}>Regenerate codes</Text>
              </TouchableOpacity>
              <Text style={s.hint}>
                Regenerating immediately invalidates all unused codes.
              </Text>
            </>
          ) : (
            <>
              <View style={s.iconCircle}>
                <Ionicons name="key" size={42} color={T.warning} />
              </View>
              <Text style={s.h1}>New recovery codes</Text>
              <Text style={s.p}>Save these. Each one works once.</Text>

              <View style={s.recoveryGrid}>
                {fresh.map((c, i) => (
                  <View key={c} style={s.recoveryCell} testID={`2fa-fresh-code-${i}`}>
                    <Text style={s.recoveryNumber}>{(i + 1).toString().padStart(2, '0')}</Text>
                    <Text style={s.recoveryCode} selectable>{c}</Text>
                  </View>
                ))}
              </View>

              <View style={s.actionRow}>
                <TouchableOpacity onPress={copy} style={s.actionBtn} testID="2fa-recovery-copy">
                  <Ionicons name="copy-outline" size={16} color={T.text} />
                  <Text style={s.actionBtnText}>Copy</Text>
                </TouchableOpacity>
                {Platform.OS !== 'web' && (
                  <TouchableOpacity onPress={share} style={s.actionBtn} testID="2fa-recovery-share">
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
                <Text style={s.checkText}>I have saved these codes.</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.primaryBtn, !acknowledged && s.primaryBtnDisabled]}
                onPress={dismiss}
                disabled={!acknowledged}
                testID="2fa-recovery-done"
              >
                <Text style={s.primaryBtnText}>Done</Text>
              </TouchableOpacity>
            </>
          )}

          {/* Confirm modal — inline expansion to keep the flow contained. */}
          {confirmOpen && (
            <View style={s.confirmOverlay}>
              <View style={s.confirmCard}>
                <Text style={s.confirmTitle}>Confirm regeneration</Text>
                <Text style={s.confirmBody}>
                  Enter the current 6-digit code from your authenticator app
                  to mint a fresh set of recovery codes. Old codes are
                  invalidated immediately.
                </Text>
                <TextInput
                  testID="2fa-recovery-confirm-input"
                  style={s.codeInput}
                  placeholder="000000"
                  placeholderTextColor={T.textMuted}
                  keyboardType="number-pad"
                  maxLength={6}
                  value={code}
                  onChangeText={(v) => { setCode(v.replace(/\D/g, '').slice(0, 6)); if (error) setError(''); }}
                  autoFocus
                />
                {!!error && <Text style={s.error}>{error}</Text>}
                <View style={s.btnRow}>
                  <TouchableOpacity
                    onPress={() => { setConfirmOpen(false); setCode(''); setError(''); }}
                    style={s.secondaryBtn}
                    testID="2fa-recovery-confirm-cancel"
                  >
                    <Text style={s.secondaryBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={regenerate}
                    disabled={busy || code.length !== 6}
                    style={[s.primaryBtnSm, (busy || code.length !== 6) && s.primaryBtnDisabled]}
                    testID="2fa-recovery-confirm-submit"
                  >
                    {busy ? <ActivityIndicator color={T.bg} /> : <Text style={s.primaryBtnText}>Regenerate</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: T.bg },
  container: { padding: T.lg, paddingBottom: 60 },

  iconCircle: {
    width: 70, height: 70, borderRadius: 35, alignSelf: 'center',
    backgroundColor: T.primaryBg, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: T.primaryBorder, marginBottom: T.md,
  },
  h1: { color: T.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  p: { color: T.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },

  statCard: {
    backgroundColor: T.surface, borderRadius: T.radius, padding: T.md,
    borderWidth: 1, borderColor: T.border, alignItems: 'center', marginTop: T.lg,
  },
  statValue: { color: T.text, fontSize: 36, fontWeight: '800', letterSpacing: 1 },
  statValueDim: { color: T.textMuted, fontSize: 22 },
  statLabel: { color: T.textMuted, fontSize: 11, marginTop: 4, letterSpacing: 1, textTransform: 'uppercase', fontWeight: '700' },

  warnBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F59E0B15', borderColor: '#F59E0B55', borderWidth: 1,
    padding: 10, borderRadius: T.radiusSm, marginTop: T.md,
  },
  warnText: { color: T.warning, fontSize: 12, flex: 1, fontWeight: '600' },

  hint: { color: T.textMuted, fontSize: 11, textAlign: 'center', marginTop: 8 },

  recoveryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: T.lg },
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

  primaryBtn: {
    backgroundColor: T.primary, borderRadius: T.radiusSm,
    padding: 16, alignItems: 'center', marginTop: T.lg,
  },
  primaryBtnSm: {
    backgroundColor: T.primary, borderRadius: T.radiusSm,
    paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: T.bg, fontWeight: '800', fontSize: 15 },
  secondaryBtn: {
    paddingVertical: 12, paddingHorizontal: 18, borderRadius: T.radiusSm,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.border,
  },
  secondaryBtnText: { color: T.text, fontWeight: '700' },

  confirmOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: T.md,
  },
  confirmCard: {
    backgroundColor: T.surface, borderRadius: T.radius, padding: T.lg,
    borderWidth: 1, borderColor: T.border,
  },
  confirmTitle: { color: T.text, fontSize: 18, fontWeight: '800' },
  confirmBody: { color: T.textSecondary, fontSize: 13, marginTop: 8, lineHeight: 19 },

  codeInput: {
    backgroundColor: T.bg, borderRadius: T.radiusSm,
    padding: 14, marginTop: T.md, color: T.text,
    fontSize: 24, letterSpacing: 10, textAlign: 'center', fontWeight: '700',
    borderWidth: 1, borderColor: T.border,
  },
  error: { color: T.danger, fontSize: 12, textAlign: 'center', marginTop: 8 },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: T.md },
});
