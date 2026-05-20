// Client → Module Catalog
//
// Curated 3-item catalog of expansion modules. The user opens it from a
// project screen, taps "Add module" on a card, and the backend inserts a
// new module into the project at status="pending". From there the existing
// pipeline (in_progress → review → approve → invoice → pay) takes over.
//
// Intentionally minimal: no filters, categories, search or dynamic pricing.

import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../../src/api';
import T from '../../../src/theme';

type CatalogItem = {
  slug: string;
  title: string;
  description: string;
  price: number;
  estimated_hours: number;
  template_type: string;
};

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  '2fa':       'shield-checkmark',
  payments:    'card',
  analytics:   'stats-chart',
};

export default function ModuleCatalogScreen() {
  const { projectId, projectTitle } = useLocalSearchParams<{
    projectId: string; projectTitle?: string;
  }>();
  const router = useRouter();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/client/modules/catalog');
      setItems(r.data?.items || []);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addModule = async (item: CatalogItem) => {
    if (!projectId) return;
    setAdding(item.slug);
    try {
      await api.post(`/client/projects/${projectId}/modules/add`, { slug: item.slug });
      Alert.alert(
        'Module added',
        `${item.title} is now in your project. You'll be billed when it's approved.`,
        [{ text: 'Back to project', onPress: () => router.back() }],
      );
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.detail || 'Could not add module');
    } finally {
      setAdding(null);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[s.flex, s.center]} edges={['top']}>
        <ActivityIndicator color={T.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.flex} edges={['top']}>
      <View style={s.topBar}>
        <TouchableOpacity
          testID="catalog-back"
          onPress={() => router.back()}
          style={s.backIcon}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={22} color={T.text} />
          <Text style={s.backLabel}>Back</Text>
        </TouchableOpacity>
        <Text style={s.topTitle} numberOfLines={1}>Improve your product</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        style={s.flex}
        contentContainerStyle={s.container}
        testID="module-catalog-screen"
      >
        <Text style={s.intro}>
          Add a new capability to {projectTitle ? `"${projectTitle}"` : 'your project'}.
          You'll only pay when the module is approved.
        </Text>

        {items.map((item) => (
          <View key={item.slug} style={s.card} testID={`catalog-card-${item.slug}`}>
            <View style={s.cardHeader}>
              <View style={s.iconWrap}>
                <Ionicons
                  name={ICONS[item.slug] || 'cube-outline'}
                  size={20}
                  color={T.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>{item.title}</Text>
                <Text style={s.cardDesc} numberOfLines={3}>{item.description}</Text>
              </View>
            </View>

            <View style={s.cardFooter}>
              <Text style={s.price}>+${item.price.toLocaleString('en-US')}</Text>
              <TouchableOpacity
                testID={`add-module-${item.slug}`}
                style={[s.addBtn, adding === item.slug && { opacity: 0.6 }]}
                onPress={() => addModule(item)}
                disabled={!!adding}
                activeOpacity={0.85}
              >
                <Text style={s.addBtnText}>
                  {adding === item.slug ? 'Adding…' : 'Add module'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        <Text style={s.footer}>
          Same flow as every other module — pending → in progress → review → approve → invoice → pay.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: T.bg },
  center: { justifyContent: 'center', alignItems: 'center' },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: T.md, paddingVertical: T.sm,
    borderBottomWidth: 1, borderBottomColor: T.border,
    backgroundColor: T.surface1,
  },
  backIcon: { flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 60 },
  backLabel: { color: T.text, fontSize: T.small, fontWeight: '600' },
  topTitle: { color: T.text, fontSize: T.body, fontWeight: '700', flex: 1, textAlign: 'center', marginHorizontal: 8 },

  container: { padding: T.lg, paddingBottom: 100 },
  intro: { color: T.textSecondary, fontSize: T.small, marginBottom: T.lg, lineHeight: 20 },

  card: {
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.border,
    borderRadius: T.radius,
    padding: T.md,
    marginBottom: T.md,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  iconWrap: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: T.primaryBg,
    borderWidth: 1, borderColor: T.primaryBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  cardDesc: { color: T.textMuted, fontSize: T.small, marginTop: 4, lineHeight: 18 },

  cardFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: T.md, paddingTop: T.md,
    borderTopWidth: 1, borderTopColor: T.border,
  },
  price: { color: T.text, fontSize: T.h3, fontWeight: '800' },

  addBtn: {
    backgroundColor: T.primary,
    paddingHorizontal: 18, paddingVertical: 10,
    borderRadius: T.radiusSm,
  },
  addBtnText: { color: T.bg, fontSize: T.body, fontWeight: '800' },

  footer: { color: T.textMuted, fontSize: T.tiny, textAlign: 'center', marginTop: T.lg, lineHeight: 16 },
});
