import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from './api';
import T from './theme';

// Wave 11 — System Balance block for admin.
// Shows: overloaded/idle/stuck counts · avg bids · global multiplier · efficiency.
// CTA: Auto balance (runs stuck/load/demand engines in one shot).

const PRESSURE_META: Record<string, { label: string; color: string; icon: string }> = {
  balanced: { label: 'Balanced', color: T.success, icon: 'checkmark-circle' },
  imbalanced: { label: 'Imbalanced', color: T.risk, icon: 'git-compare' },
  under_pressure: { label: 'Under Pressure', color: T.danger, icon: 'warning' },
};

export default function SystemBalance() {
  const [state, setState] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.get('/system/health/deep'); setState(r.data); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async () => {
    setBusy(true);
    try {
      const r = await api.post('/operator/auto-balance');
      const sr = (r.data.stuck_recovered || []).length;
      const ec = (r.data.exposure_changes || []).length;
      const dc = r.data.demand?.changed ? 1 : 0;
      Alert.alert(
        'Auto-balance complete',
        `Stuck recovered: ${sr}\nExposure adjustments: ${ec}\nDemand change: ${dc ? `yes (${r.data.demand.reason})` : 'no change'}`,
      );
      load();
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed');
    } finally { setBusy(false); }
  };

  if (!state) return null;

  const pm = PRESSURE_META[state.load_balance] || PRESSURE_META.balanced;
  const eff = Math.round((state.market_efficiency || 0) * 100);
  const effColor = eff >= 70 ? T.success : eff >= 45 ? T.risk : T.danger;
  const needsAction = (state.stuck_modules > 0) || (state.overloaded_devs > 0 && state.idle_devs > 0);

  return (
    <View style={s.wrap} testID="system-balance">
      <View style={s.headRow}>
        <View style={s.headLeft}>
          <View style={[s.pressureDot, { backgroundColor: pm.color }]} />
          <Text style={s.title}>System Balance</Text>
          <View style={[s.pressurePill, { borderColor: pm.color + '77', backgroundColor: pm.color + '15' }]}>
            <Ionicons name={pm.icon as any} size={11} color={pm.color} />
            <Text style={[s.pressureText, { color: pm.color }]}>{pm.label}</Text>
          </View>
        </View>
        <View style={s.effWrap}>
          <Text style={[s.effNum, { color: effColor }]}>{eff}%</Text>
          <Text style={s.effLbl}>efficiency</Text>
        </View>
      </View>

      <View style={s.grid}>
        <Metric
          lbl="Overloaded devs"
          val={state.overloaded_devs}
          color={state.overloaded_devs > 0 ? T.danger : T.textMuted}
          icon="flame"
          testID="sb-overloaded"
        />
        <Metric
          lbl="Idle devs"
          val={state.idle_devs}
          color={state.idle_devs > 0 ? T.info : T.textMuted}
          icon="moon"
          testID="sb-idle"
        />
        <Metric
          lbl="Stuck modules"
          val={state.stuck_modules}
          color={state.stuck_modules > 0 ? T.risk : T.textMuted}
          icon="time"
          testID="sb-stuck"
        />
        <Metric
          lbl="Avg bids"
          val={state.avg_bids_per_module}
          decimals
          color={state.market_liquidity === 'low' ? T.risk : state.market_liquidity === 'hot' ? T.info : T.success}
          icon="podium"
          testID="sb-bids"
        />
      </View>

      <View style={s.multiplierRow}>
        <Ionicons name="pulse" size={12} color={T.primary} />
        <Text style={s.multLbl}>Global price multiplier</Text>
        <Text style={[s.multVal, state.global_price_multiplier > 1 && { color: T.success }, state.global_price_multiplier < 1 && { color: T.risk }]}>
          ×{(state.global_price_multiplier ?? 1).toFixed(2)}
        </Text>
        <Text style={s.multTag}>· {state.market_liquidity} liquidity</Text>
      </View>

      <View style={s.footerRow}>
        <Text style={s.autoStat}>{state.auto_actions_taken} auto-actions · 1h</Text>
        <TouchableOpacity
          testID="auto-balance-btn"
          onPress={run}
          disabled={busy}
          style={[s.btn, needsAction ? s.btnPrimary : s.btnGhost, busy && { opacity: 0.6 }]}>
          {busy
            ? <ActivityIndicator color={needsAction ? T.bg : T.primary} size="small" />
            : <>
                <Ionicons name="flash" size={13} color={needsAction ? T.bg : T.primary} />
                <Text style={[s.btnText, { color: needsAction ? T.bg : T.primary }]}>Auto balance</Text>
              </>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Metric({ lbl, val, color, icon, decimals, testID }: any) {
  return (
    <View style={s.cell} testID={testID}>
      <View style={s.cellHead}>
        <Ionicons name={icon} size={11} color={color} />
        <Text style={s.cellLbl}>{lbl}</Text>
      </View>
      <Text style={[s.cellVal, { color }]}>{decimals ? Number(val).toFixed(1) : val}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: T.surface1, borderRadius: T.radius, padding: T.md, marginBottom: T.md, borderWidth: 1, borderColor: T.primaryBorder },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: T.sm },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  pressureDot: { width: 8, height: 8, borderRadius: 4 },
  title: { color: T.text, fontSize: T.h3, fontWeight: '700' },
  pressurePill: { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  pressureText: { fontSize: T.tiny, fontWeight: '700' },
  effWrap: { alignItems: 'flex-end' },
  effNum: { fontSize: T.h2, fontWeight: '800' },
  effLbl: { color: T.textMuted, fontSize: 9, marginTop: -3 },

  grid: { flexDirection: 'row', gap: 6, marginBottom: T.sm },
  cell: { flex: 1, backgroundColor: T.surface2, borderRadius: T.radiusSm, padding: 8, borderWidth: 1, borderColor: T.border },
  cellHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cellLbl: { color: T.textMuted, fontSize: 9, letterSpacing: 0.3 },
  cellVal: { fontSize: T.body, fontWeight: '800', marginTop: 2 },

  multiplierRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 8, backgroundColor: T.surface2, borderRadius: T.radiusSm, marginBottom: T.sm, borderWidth: 1, borderColor: T.border },
  multLbl: { color: T.textMuted, fontSize: T.tiny, flex: 1 },
  multVal: { color: T.text, fontSize: T.body, fontWeight: '800' },
  multTag: { color: T.textMuted, fontSize: T.tiny, fontStyle: 'italic' },

  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  autoStat: { color: T.textMuted, fontSize: T.tiny, fontStyle: 'italic' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: T.radiusSm },
  btnPrimary: { backgroundColor: T.primary },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: T.primaryBorder },
  btnText: { fontWeight: '800', fontSize: T.small },
});
