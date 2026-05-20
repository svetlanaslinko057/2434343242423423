/**
 * Admin · PROFILE — admin info + system snapshot + web links + logout.
 *
 * Source: GET /api/admin/mobile/profile
 * Contract v1: admin{id, name, email, role} · snapshot · links[] · generated_at
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert, Linking,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/api';
import T from '../../src/theme';
import { useT } from '../../src/i18n';

type ProfileResp = {
  admin: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
  snapshot: {
    active_devs: number;
    active_modules: number;
    qa_pending: number;
  };
  links: Array<{ label: string; web_url: string }>;
  generated_at: string;
};

export default function AdminProfile() {
  const router = useRouter();
  const { t } = useT();
  const [data, setData] = useState<ProfileResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setErr(null);
      const r = await api.get<ProfileResp>('/admin/mobile/profile');
      setData(r.data);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Failed to load');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const onRefresh = () => { setRefreshing(true); void load(); };

  const logout = () => {
    Alert.alert(t('profile.signout'), t('profile.signout_confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.signout_action'),
        style: 'destructive',
        onPress: async () => {
          try { await api.post('/auth/logout', {}); } catch {}
          router.replace('/auth' as any);
        },
      },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Admin · Profile' }} />
      <ScrollView
        style={s.container}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.primary} />}
        testID="admin-profile-screen"
      >
        <Text style={s.h1}>Profile</Text>
        <Text style={s.subtitle}>Admin identity · system snapshot</Text>

        {loading && <View style={s.center}><ActivityIndicator color={T.primary} /></View>}

        {err && !loading && (
          <View style={s.errBox}>
            <Text style={s.errText}>{err}</Text>
            <TouchableOpacity style={s.retry} onPress={() => { setLoading(true); void load(); }}>
              <Text style={s.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {data && (
          <>
            {/* Identity */}
            <View style={s.identityCard} testID="admin-identity">
              <View style={s.roleBadge}>
                <Ionicons name="shield-checkmark" size={14} color={T.primary} />
                <Text style={s.roleBadgeText}>{(data.admin.role || 'admin').toUpperCase()}</Text>
              </View>
              <Text style={s.name}>{data.admin.name || 'Admin'}</Text>
              <Text style={s.email}>{data.admin.email}</Text>
            </View>

            {/* System snapshot */}
            <Text style={s.sectionLabel}>SYSTEM SNAPSHOT</Text>
            <View style={s.snapBox}>
              <SnapRow label="Active developers" value={data.snapshot.active_devs} />
              <SnapRow label="Active modules" value={data.snapshot.active_modules} />
              <SnapRow label="QA pending" value={data.snapshot.qa_pending} highlight={data.snapshot.qa_pending > 0} />
            </View>

            {/* Mobile quick links */}
            <Text style={s.sectionLabel}>MOBILE</Text>
            <View style={{ gap: T.sm }}>
              <NavRow icon="pulse" label="Open Control" onPress={() => router.push('/admin/home' as any)} testID="nav-control" />
              <NavRow icon="checkmark-circle" label="Review QA" onPress={() => router.push('/admin/qa' as any)} testID="nav-qa" />
              <NavRow icon="cash" label="Approve payouts" onPress={() => router.push('/admin/finance' as any)} testID="nav-finance" />
            </View>

            {/* Web admin links — heavy operations */}
            {data.links.length > 0 && (
              <>
                <Text style={s.sectionLabel}>WEB ADMIN</Text>
                <View style={{ gap: T.sm }}>
                  {data.links.map((link) => (
                    <TouchableOpacity
                      key={link.web_url}
                      style={s.webRow}
                      onPress={() => Linking.openURL(link.web_url)}
                      testID={`web-link-${link.label}`}
                    >
                      <Ionicons name="open-outline" size={18} color={T.primary} />
                      <Text style={s.webRowLabel}>{link.label}</Text>
                      <Ionicons name="chevron-forward" size={16} color={T.textMuted} />
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* Account / Settings — global app settings (language, theme, 2FA) */}
            <Text style={s.sectionLabel}>{t('profile.section.account').toUpperCase()}</Text>
            <View style={{ gap: T.sm }}>
              <NavRow icon="settings-outline" label={t('profile.row.settings')} onPress={() => router.push('/settings' as any)} testID="nav-settings" />
            </View>

            {/* Logout */}
            <TouchableOpacity style={s.logoutBtn} onPress={logout} testID="admin-logout">
              <Ionicons name="log-out-outline" size={18} color={T.danger} />
              <Text style={s.logoutText}>{t('profile.signout')}</Text>
            </TouchableOpacity>

            <Text style={s.notice}>
              Heavy operations (analytics, team management, contracts) live on the web admin panel.
            </Text>
          </>
        )}
      </ScrollView>
    </>
  );
}

function SnapRow({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <View style={s.snapRow}>
      <Text style={s.snapLabel}>{label}</Text>
      <Text style={[s.snapValue, highlight && { color: T.risk }]}>{value}</Text>
    </View>
  );
}

function NavRow({
  icon, label, onPress, testID,
}: { icon: any; label: string; onPress: () => void; testID?: string }) {
  return (
    <TouchableOpacity style={s.navRow} onPress={onPress} testID={testID}>
      <View style={s.navIcon}><Ionicons name={icon} size={18} color={T.primary} /></View>
      <Text style={s.navLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={T.textMuted} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.md, paddingBottom: T.xxl * 2 },
  h1: { color: T.text, fontSize: T.h1, fontWeight: '800' },
  subtitle: { color: T.textSecondary, fontSize: T.small, marginTop: 2, marginBottom: T.lg },
  center: { paddingVertical: T.xxl, alignItems: 'center' },
  errBox: { backgroundColor: T.dangerTint, borderWidth: 1, borderColor: T.dangerBorder, borderRadius: T.radius, padding: T.md, gap: T.sm },
  errText: { color: T.danger, fontSize: T.body, fontWeight: '600' },
  retry: { alignSelf: 'flex-start', paddingHorizontal: T.md, paddingVertical: T.sm, backgroundColor: T.surface2, borderRadius: T.radiusSm },
  retryText: { color: T.text, fontWeight: '700' },

  identityCard: { backgroundColor: T.surface1, borderWidth: 1, borderColor: T.primaryBorder, borderRadius: T.radius, padding: T.md, gap: T.xs, marginBottom: T.md },
  roleBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: T.primaryBgStrong, paddingHorizontal: 8, paddingVertical: 4, borderRadius: T.radiusSm },
  roleBadgeText: { color: T.primary, fontSize: T.tiny, fontWeight: '800', letterSpacing: 1.4 },
  name: { color: T.text, fontSize: T.h2, fontWeight: '800', marginTop: T.xs },
  email: { color: T.textSecondary, fontSize: T.small },

  sectionLabel: { color: T.textMuted, fontSize: T.tiny, fontWeight: '800', letterSpacing: 1.4, marginBottom: T.sm, marginTop: T.md },

  snapBox: { backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border, borderRadius: T.radius, padding: T.md, gap: T.sm },
  snapRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  snapLabel: { color: T.textSecondary, fontSize: T.body },
  snapValue: { color: T.text, fontSize: T.body, fontWeight: '700' },

  navRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border, borderRadius: T.radius, padding: T.md, gap: T.sm },
  navIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: T.surface2, borderRadius: 8 },
  navLabel: { color: T.text, fontSize: T.body, fontWeight: '600', flex: 1 },

  webRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: T.surface1, borderWidth: 1, borderColor: T.primaryBorder, borderRadius: T.radius, padding: T.md, gap: T.sm },
  webRowLabel: { color: T.text, fontSize: T.body, fontWeight: '600', flex: 1 },

  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: T.sm, marginTop: T.lg, paddingVertical: T.md, backgroundColor: T.dangerTint, borderRadius: T.radius, borderWidth: 1, borderColor: T.dangerBorder },
  logoutText: { color: T.danger, fontWeight: '700', fontSize: T.body },

  notice: { color: T.textMuted, fontSize: T.tiny, textAlign: 'center', marginTop: T.md, lineHeight: 16, paddingHorizontal: T.md },
});
