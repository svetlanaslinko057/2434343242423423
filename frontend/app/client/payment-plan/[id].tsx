/**
 * Phase 5 — Client Payment Plan picker.
 *
 * 4 fixed plans, side-by-side cards. Backend provides preview splits in $.
 * Pick → POST /api/client/projects/{id}/payment-plan → navigate to contract.
 *
 * Locked once contract is signed.
 */
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import api from '../../../src/api';
import T from '../../../src/theme';

type Step = { amount: number; kind: string; title_suffix?: string; module_id?: string | null };
type Plan = {
  plan: 'full' | '50_50' | '30_40_30' | 'modules';
  label: string;
  description: string;
  steps_count: number;
  steps: Step[];
};
type Preview = {
  project_id: string;
  currency: string;
  total: number;
  selected_plan: string;
  locked: boolean;
  plans: Plan[];
};

const fmt = (n: number) => `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function PaymentPlanScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = String(id || '');

  const [data, setData] = useState<Preview | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/client/projects/${projectId}/payment-plan/preview`);
      setData(r.data);
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Could not load plans');
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const pick = async (plan: string) => {
    if (data?.locked) {
      Alert.alert('Plan locked', 'Contract is already signed — payment plan cannot be changed.');
      return;
    }
    setPicking(plan);
    try {
      await api.post(`/client/projects/${projectId}/payment-plan`, { plan });
      router.replace(`/client/contract/${projectId}` as any);
    } catch (e: any) {
      Alert.alert('Could not save plan', e?.response?.data?.detail || 'Try again');
      setPicking(null);
    }
  };

  if (!data && !error) {
    return <View style={s.centered}><ActivityIndicator color={T.primary} /></View>;
  }
  if (!data) {
    return (
      <View style={s.centered}>
        <Text style={{ color: T.danger, marginBottom: T.md }}>{error}</Text>
        <TouchableOpacity onPress={load} style={s.retry}><Text style={s.retryText}>Retry</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} testID="payment-plan-screen">
      <View style={s.topRow}>
        <TouchableOpacity onPress={() => router.back()} style={s.iconBtn} testID="plan-back">
          <Ionicons name="chevron-back" size={22} color={T.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
      </View>

      <Text style={s.h1}>How would you like to pay?</Text>
      <Text style={s.subhead}>
        Total {fmt(data.total)} {data.currency}. Pick a plan that suits your cashflow.
      </Text>

      {data.locked ? (
        <View style={s.lockedBanner} testID="plan-locked-banner">
          <Ionicons name="lock-closed" size={14} color={T.warning} />
          <Text style={s.lockedText}>
            Contract signed — plan locked at {data.selected_plan}.
          </Text>
        </View>
      ) : null}

      {data.plans.map((p) => {
        const selected = data.selected_plan === p.plan;
        const disabled = picking === p.plan;
        return (
          <TouchableOpacity
            key={p.plan}
            testID={`plan-card-${p.plan}`}
            disabled={disabled || data.locked}
            onPress={() => pick(p.plan)}
            activeOpacity={0.85}
            style={[s.card, selected && s.cardSelected]}
          >
            <View style={s.cardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={s.planLabel}>{p.label}</Text>
                <Text style={s.planDesc}>{p.description}</Text>
              </View>
              {selected ? (
                <View style={s.checkBadge}>
                  <Ionicons name="checkmark" size={14} color={T.primaryInk} />
                </View>
              ) : null}
            </View>

            <View style={s.steps}>
              {p.steps.map((st, idx) => (
                <View key={idx} style={s.stepRow}>
                  <Text style={s.stepLabel}>
                    {p.plan === 'modules'
                      ? (st.title_suffix || `Module ${idx + 1}`)
                      : `Step ${idx + 1} · ${st.kind}`}
                  </Text>
                  <Text style={s.stepAmount}>{fmt(st.amount)}</Text>
                </View>
              ))}
            </View>

            {!data.locked ? (
              <View style={[s.cta, selected && s.ctaPrimary]}>
                {disabled ? (
                  <ActivityIndicator size="small" color={selected ? T.primaryInk : T.primary} />
                ) : (
                  <Text style={[s.ctaText, selected && s.ctaTextPrimary]}>
                    {selected ? 'Continue with this plan' : 'Choose this plan'}
                  </Text>
                )}
              </View>
            ) : null}
          </TouchableOpacity>
        );
      })}

      <Text style={s.footer}>
        Plan locks at contract sign · Payment processed via WayForPay
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.lg, paddingBottom: T.xl * 2 },
  centered: { flex: 1, backgroundColor: T.bg, alignItems: 'center', justifyContent: 'center' },
  topRow: { flexDirection: 'row', alignItems: 'center', marginBottom: T.sm },
  iconBtn: { padding: 6 },

  h1: { color: T.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.5, marginBottom: 6 },
  subhead: { color: T.textMuted, fontSize: T.body, marginBottom: T.lg },

  lockedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: T.warningBg, borderColor: T.warningBorder, borderWidth: 1,
    borderRadius: T.radiusSm, padding: 10, marginBottom: T.md,
  },
  lockedText: { color: T.warning, fontSize: T.small, fontWeight: '700' },

  card: {
    backgroundColor: T.surface1, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.border,
    padding: T.md, marginBottom: T.md,
  },
  cardSelected: { borderColor: T.primary, borderWidth: 2 },

  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: T.sm },
  planLabel: { color: T.text, fontSize: T.h3, fontWeight: '800' },
  planDesc: { color: T.textMuted, fontSize: T.small, marginTop: 2 },

  checkBadge: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center',
  },

  steps: { borderTopWidth: 1, borderTopColor: T.border, paddingTop: T.sm, marginTop: 4 },
  stepRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  stepLabel: { color: T.textMuted, fontSize: T.small, flex: 1, paddingRight: 8 },
  stepAmount: { color: T.text, fontSize: T.body, fontWeight: '700' },

  cta: {
    marginTop: T.md, paddingVertical: 12,
    borderRadius: T.radiusSm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: T.surface2,
  },
  ctaPrimary: {
    backgroundColor: T.primary,
    ...Platform.select({
      ios: { shadowColor: T.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12 },
      android: { elevation: 8 },
      default: {},
    }),
  },
  ctaText: { color: T.textMuted, fontSize: T.small, fontWeight: '700' },
  ctaTextPrimary: { color: T.primaryInk, fontSize: T.body, fontWeight: '800' },

  retry: { padding: T.md, backgroundColor: T.surface1, borderRadius: T.radiusSm },
  retryText: { color: T.primary, fontWeight: '700' },

  footer: { color: T.textMuted, fontSize: T.tiny, textAlign: 'center', opacity: 0.6, marginTop: T.md },
});
