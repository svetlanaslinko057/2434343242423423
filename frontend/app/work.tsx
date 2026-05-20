import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useMe } from '../src/use-me';
import { resolveRoute } from '../src/route-resolver';
import T from '../src/theme';

/**
 * /work — headless redirector keyed on active_context. Re-runs resolveRoute
 * so ContextSwitcher changes land here and propagate to the right surface.
 */
export default function Work() {
  const { me, loading } = useMe();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(resolveRoute(me) as any);
  }, [me, loading, router]);

  return (
    <View style={s.c}><ActivityIndicator color={T.primary} /></View>
  );
}
const s = StyleSheet.create({ c: { flex: 1, backgroundColor: T.bg, alignItems: 'center', justifyContent: 'center' } });
