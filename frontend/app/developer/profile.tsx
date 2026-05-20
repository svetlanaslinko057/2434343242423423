/**
 * Developer Profile — root tab
 *
 * Strict per-spec layout:
 *   [ Identity: avatar, name/email, role badge ]
 *   [ Roles → switch to client (if multi-role) ]
 *   [ Wallet shortcut: balance + Withdraw ]
 *   [ Account: Settings, Time Logs, Sign out ]
 *
 * No leaderboard, growth, feedback, etc. Those return only when their
 * backend data is real and stable. Until then, profile stays clean.
 */
import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { T } from '../../src/theme';
import { runtime } from '../../src/runtime';
import { ApiError } from '../../src/runtime-client';
import { useMe } from '../../src/use-me';
import { useAuth } from '../../src/auth';
import { useT } from '../../src/i18n';

type Wallet = {
  available_balance?: number;
  pending_withdrawal?: number;
  withdrawn_lifetime?: number;
};

const ROLE_META: Record<string, { label: string; color: string; icon: any }> = {
  developer: { label: 'Developer', color: T.primary, icon: 'code-slash' },
  client:    { label: 'Client',    color: T.primary, icon: 'briefcase' },
  admin:     { label: 'Admin',     color: T.role,    icon: 'shield-checkmark' },
};

export default function DeveloperProfile() {
  const router = useRouter();
  const { logout } = useAuth();
  const { me, refresh } = useMe();
  const { t } = useT();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await runtime.get<Wallet>('/api/developer/wallet');
        setWallet(data);
      } catch {
        /* keep null */
      } finally {
        setWalletLoading(false);
      }
    })();
  }, []);

  const switchContext = async (ctx: string) => {
    try {
      setSwitching(ctx);
      // No idempotencyKey: rare action gated by explicit row tap; backend
      // is idempotent on identical context (POST /me/context with same value
      // is a no-op). No `capability: 'payment'` — identity-layer transition.
      await runtime.post('/api/me/context', { context: ctx });
      await refresh();
      if (ctx === 'client') router.replace('/client/home' as any);
      else if (ctx === 'admin') router.replace('/admin/home' as any);
    } catch (e: any) {
      const msg = e instanceof ApiError ? (e.hint || e.message) : (e?.response?.data?.detail || String(e));
      Alert.alert('Switch failed', msg);
    } finally {
      setSwitching(null);
    }
  };

  const doLogout = async () => {
    await logout();
    router.replace('/' as any);
  };

  const initial = (me?.name || me?.email || 'U').trim().charAt(0).toUpperCase();
  const states: string[] = me?.states || [];
  const otherRoles = states.filter((r) => r !== 'developer');
  const available = wallet?.available_balance ?? 0;
  const pending = wallet?.pending_withdrawal ?? 0;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} testID="developer-profile">
      {/* IDENTITY */}
      <View style={s.identityCard}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>{initial}</Text>
        </View>
        <Text style={s.name}>{me?.name || t('profile.you')}</Text>
        {!!me?.email && <Text style={s.email}>{me.email}</Text>}
        <View style={s.roleBadge}>
          <Ionicons name={ROLE_META.developer.icon} size={12} color={T.primary} />
          <Text style={s.roleBadgeText}>{t('profile.role.developer')}</Text>
        </View>
      </View>

      {/* WALLET shortcut */}
      <Text style={s.section}>{t('profile.section.wallet')}</Text>
      <View style={s.walletCard}>
        {walletLoading ? (
          <ActivityIndicator color={T.primary} />
        ) : (
          <>
            <View style={s.walletTop}>
              <View>
                <Text style={s.walletLabel}>{t('profile.wallet.available')}</Text>
                <Text style={s.walletValue}>${available.toFixed(2)}</Text>
              </View>
              {pending > 0 && (
                <View style={s.pendingPill}>
                  <Text style={s.pendingText}>${pending.toFixed(2)} {t('profile.wallet.pending')}</Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              testID="profile-withdraw-btn"
              style={[s.cta, available <= 0 && s.ctaDisabled]}
              onPress={() => router.push('/developer/wallet' as any)}
              disabled={available <= 0}
            >
              <Ionicons name="arrow-down-circle" size={16} color={T.primaryInk} />
              <Text style={s.ctaText}>{t('profile.wallet.withdraw')}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* ROLES — only when user has more than one */}
      {otherRoles.length > 0 && (
        <>
          <Text style={s.section}>{t('profile.section.roles')}</Text>
          {otherRoles.map((r) => {
            const meta = ROLE_META[r];
            if (!meta) return null;
            const roleLabel = r === 'client' ? t('profile.role.client') : r === 'admin' ? t('profile.role.admin') : meta.label;
            return (
              <TouchableOpacity
                key={r}
                testID={`profile-switch-${r}`}
                style={s.row}
                onPress={() => switchContext(r)}
                disabled={!!switching}
              >
                <View style={[s.rowIcon, { backgroundColor: `${meta.color}22` }]}>
                  <Ionicons name={meta.icon} size={18} color={meta.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowLabel}>{t('profile.role.switch_to')} {roleLabel}</Text>
                  <Text style={s.rowSub}>{t('profile.role.also_have')} {roleLabel.toLowerCase()}</Text>
                </View>
                {switching === r ? (
                  <ActivityIndicator color={T.primary} />
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={T.textMuted} />
                )}
              </TouchableOpacity>
            );
          })}
        </>
      )}

      {/* DEVELOPER INSIGHTS — projection of the economy */}
      <Text style={s.section}>{t('profile.section.insights')}</Text>
      <TouchableOpacity
        testID="profile-leaderboard"
        style={s.row}
        onPress={() => router.push('/developer/leaderboard' as any)}
      >
        <View style={s.rowIconNeutral}>
          <Ionicons name="trophy-outline" size={18} color={T.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.rowLabel}>{t('profile.row.leaderboard')}</Text>
          <Text style={s.rowSub}>{t('profile.row.leaderboard_sub')}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={T.textMuted} />
      </TouchableOpacity>

      <TouchableOpacity
        testID="profile-growth"
        style={s.row}
        onPress={() => router.push('/developer/growth' as any)}
      >
        <View style={s.rowIconNeutral}>
          <Ionicons name="trending-up-outline" size={18} color={T.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.rowLabel}>{t('profile.row.growth')}</Text>
          <Text style={s.rowSub}>{t('profile.row.growth_sub')}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={T.textMuted} />
      </TouchableOpacity>

      {/* HUMAN VALIDATION PROGRAM — extra-credits side channel for devs */}
      <TouchableOpacity
        testID="profile-validation"
        style={s.row}
        onPress={() => router.push('/developer/validation' as never)}
      >
        <View style={s.rowIconNeutral}>
          <Ionicons name="sparkles-outline" size={18} color={T.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.rowLabel}>Validation missions</Text>
          <Text style={s.rowSub}>Earn extra credits between work units</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={T.textMuted} />
      </TouchableOpacity>

      {/* SUPPORT — direct line to admin (P0: ticket system + live chat) */}
      <Text style={s.section}>{t('profile.section.support') || 'Support'}</Text>
      <TouchableOpacity
        testID="profile-support-tickets"
        style={s.row}
        onPress={() => router.push('/developer/support' as any)}
      >
        <View style={[s.rowIcon, { backgroundColor: T.primaryBg }]}>
          <Ionicons name="help-buoy-outline" size={18} color={T.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.rowLabel}>Support tickets</Text>
          <Text style={s.rowSub}>Report bugs, payout issues, or ask questions</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={T.textMuted} />
      </TouchableOpacity>

      <TouchableOpacity
        testID="profile-live-chat"
        style={s.row}
        onPress={() => router.push('/chat' as any)}
      >
        <View style={[s.rowIcon, { backgroundColor: T.primaryBg }]}>
          <Ionicons name="chatbubbles-outline" size={18} color={T.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.rowLabel}>Live chat with admin</Text>
          <Text style={s.rowSub}>Quick questions in one thread</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={T.textMuted} />
      </TouchableOpacity>

      <TouchableOpacity
        testID="profile-notifications"
        style={s.row}
        onPress={() => router.push('/developer/notifications' as any)}
      >
        <View style={s.rowIconNeutral}>
          <Ionicons name="notifications-outline" size={18} color={T.text} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.rowLabel}>Notifications</Text>
          <Text style={s.rowSub}>Full event history</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={T.textMuted} />
      </TouchableOpacity>

      {/* ACCOUNT */}
      <Text style={s.section}>{t('profile.section.account')}</Text>
      <TouchableOpacity
        testID="profile-settings"
        style={s.row}
        onPress={() => router.push('/settings' as any)}
      >
        <View style={s.rowIconNeutral}>
          <Ionicons name="settings-outline" size={18} color={T.text} />
        </View>
        <Text style={s.rowLabel}>{t('profile.row.settings')}</Text>
        <Ionicons name="chevron-forward" size={18} color={T.textMuted} />
      </TouchableOpacity>

      <TouchableOpacity
        testID="profile-time-logs"
        style={s.row}
        onPress={() => router.push('/developer/time-logs' as any)}
      >
        <View style={s.rowIconNeutral}>
          <Ionicons name="time-outline" size={18} color={T.text} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.rowLabel}>{t('profile.row.time_logs')}</Text>
          <Text style={s.rowSub}>{t('profile.row.time_logs_sub')}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={T.textMuted} />
      </TouchableOpacity>

      {/* LOGOUT */}
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

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.lg, paddingBottom: T.xl * 2 },
  section: {
    color: T.textMuted, fontSize: 11, fontWeight: '700',
    letterSpacing: 1.4, textTransform: 'uppercase',
    marginTop: T.lg, marginBottom: T.sm, paddingHorizontal: 4,
  },
  identityCard: {
    alignItems: 'center',
    paddingVertical: T.xl,
    backgroundColor: T.surface,
    borderRadius: T.radius,
    borderWidth: 1,
    borderColor: T.border,
  },
  avatar: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: T.primaryBg,
    borderWidth: 1, borderColor: T.primaryBorder,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: T.md,
  },
  avatarText: { color: T.primary, fontSize: 32, fontWeight: '900' },
  name: { color: T.text, fontSize: 22, fontWeight: '800' },
  email: { color: T.textMuted, fontSize: 13, marginTop: 4 },
  roleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: T.primaryBg,
    borderColor: T.primaryBorder,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4,
    marginTop: T.sm,
  },
  roleBadgeText: { color: T.primary, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },

  walletCard: {
    backgroundColor: T.surface,
    borderRadius: T.radius,
    borderWidth: 1, borderColor: T.primaryBorder,
    padding: T.md,
  },
  walletTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: T.md },
  walletLabel: { color: T.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  walletValue: { color: T.primary, fontSize: 28, fontWeight: '900', marginTop: 2 },
  pendingPill: {
    backgroundColor: 'rgba(245,196,81,0.10)',
    borderWidth: 1, borderColor: 'rgba(245,196,81,0.35)',
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
  },
  pendingText: { color: T.risk, fontSize: 11, fontWeight: '700' },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: T.primary,
    paddingVertical: 12, borderRadius: T.radius,
  },
  ctaDisabled: { backgroundColor: T.primaryBorder },
  ctaText: { color: T.primaryInk, fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: T.md,
    backgroundColor: T.surface,
    borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
    padding: T.md,
    marginBottom: T.sm,
  },
  rowIcon: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  rowIconNeutral: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: T.bg,
    borderWidth: 1, borderColor: T.border,
    alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { color: T.text, fontSize: 14, fontWeight: '600', flex: 1 },
  rowSub: { color: T.textMuted, fontSize: 12, marginTop: 2 },

  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: T.lg,
    paddingVertical: 14,
    borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
  },
  logoutText: { color: T.danger, fontSize: 14, fontWeight: '700' },
});
