import { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../src/api';
import { useMe } from '../src/use-me';
import { useAuth } from '../src/auth';
import { useT } from '../src/i18n';
import T from '../src/theme';

/**
 * L0 Profile — identity-first, not a debug screen.
 *
 * Layout:
 *   [Avatar]
 *   Name / email
 *   --- stats strip (Building / Earning) ---
 *   --- ROLES ---  (click to switch active_context)
 *   --- ACTIONS --- (Projects, Work, Billing placeholder, Logout)
 */

const CTX_META: Record<string, { label: string; icon: any; color: string }> = {
  client:    { label: 'Client',    icon: 'briefcase',        color: T.primaryAccent },
  developer: { label: 'Developer', icon: 'code-slash',       color: T.info },
  admin:     { label: 'Admin',     icon: 'shield-checkmark', color: T.warning },
};

export default function Profile() {
  const router = useRouter();
  const { logout } = useAuth();
  const { me, loading, refresh } = useMe();
  const { t } = useT();
  const [switching, setSwitching] = useState<string | null>(null);

  const switchContext = async (ctx: string) => {
    try {
      setSwitching(ctx);
      await api.post('/me/context', { context: ctx });
      await refresh();
    } catch (e: any) {
      Alert.alert('Switch failed', e?.response?.data?.detail || String(e));
    } finally {
      setSwitching(null);
    }
  };

  const doLogout = async () => {
    await logout();
    router.replace('/' as any);
  };

  if (loading) {
    return <View style={s.centered}><ActivityIndicator color={T.primary} /></View>;
  }
  if (!me) {
    return <View style={s.centered}><Text style={s.muted}>Not signed in</Text></View>;
  }

  const states = me.states || [];
  const active = me.active_context;
  const initial = (me.name || me.email || 'U').trim().charAt(0).toUpperCase();
  const buildingCount = me.building_count || 0;
  const totalEarned = me.total_earned || 0;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} testID="profile-screen">
      {/* Hero — avatar + name + email */}
      <View style={s.hero}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>{initial}</Text>
        </View>
        <Text style={s.name}>{me.name || 'You'}</Text>
        {!!me.email && <Text style={s.email}>{me.email}</Text>}
      </View>

      {/* Stats strip — shown only when meaningful */}
      {(buildingCount > 0 || totalEarned > 0) && (
        <View style={s.stats}>
          {buildingCount > 0 && (
            <View style={s.statCell} testID="profile-building">
              <Text style={s.statValue}>{buildingCount}</Text>
              <Text style={s.statLabel}>BUILDING</Text>
            </View>
          )}
          {totalEarned > 0 && (
            <View style={s.statCell} testID="profile-earning">
              <Text style={s.statValue}>${Math.round(totalEarned).toLocaleString()}</Text>
              <Text style={s.statLabel}>EARNED</Text>
            </View>
          )}
          <View style={s.statCell}>
            <Text style={s.statValue}>{states.length}</Text>
            <Text style={s.statLabel}>ROLES</Text>
          </View>
        </View>
      )}

      {/* ROLES */}
      <Text style={s.sectionTitle}>Roles</Text>
      {states.length === 0 ? (
        <TouchableOpacity
          testID="profile-no-role-cta"
          style={s.emptyRoles}
          onPress={() => router.push(resolveUserEntry(me) as any)}
          activeOpacity={0.85}
        >
          <Text style={s.emptyTitle}>Pick how you show up</Text>
          <Text style={s.emptySub}>Start a project or join as a developer — you choose.</Text>
          <View style={s.emptyArrow}>
            <Text style={s.emptyArrowText}>Go to Home</Text>
            <Ionicons name="arrow-forward" size={14} color={T.primary} />
          </View>
        </TouchableOpacity>
      ) : (
        states.map((ctx) => {
          const meta = CTX_META[ctx] || { label: ctx, icon: 'ellipse', color: T.textMuted };
          const isActive = active === ctx;
          return (
            <TouchableOpacity
              key={ctx}
              testID={`profile-role-${ctx}`}
              style={[s.roleCard, isActive && { borderColor: meta.color, borderWidth: 1.5 }]}
              onPress={() => !isActive && switchContext(ctx)}
              disabled={isActive || !!switching}
              activeOpacity={0.85}
            >
              <View style={[s.roleIcon, { backgroundColor: meta.color + '22' }]}>
                <Ionicons name={meta.icon} size={18} color={meta.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.roleLabel}>{meta.label}</Text>
                <Text style={s.roleSub}>
                  {isActive ? 'Current view' : `Switch to ${meta.label}`}
                </Text>
              </View>
              {switching === ctx
                ? <ActivityIndicator color={meta.color} />
                : isActive
                  ? <Ionicons name="checkmark-circle" size={20} color={meta.color} />
                  : <Ionicons name="chevron-forward" size={18} color={T.textMuted} />}
            </TouchableOpacity>
          );
        })
      )}

      {/* ACTIONS */}
      <Text style={s.sectionTitle}>Actions</Text>
      {states.includes('client') && (
        <ActionRow icon="folder-open" label="My projects"
          testID="profile-action-projects"
          onPress={() => router.push('/client/home' as any)} />
      )}
      {states.includes('developer') && (
        <ActionRow icon="hammer" label="My work"
          testID="profile-action-work"
          onPress={() => router.push('/developer/home' as any)} />
      )}
      {states.includes('admin') && (
        <ActionRow icon="shield-checkmark" label="Control center"
          testID="profile-action-admin"
          onPress={() => router.push('/admin/home' as any)} />
      )}
      <ActionRow icon="receipt" label="Billing & payments"
        testID="profile-action-billing"
        subdued
        onPress={() => Alert.alert('Coming soon', 'Billing is on the roadmap.')} />
      <ActionRow icon="document-text" label="Documents"
        testID="profile-action-documents"
        onPress={() => router.push('/documents' as any)} />
      {states.includes('client') && (
        <ActionRow icon="gift" label="Referrals — earn 7%"
          testID="profile-action-referrals"
          onPress={() => router.push('/client/referrals' as any)} />
      )}
      <ActionRow icon="settings" label={t('profile.row.settings')}
        testID="profile-action-settings"
        onPress={() => router.push('/settings' as any)} />

      <TouchableOpacity
        testID="profile-logout"
        style={s.logoutBtn}
        onPress={doLogout}
        activeOpacity={0.85}
      >
        <Ionicons name="log-out-outline" size={18} color={T.danger} />
        <Text style={s.logoutText}>{t('profile.signout')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function ActionRow({
  icon, label, onPress, subdued, testID,
}: { icon: any; label: string; onPress: () => void; subdued?: boolean; testID?: string }) {
  return (
    <TouchableOpacity
      testID={testID}
      style={s.actionRow}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Ionicons name={icon} size={18} color={subdued ? T.textMuted : T.text} />
      <Text style={[s.actionLabel, subdued && { color: T.textMuted }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={T.textMuted} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.lg, paddingBottom: T.xl * 2 },
  centered: { flex: 1, backgroundColor: T.bg, alignItems: 'center', justifyContent: 'center' },
  muted: { color: T.textMuted },

  hero: { alignItems: 'center', paddingVertical: T.xl },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: T.surface2, borderWidth: 1, borderColor: T.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: T.md,
  },
  avatarText: { color: T.text, fontSize: 28, fontWeight: '800' },
  name: { color: T.text, fontSize: 22, fontWeight: '800' },
  email: { color: T.textMuted, fontSize: T.small, marginTop: 4 },

  stats: {
    flexDirection: 'row', gap: T.sm, marginBottom: T.xl,
  },
  statCell: {
    flex: 1, backgroundColor: T.surface1, borderRadius: T.radius,
    paddingVertical: T.md, paddingHorizontal: T.sm,
    borderWidth: 1, borderColor: T.border, alignItems: 'center',
  },
  statValue: { color: T.text, fontSize: T.h3, fontWeight: '800' },
  statLabel: { color: T.textMuted, fontSize: T.tiny, letterSpacing: 2, marginTop: 4, fontWeight: '700' },

  sectionTitle: {
    color: T.textMuted, fontSize: T.tiny, textTransform: 'uppercase',
    letterSpacing: 2, fontWeight: '800',
    marginTop: T.lg, marginBottom: T.sm,
  },

  roleCard: {
    flexDirection: 'row', alignItems: 'center', gap: T.md,
    backgroundColor: T.surface1, borderRadius: T.radius,
    padding: T.md, marginBottom: T.sm,
    borderWidth: 1, borderColor: T.border,
  },
  roleIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  roleLabel: { color: T.text, fontSize: T.body, fontWeight: '700' },
  roleSub: { color: T.textMuted, fontSize: T.small, marginTop: 2 },

  emptyRoles: {
    backgroundColor: T.surface1, borderRadius: T.radius, padding: T.md,
    borderWidth: 1, borderColor: T.border,
  },
  emptyTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  emptySub: { color: T.textMuted, fontSize: T.small, marginTop: 4 },
  emptyArrow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: T.md },
  emptyArrowText: { color: T.primary, fontSize: T.small, fontWeight: '700' },

  actionRow: {
    flexDirection: 'row', alignItems: 'center', gap: T.md,
    paddingVertical: T.md, paddingHorizontal: T.md,
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    borderWidth: 1, borderColor: T.border, marginBottom: T.sm,
  },
  actionLabel: { flex: 1, color: T.text, fontSize: T.body, fontWeight: '600' },

  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: T.xl, paddingVertical: T.md, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
  },
  logoutText: { color: T.danger, fontSize: T.body, fontWeight: '700' },
});
