import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '../src/auth';
import { useMe } from '../src/use-me';
import { Ionicons } from '@expo/vector-icons';
import api from '../src/api';
import T from '../src/theme';

/**
 * Gateway — welcome-экран выбора контекста.
 *
 * Куда ведёт resolveUserEntry:
 *   • states.length === 0        → сюда (новый юзер, роль ещё не выбрана)
 *   • states.length >= 2 и нет   → сюда (мульти-роль без активного контекста)
 *   • states.length === 1        → сразу в родной кабинет, сюда НЕ попадает
 *
 * Внутри два режима:
 *   • onboarding (states.length === 0): две крупные кнопки — "Build a product"
 *     и "Join as developer" — это стартовый выбор трека.
 *   • multi-role: список ролей юзера с родными маршрутами.
 */

const ROLES = [
  { role: 'admin', label: 'Admin', desc: 'Control Center', icon: 'shield-checkmark' as const, color: T.role, route: '/admin/home' },
  { role: 'developer', label: 'Developer', desc: 'Execution Hub', icon: 'code-slash' as const, color: T.primary, route: '/developer/home' },
  { role: 'client', label: 'Client', desc: 'Project Workspace', icon: 'briefcase' as const, color: T.info, route: '/client/home' },
  { role: 'tester', label: 'Tester', desc: 'QA Hub', icon: 'bug' as const, color: T.risk, route: '/admin/qa' },
];

export default function GatewayScreen() {
  const { user, switchRole, logout } = useAuth();
  const { me, refresh } = useMe();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  if (!user) return null;

  const states: string[] = me?.states || user.roles || [];
  const isOnboarding = states.length === 0;

  const handleRole = async (role: string, route: string) => {
    try {
      await switchRole(role);
    } catch {
      /* не критично — многие роли не требуют switch */
    }
    router.replace(route as any);
  };

  // Onboarding: стартовый выбор трека для юзера без ролей.
  if (isOnboarding) {
    const goClient = () => {
      // Переход в /project/wizard сам активирует state=client при создании
      // первого проекта на бэке. Сюда юзер больше не вернётся.
      router.replace('/project/wizard' as any);
    };
    const goDeveloper = async () => {
      try {
        setBusy('dev');
        await api.post('/developer/apply');
        await refresh();
        router.replace('/developer/home' as any);
      } catch {
        setBusy(null);
      }
    };

    return (
      <View style={s.container}>
        <View style={s.header}>
          <Text style={s.greeting}>Welcome, {user.name || 'friend'}</Text>
          <Text style={s.name}>What brings you here?</Text>
          <Text style={s.subtle}>Pick your track — you can switch later.</Text>
        </View>

        <TouchableOpacity testID="gateway-onboarding-client" style={[s.bigCard, { borderColor: T.infoBorder }]} onPress={goClient}>
          <View style={[s.iconWrap, { backgroundColor: T.infoBgStrong }]}>
            <Ionicons name="briefcase" size={28} color={T.info} />
          </View>
          <View style={s.roleInfo}>
            <Text style={s.roleLabel}>Build a product</Text>
            <Text style={s.roleDesc}>Describe your idea · get a real plan · ship it</Text>
          </View>
          <Ionicons name="arrow-forward" size={20} color={T.info} />
        </TouchableOpacity>

        <TouchableOpacity testID="gateway-onboarding-developer" style={[s.bigCard, { borderColor: T.primaryBorder }]} onPress={goDeveloper} disabled={busy === 'dev'}>
          <View style={[s.iconWrap, { backgroundColor: T.primaryBgStrong }]}>
            <Ionicons name="code-slash" size={28} color={T.primary} />
          </View>
          <View style={s.roleInfo}>
            <Text style={s.roleLabel}>Join as developer</Text>
            <Text style={s.roleDesc}>Pick modules · get paid for results · grow</Text>
          </View>
          {busy === 'dev' ? <ActivityIndicator color={T.primary} /> : <Ionicons name="arrow-forward" size={20} color={T.primary} />}
        </TouchableOpacity>

        <TouchableOpacity testID="gateway-logout-btn" style={s.logoutBtn} onPress={() => { logout(); router.replace('/auth'); }}>
          <Text style={s.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Multi-role: мультиролевой выбор активного контекста.
  const availableRoles = ROLES.filter(r => states.includes(r.role));

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.greeting}>Welcome back</Text>
        <Text style={s.name}>{user.name}</Text>
      </View>

      <Text style={s.label}>Continue as</Text>

      {availableRoles.map(r => (
        <TouchableOpacity key={r.role} testID={`gateway-role-${r.role}`} style={s.roleCard} onPress={() => handleRole(r.role, r.route)}>
          <View style={[s.iconWrap, { backgroundColor: r.color + '22' }]}>
            <Ionicons name={r.icon} size={24} color={r.color} />
          </View>
          <View style={s.roleInfo}>
            <Text style={s.roleLabel}>{r.label}</Text>
            <Text style={s.roleDesc}>{r.desc}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={T.textMuted} />
        </TouchableOpacity>
      ))}

      <TouchableOpacity testID="gateway-logout-btn" style={s.logoutBtn} onPress={() => { logout(); router.replace('/auth'); }}>
        <Text style={s.logoutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg, padding: T.lg, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: T.xl },
  greeting: { color: T.textMuted, fontSize: T.body },
  name: { color: T.text, fontSize: T.h1, fontWeight: '800', marginTop: T.xs, textAlign: 'center' },
  subtle: { color: T.textMuted, fontSize: T.small, marginTop: T.sm, textAlign: 'center' },
  label: { color: T.textMuted, fontSize: T.small, marginBottom: T.md, textTransform: 'uppercase', letterSpacing: 2 },
  roleCard: { backgroundColor: T.surface1, borderRadius: T.radius, padding: T.lg, marginBottom: T.md, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: T.border },
  bigCard: { backgroundColor: T.surface1, borderRadius: T.radius, padding: T.lg, marginBottom: T.md, flexDirection: 'row', alignItems: 'center', borderWidth: 2, gap: T.md },
  iconWrap: { width: 56, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: T.md },
  roleInfo: { flex: 1 },
  roleLabel: { color: T.text, fontSize: T.h3, fontWeight: '700' },
  roleDesc: { color: T.textMuted, fontSize: T.small, marginTop: 2 },
  logoutBtn: { marginTop: T.xl, alignItems: 'center', padding: T.md },
  logoutText: { color: T.danger, fontSize: T.body },
});
