import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/auth';
import { Ionicons } from '@expo/vector-icons';
import T from '../../src/theme';

export default function ClientMore() {
  const { user, logout } = useAuth();
  const router = useRouter();

  return (
    <View style={s.container}>
      <Text style={s.title}>More</Text>
      <View style={s.profile}>
        <View style={s.avatar}><Text style={s.avatarText}>{user?.name?.[0] || 'C'}</Text></View>
        <View><Text style={s.name}>{user?.name}</Text><Text style={s.role}>client — {user?.email}</Text></View>
      </View>
      {[
        { label: 'Referrals', icon: 'people', route: '/client/referrals' },
        { label: 'Documents', icon: 'document-text', route: '/documents' },
      ].map(i => (
        <TouchableOpacity
          key={i.label}
          style={s.item}
          onPress={() => router.push(i.route as any)}
          testID={`client-more-${i.label.toLowerCase()}`}
        >
          <Ionicons name={i.icon as any} size={20} color={T.textMuted} />
          <Text style={s.itemLabel}>{i.label}</Text>
          <Ionicons name="chevron-forward" size={16} color={T.textMuted} />
        </TouchableOpacity>
      ))}
      {user && user.roles.length > 1 && (
        <TouchableOpacity testID="client-switch-role" style={s.item} onPress={() => router.replace('/gateway')}><Ionicons name="swap-horizontal" size={20} color={T.primary} /><Text style={[s.itemLabel, { color: T.primary }]}>Switch Role</Text><Ionicons name="chevron-forward" size={16} color={T.primary} /></TouchableOpacity>
      )}
      <TouchableOpacity testID="client-logout" style={s.item} onPress={() => { logout(); router.replace('/auth'); }}><Ionicons name="log-out" size={20} color={T.danger} /><Text style={[s.itemLabel, { color: T.danger }]}>Sign Out</Text></TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg, padding: T.md },
  title: { color: T.text, fontSize: T.h1, fontWeight: '800', marginBottom: T.lg },
  profile: { flexDirection: 'row', alignItems: 'center', backgroundColor: T.surface1, borderRadius: T.radius, padding: T.md, marginBottom: T.lg, borderWidth: 1, borderColor: T.border },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: T.infoBorder, alignItems: 'center', justifyContent: 'center', marginRight: T.md },
  avatarText: { color: T.info, fontSize: T.h2, fontWeight: '700' },
  name: { color: T.text, fontSize: T.h3, fontWeight: '600' },
  role: { color: T.textMuted, fontSize: T.small },
  item: { flexDirection: 'row', alignItems: 'center', backgroundColor: T.surface1, borderRadius: T.radiusSm, padding: T.md, marginBottom: T.sm, gap: T.md, borderWidth: 1, borderColor: T.border },
  itemLabel: { color: T.text, fontSize: T.body, flex: 1 },
});
