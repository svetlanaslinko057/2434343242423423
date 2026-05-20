// Account screen — Phase 1 Identity Layer.
// Reads /api/account/me, lets user edit identity inline, upload avatar (mock or
// Cloudinary-direct), toggle 2FA, view sessions and revoke other devices.
//
// Email change and account deletion are stubbed as "Coming in next update" —
// backend is ready (see account_layer.py) but full OTP modal flows live in
// Phase 1 Step C.

import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, Alert,
  TouchableOpacity, ActivityIndicator, RefreshControl, Switch, Modal, Image, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../src/auth';
import api from '../src/api';
import T from '../src/theme';
import { SectionLabel } from '../src/ui-client';
import { PressScale } from '../src/ui';

type Identity = {
  user_id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  phone: string | null;
  company: string | null;
  timezone: string | null;
  language: string;
  role: string;
  roles: string[];
  subscription: string;
  two_factor_enabled: boolean;
  is_deleted: boolean;
  created_at: string;
  last_login_at: string | null;
};

type Session = {
  session_id: string;
  token_preview: string;
  created_at: string;
  expires_at: string;
  is_current: boolean;
};

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export default function ClientAccount() {
  const router = useRouter();
  const { logout, refresh } = useAuth();

  const [me, setMe] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [timezone, setTimezone] = useState('');

  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [togglingFa, setTogglingFa] = useState(false);

  // Unified OTP modal — used for 2FA disable, email change, account delete.
  type OtpPurpose = '2fa_disable' | 'change_email' | 'delete_account';
  const [otpModal, setOtpModal] = useState<null | OtpPurpose>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpDevCode, setOtpDevCode] = useState<string | null>(null);
  const [otpSubmitting, setOtpSubmitting] = useState(false);

  // Change-email step 1: capture new address (then we move to OTP modal).
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailRequesting, setEmailRequesting] = useState(false);

  // Delete-account confirm modal (precedes OTP).
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteRequesting, setDeleteRequesting] = useState(false);

  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/account/me');
      const d: Identity = r.data;
      setMe(d);
      setName(d.name || '');
      setPhone(d.phone || '');
      setCompany(d.company || '');
      setTimezone(d.timezone || '');
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed to load profile');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveField = async (field: string, value: string | null) => {
    setSavingField(field);
    try {
      const r = await api.patch('/account/me', { [field]: value });
      setMe(r.data);
      refresh();
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.detail || 'Save failed');
      load();
    } finally {
      setSavingField(null);
    }
  };

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission required', 'Allow photo library access to set an avatar.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];

    setUploadingAvatar(true);
    try {
      // Ask backend whether we're in Cloudinary or mock mode.
      const sigRes = await api.get('/account/me/avatar/signature');
      const sig = sigRes.data;

      let publicId: string;
      let secureUrl: string;
      let version: number | undefined;

      if (sig.mock) {
        // Mock: send the file straight to our backend as multipart.
        const form = new FormData();
        // RN FormData expects { uri, name, type } objects.
        const ext = asset.uri.split('.').pop() || 'jpg';
        const filename = `avatar.${ext}`;
        const fileObj: any = Platform.OS === 'web'
          ? await fetch(asset.uri).then(r => r.blob()).then(b => new File([b], filename, { type: b.type || 'image/jpeg' }))
          : { uri: asset.uri, name: filename, type: `image/${ext === 'jpg' ? 'jpeg' : ext}` };
        form.append('file', fileObj);
        const up = await api.post('/account/me/avatar', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        publicId = up.data.public_id;
        secureUrl = up.data.avatar_url;
      } else {
        // Real Cloudinary signed upload (zero-code switch when keys arrive).
        const form = new FormData();
        const ext = asset.uri.split('.').pop() || 'jpg';
        const fileObj: any = Platform.OS === 'web'
          ? await fetch(asset.uri).then(r => r.blob())
          : { uri: asset.uri, name: `avatar.${ext}`, type: `image/${ext === 'jpg' ? 'jpeg' : ext}` };
        form.append('file', fileObj);
        form.append('api_key', sig.api_key);
        form.append('timestamp', String(sig.timestamp));
        form.append('signature', sig.signature);
        form.append('folder', sig.folder);
        const cdn = await fetch(
          `https://api.cloudinary.com/v1_1/${sig.cloud_name}/${sig.resource_type}/upload`,
          { method: 'POST', body: form as any }
        ).then(r => r.json());
        if (!cdn.public_id) throw new Error(cdn.error?.message || 'Cloudinary upload failed');
        publicId = cdn.public_id;
        secureUrl = cdn.secure_url;
        version = cdn.version;

        await api.post('/account/me/avatar', {
          public_id: publicId, secure_url: secureUrl, version,
        });
      }

      setMe(prev => prev ? { ...prev, avatar_url: secureUrl } : prev);
      refresh();
    } catch (e: any) {
      Alert.alert('Upload failed', e.response?.data?.detail || e.message || 'Try again');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const removeAvatar = async () => {
    if (!me?.avatar_url) return;
    try {
      await api.delete('/account/me/avatar');
      setMe(prev => prev ? { ...prev, avatar_url: null } : prev);
      refresh();
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed');
    }
  };

  const toggle2fa = async (next: boolean) => {
    if (!me) return;
    setTogglingFa(true);
    try {
      if (next) {
        await api.post('/account/me/2fa/enable');
        setMe({ ...me, two_factor_enabled: true });
      } else {
        // Disabling 2FA needs OTP confirmation.
        const r = await api.post('/account/me/2fa/disable/request');
        setOtpDevCode(r.data?.dev_code || null);
        setOtpCode('');
        setOtpModal('2fa_disable');
      }
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed');
    } finally {
      setTogglingFa(false);
    }
  };

  const submitOtp = async () => {
    if (!otpModal || !otpCode.trim()) return;
    setOtpSubmitting(true);
    try {
      if (otpModal === '2fa_disable') {
        await api.post('/account/me/2fa/disable/confirm', { code: otpCode.trim() });
        if (me) setMe({ ...me, two_factor_enabled: false });
      } else if (otpModal === 'change_email') {
        const r = await api.post('/account/me/change-email/confirm', {
          code: otpCode.trim(),
          new_email: newEmail.trim().toLowerCase(),
        });
        setMe(r.data);
        setNewEmail('');
        refresh();
      } else if (otpModal === 'delete_account') {
        await api.delete('/account/me/confirm', { data: { code: otpCode.trim() } });
        // Tear down everything and bounce to /auth.
        try { await logout(); } catch {}
        router.replace('/auth' as any);
        return; // skip cleanup of modal — we're leaving the screen
      }
      setOtpModal(null);
      setOtpCode('');
      setOtpDevCode(null);
    } catch (e: any) {
      Alert.alert('Invalid code', e.response?.data?.detail || 'Try again');
    } finally {
      setOtpSubmitting(false);
    }
  };

  // ─── Change email flow ───
  const requestEmailChange = async () => {
    const candidate = newEmail.trim().toLowerCase();
    if (!candidate || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(candidate)) {
      Alert.alert('Invalid email', 'Enter a valid email address');
      return;
    }
    if (me && candidate === me.email.toLowerCase()) {
      Alert.alert('Same email', 'This is your current email');
      return;
    }
    setEmailRequesting(true);
    try {
      const r = await api.post('/account/me/change-email/request', { new_email: candidate });
      setOtpDevCode(r.data?.dev_code || null);
      setOtpCode('');
      setEmailModalOpen(false);
      setOtpModal('change_email');
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed to send code');
    } finally {
      setEmailRequesting(false);
    }
  };

  // ─── Delete account flow ───
  const requestDelete = async () => {
    setDeleteRequesting(true);
    try {
      const r = await api.delete('/account/me/request');
      setOtpDevCode(r.data?.dev_code || null);
      setOtpCode('');
      setDeleteConfirmOpen(false);
      setOtpModal('delete_account');
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed to send code');
    } finally {
      setDeleteRequesting(false);
    }
  };

  const openSessions = async () => {
    setSessionsOpen(true);
    try {
      const r = await api.get('/account/sessions');
      setSessions(r.data.sessions || []);
    } catch {
      setSessions([]);
    }
  };

  const revokeOthers = async () => {
    setRevokingAll(true);
    try {
      const r = await api.post('/account/sessions/revoke-others');
      Alert.alert('Done', `${r.data.revoked} session(s) revoked`);
      const sr = await api.get('/account/sessions');
      setSessions(sr.data.sessions || []);
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed');
    } finally {
      setRevokingAll(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={s.flex} edges={['top']}>
        <ActivityIndicator color={T.primary} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (!me) {
    return (
      <SafeAreaView style={s.flex} edges={['top']}>
        <Text style={{ color: T.text, padding: T.md }}>Failed to load.</Text>
      </SafeAreaView>
    );
  }

  const initial = (me.name || me.email || '?').trim().charAt(0).toUpperCase();
  const avatarSrc = me.avatar_url
    ? (me.avatar_url.startsWith('http') ? me.avatar_url : `${BACKEND_URL}${me.avatar_url}`)
    : null;

  return (
    <SafeAreaView style={s.flex} edges={['top']}>
      <ScrollView
        contentContainerStyle={s.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={T.primary} />}
        testID="client-account"
      >
        {/* Avatar */}
        <View style={s.avatarBlock}>
          <PressScale onPress={pickAvatar} testID="account-avatar-press" style={s.avatarPress}>
            {avatarSrc ? (
              <Image source={{ uri: avatarSrc }} style={s.avatarImg} />
            ) : (
              <View style={[s.avatarImg, s.avatarFallback]}>
                <Text style={s.avatarInitial}>{initial}</Text>
              </View>
            )}
            <View style={s.avatarBadge}>
              {uploadingAvatar
                ? <ActivityIndicator size="small" color={T.bg} />
                : <Ionicons name="camera" size={14} color={T.bg} />}
            </View>
          </PressScale>
          {me.avatar_url ? (
            <TouchableOpacity onPress={removeAvatar} testID="account-avatar-remove">
              <Text style={s.avatarRemove}>Remove photo</Text>
            </TouchableOpacity>
          ) : (
            <Text style={s.avatarHint}>Tap to upload</Text>
          )}
        </View>

        {/* Personal info */}
        <SectionLabel>Personal info</SectionLabel>
        <Field
          label="Name"
          value={name}
          onChangeText={setName}
          onCommit={(v) => saveField('name', v)}
          saving={savingField === 'name'}
          testID="account-field-name"
        />
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => { setNewEmail(''); setEmailModalOpen(true); }}
          testID="account-field-email"
        >
          <View style={f.wrap}>
            <Text style={f.label}>Email</Text>
            <View style={f.inputWrap}>
              <Text style={[f.input, { color: T.text }]} numberOfLines={1}>{me.email}</Text>
              <Ionicons name="chevron-forward" size={18} color={T.textMuted} />
            </View>
          </View>
        </TouchableOpacity>
        <Field
          label="Phone"
          value={phone}
          onChangeText={setPhone}
          onCommit={(v) => saveField('phone', v)}
          saving={savingField === 'phone'}
          placeholder="+1 555 0100"
          keyboardType="phone-pad"
          testID="account-field-phone"
        />
        <Field
          label="Company"
          value={company}
          onChangeText={setCompany}
          onCommit={(v) => saveField('company', v)}
          saving={savingField === 'company'}
          placeholder="Acme Inc."
          testID="account-field-company"
        />
        <Field
          label="Timezone"
          value={timezone}
          onChangeText={setTimezone}
          onCommit={(v) => saveField('timezone', v)}
          saving={savingField === 'timezone'}
          placeholder="UTC+3"
          testID="account-field-timezone"
        />

        {/* Security */}
        <SectionLabel>Security</SectionLabel>
        <TouchableOpacity onPress={() => router.push('/settings' as any)} testID="account-2fa-open-settings" style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>Two-factor authentication</Text>
            <Text style={s.rowSub}>{me.two_factor_enabled ? 'Enabled — manage in Settings' : 'Disabled — enable in Settings'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={T.textMuted} />
        </TouchableOpacity>
        {me.two_factor_enabled && (
          <TouchableOpacity
            onPress={() => router.push('/two-factor-recovery' as any)}
            testID="account-2fa-recovery"
            style={s.row}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>Recovery codes</Text>
              <Text style={s.rowSub}>See unused count or regenerate</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={T.textMuted} />
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={openSessions} testID="account-sessions-open" style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>Active sessions</Text>
            <Text style={s.rowSub}>See where you're signed in</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={T.textMuted} />
        </TouchableOpacity>

        {/* Danger zone */}
        <SectionLabel>Danger zone</SectionLabel>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => setDeleteConfirmOpen(true)}
          style={s.row}
          testID="account-delete-open"
        >
          <View style={{ flex: 1 }}>
            <Text style={[s.rowLabel, { color: T.danger }]}>Delete account</Text>
            <Text style={s.rowSub}>Permanently remove your data</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={T.danger} />
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* OTP confirm modal — used for 2FA disable, change email, delete account */}
      <Modal visible={!!otpModal} animationType="fade" transparent onRequestClose={() => setOtpModal(null)}>
        <View style={s.otpBackdrop}>
          <View style={s.otpCard}>
            <Text style={s.otpTitle}>
              {otpModal === 'change_email' ? 'Confirm new email' :
               otpModal === 'delete_account' ? 'Confirm account deletion' :
               'Enter confirmation code'}
            </Text>
            <Text style={s.otpSub}>
              {otpDevCode
                ? `DEV mode: ${otpDevCode}`
                : otpModal === 'change_email'
                  ? `We sent a 6-digit code to ${newEmail}.`
                  : `We sent a 6-digit code to ${me.email}.`}
            </Text>
            <TextInput
              testID="account-otp-input"
              style={s.otpInput}
              placeholder="123456"
              placeholderTextColor={T.textMuted}
              keyboardType="number-pad"
              maxLength={6}
              value={otpCode}
              onChangeText={setOtpCode}
              autoFocus
            />
            <View style={s.otpActions}>
              <TouchableOpacity onPress={() => setOtpModal(null)} style={s.otpCancel} testID="account-otp-cancel">
                <Text style={s.otpCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={submitOtp}
                disabled={otpSubmitting || otpCode.length < 4}
                style={[
                  otpModal === 'delete_account' ? s.otpSubmitDanger : s.otpSubmit,
                  (otpSubmitting || otpCode.length < 4) && { opacity: 0.5 },
                ]}
                testID="account-otp-submit"
              >
                <Text style={otpModal === 'delete_account' ? s.otpSubmitDangerText : s.otpSubmitText}>
                  {otpSubmitting ? '…' : (otpModal === 'delete_account' ? 'Delete forever' : 'Confirm')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Change-email step 1: ask for the new address */}
      <Modal visible={emailModalOpen} animationType="fade" transparent onRequestClose={() => setEmailModalOpen(false)}>
        <View style={s.otpBackdrop}>
          <View style={s.otpCard}>
            <Text style={s.otpTitle}>Change email</Text>
            <Text style={s.otpSub}>
              Enter your new email. We'll send a 6-digit code to confirm.
              {'\n'}Current: <Text style={{ fontWeight: '700' }}>{me.email}</Text>
            </Text>
            <TextInput
              testID="account-new-email-input"
              style={s.emailInput}
              placeholder="you@example.com"
              placeholderTextColor={T.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              value={newEmail}
              onChangeText={setNewEmail}
              autoFocus
            />
            <View style={s.otpActions}>
              <TouchableOpacity onPress={() => setEmailModalOpen(false)} style={s.otpCancel} testID="account-new-email-cancel">
                <Text style={s.otpCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={requestEmailChange}
                disabled={emailRequesting || !newEmail.trim()}
                style={[s.otpSubmit, (emailRequesting || !newEmail.trim()) && { opacity: 0.5 }]}
                testID="account-new-email-send"
              >
                <Text style={s.otpSubmitText}>{emailRequesting ? 'Sending…' : 'Send code'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete-account confirm modal — followed by OTP modal */}
      <Modal visible={deleteConfirmOpen} animationType="fade" transparent onRequestClose={() => setDeleteConfirmOpen(false)}>
        <View style={s.otpBackdrop}>
          <View style={s.otpCard}>
            <Text style={[s.otpTitle, { color: T.danger }]}>Delete account?</Text>
            <Text style={s.otpSub}>
              This will permanently sign you out and remove your data. Your projects and invoices stay on record but you will lose access to them.
              {'\n\n'}We'll send a 6-digit code to <Text style={{ fontWeight: '700' }}>{me.email}</Text> to confirm.
            </Text>
            <View style={s.otpActions}>
              <TouchableOpacity onPress={() => setDeleteConfirmOpen(false)} style={s.otpCancel} testID="account-delete-cancel">
                <Text style={s.otpCancelText}>Keep account</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={requestDelete}
                disabled={deleteRequesting}
                style={[s.otpSubmitDanger, deleteRequesting && { opacity: 0.5 }]}
                testID="account-delete-send"
              >
                <Text style={s.otpSubmitDangerText}>{deleteRequesting ? 'Sending…' : 'Send code'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Sessions modal */}
      <Modal visible={sessionsOpen} animationType="slide" onRequestClose={() => setSessionsOpen(false)}>
        <SafeAreaView style={s.flex} edges={['top']}>
          <View style={s.sheetHeader}>
            <TouchableOpacity onPress={() => setSessionsOpen(false)} testID="sessions-close">
              <Ionicons name="close" size={24} color={T.text} />
            </TouchableOpacity>
            <Text style={s.sheetTitle}>Active sessions</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: T.md, paddingBottom: 100 }}>
            {(sessions || []).map((sess) => (
              <View key={sess.session_id} style={s.sessionCard} testID={`session-${sess.session_id}`}>
                <View style={s.sessionRow}>
                  <Ionicons
                    name={sess.is_current ? 'checkmark-circle' : 'phone-portrait-outline'}
                    size={20}
                    color={sess.is_current ? T.success : T.textMuted}
                  />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={s.sessionTitle}>
                      {sess.is_current ? 'This device' : 'Another device'}
                    </Text>
                    <Text style={s.sessionMeta}>
                      Signed in {new Date(sess.created_at).toLocaleDateString()}
                    </Text>
                    <Text style={s.sessionMeta}>Token: {sess.token_preview}</Text>
                  </View>
                </View>
              </View>
            ))}
            {(sessions || []).filter(x => !x.is_current).length > 0 && (
              <TouchableOpacity
                onPress={revokeOthers}
                disabled={revokingAll}
                style={[s.revokeBtn, revokingAll && { opacity: 0.5 }]}
                testID="sessions-revoke-others"
              >
                <Ionicons name="log-out-outline" size={18} color={T.danger} />
                <Text style={s.revokeText}>{revokingAll ? 'Revoking…' : 'Sign out of other devices'}</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

/* ─── Field row with inline edit + autosave on blur ─── */
function Field(props: {
  label: string;
  value: string;
  onChangeText?: (v: string) => void;
  onCommit?: (v: string) => void;
  editable?: boolean;
  saving?: boolean;
  placeholder?: string;
  rightHint?: string;
  keyboardType?: 'default' | 'phone-pad' | 'email-address' | 'number-pad';
  testID?: string;
}) {
  const editable = props.editable !== false;
  return (
    <View style={f.wrap}>
      <Text style={f.label}>{props.label}</Text>
      <View style={f.inputWrap}>
        <TextInput
          testID={props.testID}
          style={[f.input, !editable && f.inputDisabled]}
          value={props.value}
          onChangeText={props.onChangeText}
          onBlur={() => props.onCommit?.(props.value)}
          editable={editable}
          placeholder={props.placeholder}
          placeholderTextColor={T.textMuted}
          keyboardType={props.keyboardType || 'default'}
          autoCapitalize={props.keyboardType === 'email-address' ? 'none' : 'sentences'}
        />
        {props.saving ? <ActivityIndicator size="small" color={T.primary} /> : null}
        {!editable && props.rightHint ? <Text style={f.hint}>{props.rightHint}</Text> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: T.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: T.md, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: T.border,
  },
  headerBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: T.text, fontSize: T.h3, fontWeight: '800' },

  container: { padding: T.md, paddingBottom: 60 },

  /* Avatar */
  avatarBlock: { alignItems: 'center', marginBottom: T.lg, marginTop: T.sm },
  avatarPress: { position: 'relative' },
  avatarImg: { width: 96, height: 96, borderRadius: 48, backgroundColor: T.surface2 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: T.primary, fontSize: 36, fontWeight: '800' },
  avatarBadge: {
    position: 'absolute', right: 0, bottom: 0,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: T.bg,
  },
  avatarHint: { color: T.textMuted, fontSize: T.tiny, marginTop: 10, fontWeight: '600' },
  avatarRemove: { color: T.danger, fontSize: T.tiny, marginTop: 10, fontWeight: '700' },

  /* Rows */
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: T.surface1,
    borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
    padding: T.md, marginBottom: T.sm,
  },
  rowLabel: { color: T.text, fontSize: T.body, fontWeight: '700' },
  rowSub: { color: T.textMuted, fontSize: T.tiny, marginTop: 2, fontWeight: '500' },

  /* Sheet header */
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: T.md, paddingVertical: T.md,
    borderBottomWidth: 1, borderBottomColor: T.border,
    backgroundColor: T.surface1,
  },
  sheetTitle: { color: T.text, fontSize: T.h3, fontWeight: '800' },

  /* Session card */
  sessionCard: {
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.border,
    borderRadius: T.radius,
    padding: T.md,
    marginBottom: T.sm,
  },
  sessionRow: { flexDirection: 'row', alignItems: 'center' },
  sessionTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  sessionMeta: { color: T.textMuted, fontSize: T.tiny, marginTop: 2, fontWeight: '500' },

  revokeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: T.dangerTint,
    borderWidth: 1, borderColor: T.dangerBorder,
    borderRadius: T.radius,
    paddingVertical: 14,
    marginTop: T.md,
  },
  revokeText: { color: T.danger, fontSize: T.body, fontWeight: '700' },

  /* OTP modal */
  otpBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: T.md },
  otpCard: {
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.border,
    borderRadius: T.radius,
    padding: T.lg,
    gap: T.sm,
  },
  otpTitle: { color: T.text, fontSize: T.h3, fontWeight: '800' },
  otpSub: { color: T.textSecondary, fontSize: T.small, fontWeight: '500' },
  otpInput: {
    marginTop: T.sm,
    backgroundColor: T.surface2,
    borderRadius: T.radiusSm,
    padding: 14,
    color: T.text, fontSize: 22, letterSpacing: 8, textAlign: 'center', fontWeight: '800',
    borderWidth: 1, borderColor: T.border,
  },
  emailInput: {
    marginTop: T.sm,
    backgroundColor: T.surface2,
    borderRadius: T.radiusSm,
    padding: 14,
    color: T.text, fontSize: T.body, fontWeight: '600',
    borderWidth: 1, borderColor: T.border,
  },
  otpActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: T.sm, marginTop: T.sm },
  otpCancel: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: T.radiusSm, backgroundColor: T.surface2 },
  otpCancelText: { color: T.text, fontWeight: '700' },
  otpSubmit: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: T.radiusSm, backgroundColor: T.primary },
  otpSubmitText: { color: T.bg, fontWeight: '800' },
  otpSubmitDanger: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: T.radiusSm, backgroundColor: T.danger },
  otpSubmitDangerText: { color: '#fff', fontWeight: '800' },
});

const f = StyleSheet.create({
  wrap: {
    backgroundColor: T.surface1,
    borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
    padding: T.md,
    marginBottom: T.sm,
  },
  label: { color: T.textMuted, fontSize: T.tiny, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, color: T.text, fontSize: T.body, fontWeight: '600', padding: 0 },
  inputDisabled: { color: T.textSecondary },
  hint: { color: T.textMuted, fontSize: T.tiny, fontWeight: '600' },
});
