import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from './api';
import T from './theme';

type Truth = {
  verdict: 'working' | 'drifting' | 'pretending' | 'idle';
  pressure: { level: 'low' | 'medium' | 'high'; main_reason: string; dominant_factor: string };
  flow: {
    avg_time_to_first_bid_hours: number | null;
    modules_without_bids: number;
    modules_with_1_bid: number;
    modules_with_3plus_bids: number;
    open_modules: number;
  };
  developers: { idle: number; overloaded: number; balanced: number; ghosts: number; total: number };
  revenue: { blocked_projects: number; clients_ready_to_pay: number; churn_risk: number; expansion_ready: number };
  drift: { detected: boolean; type: string | null; since_minutes: number | null; reason?: string };
  real_activity: { real_bids_last_10m: number; fake_pressure_actions: number; signal_quality: string };
  multiplier: number;
  generated_at: string;
};

const VERDICT_META: Record<string, { label: string; color: string; icon: any; subtitle: string }> = {
  working:    { label: 'Working',    color: T.success, icon: 'checkmark-circle', subtitle: 'System healthy and signals are real' },
  drifting:   { label: 'Drifting',   color: T.warning, icon: 'trending-down',    subtitle: 'Scaling firing but NOT healing' },
  pretending: { label: 'Under Pressure', color: T.danger, icon: 'warning',       subtitle: 'No real bids despite scaling' },
  idle:       { label: 'Idle',       color: T.textMuted, icon: 'moon',             subtitle: 'No real activity in the market' },
  empty_market: { label: 'Empty Market', color: T.textMuted, icon: 'hourglass',    subtitle: 'No developers, no modules — nothing to work on yet' },
};

const PRESSURE_COLOR: Record<string, string> = { low: T.success, medium: T.warning, high: T.danger };
const QUALITY_COLOR: Record<string, string> = { high: T.success, medium: T.warning, neutral: T.textMuted, low: T.danger };

export default function SystemTruth() {
  const [truth, setTruth] = useState<Truth | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/system/truth');
      setTruth(res.data);
    } catch (e) {
      console.error('system.truth error', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  if (loading && !truth) {
    return (
      <View style={s.card} testID="system-truth-loading">
        <ActivityIndicator color={T.primary} />
      </View>
    );
  }
  if (!truth) return null;

  const verdict = VERDICT_META[truth.verdict] || VERDICT_META.working;
  const pressureColor = PRESSURE_COLOR[truth.pressure.level] || T.textMuted;
  const qColor = QUALITY_COLOR[truth.real_activity.signal_quality] || T.textMuted;

  return (
    <TouchableOpacity
      testID="system-truth-card"
      activeOpacity={0.85}
      onPress={() => setExpanded((v) => !v)}
      style={[s.card, { borderLeftColor: verdict.color }]}
    >
      <View style={s.headerRow}>
        <View style={s.headerLeft}>
          <Ionicons name={verdict.icon} size={20} color={verdict.color} />
          <View>
            <Text style={s.title} testID="system-truth-label">
              System Status: <Text style={{ color: verdict.color }}>{verdict.label}</Text>
            </Text>
            <Text style={s.subtitle} testID="system-truth-reason">
              {truth.drift.detected
                ? `Drift detected: ${truth.drift.reason || truth.drift.type}`
                : truth.verdict === 'pretending'
                  ? `No real bids despite scaling · ${truth.pressure.main_reason}`
                  : verdict.subtitle}
            </Text>
          </View>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={T.textMuted} />
      </View>

      <View style={s.pillsRow}>
        <View style={[s.pill, { backgroundColor: pressureColor + '22', borderColor: pressureColor }]}>
          <Text style={[s.pillText, { color: pressureColor }]}>
            Pressure · {truth.pressure.level}
          </Text>
        </View>
        <View style={[s.pill, { backgroundColor: qColor + '22', borderColor: qColor }]}>
          <Text style={[s.pillText, { color: qColor }]}>
            Signal · {truth.real_activity.signal_quality}
          </Text>
        </View>
        {truth.drift.detected && (
          <View style={[s.pill, { backgroundColor: T.warningBg, borderColor: T.warningBorder }]}>
            <Text style={[s.pillText, { color: T.warning }]} testID="system-truth-drift">
              Drift · {truth.drift.type}
            </Text>
          </View>
        )}
      </View>

      {expanded && (
        <View style={s.detail} testID="system-truth-detail">
          <Row label="Flow · open modules" value={`${truth.flow.open_modules}`} />
          <Row label="Flow · no bids" value={`${truth.flow.modules_without_bids}`} bad={truth.flow.modules_without_bids > 0} />
          <Row
            label="Flow · avg time to 1st bid"
            value={truth.flow.avg_time_to_first_bid_hours != null ? `${truth.flow.avg_time_to_first_bid_hours}h` : '—'}
          />
          <Row label="Devs · idle" value={`${truth.developers.idle}`} />
          <Row label="Devs · overloaded" value={`${truth.developers.overloaded}`} bad={truth.developers.overloaded > 0} />
          <Row label="Devs · ghosts" value={`${truth.developers.ghosts}`} bad={truth.developers.ghosts > 0} />
          <Row label="Revenue · blocked projects" value={`${truth.revenue.blocked_projects}`} bad={truth.revenue.blocked_projects > 0} />
          <Row label="Revenue · churn risk" value={`${truth.revenue.churn_risk}`} bad={truth.revenue.churn_risk > 0} />
          <Row label="Revenue · expansion ready" value={`${truth.revenue.expansion_ready}`} good={truth.revenue.expansion_ready > 0} />
          <Row label="Real bids (last 10m)" value={`${truth.real_activity.real_bids_last_10m}`} />
          <Row
            label="Scaling actions (last 1h)"
            value={`${truth.real_activity.fake_pressure_actions}`}
            bad={truth.real_activity.fake_pressure_actions > 0 && truth.real_activity.real_bids_last_10m === 0}
          />
          <Row label="Global multiplier" value={`×${truth.multiplier.toFixed(2)}`} />
        </View>
      )}
    </TouchableOpacity>
  );
}

function Row({ label, value, bad, good }: { label: string; value: string; bad?: boolean; good?: boolean }) {
  const color = bad ? T.danger : good ? T.success : T.text;
  return (
    <View style={s.rowLine}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, { color }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: T.surface2,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: T.primary,
    borderWidth: 1,
    borderColor: T.border,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  title: { color: T.text, fontWeight: '700', fontSize: 15 },
  subtitle: { color: T.textMuted, fontSize: 12, marginTop: 2, maxWidth: 260 },
  pillsRow: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  pillText: { fontSize: 11, fontWeight: '600' },
  detail: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: T.border, gap: 6 },
  rowLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { color: T.textMuted, fontSize: 12 },
  rowValue: { color: T.text, fontSize: 12, fontWeight: '600' },
});
