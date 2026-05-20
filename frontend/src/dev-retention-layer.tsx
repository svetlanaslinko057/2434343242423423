import { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from './api';
import T from './theme';

/**
 * Developer Retention Layer — 4 точечных усиления поверх существующего кабинета:
 *   1. Pending money — «$X pending · N waiting for approval»
 *   2. Client pressure — «Client is waiting for your review»
 *   3. Today earnings — «+$X earned today»
 *   4. Focus now — текущий in_progress модуль
 *
 * Мы НЕ переписываем кабинет — добавляем эмоциональный слой поверх.
 * Polling каждые 30 с: если pending_qa_amount вырос — подсвечиваем блок
 * пульсом (living pressure, без toast-системы).
 *
 * Backend — только существующие endpoints:
 *   GET /developer/earnings/summary?period=today  → pending_qa_amount, final, count
 *   GET /developer/focus                          → top-priority task + project_name
 */
const POLL_MS = 30_000;

type DevWorkSummary = {
  paid?: number;
  earned?: number;
  pending?: number;
  active_count?: number;
  qa_count?: number;
  blocked_count?: number;
};

export default function DevRetentionLayer() {
  const [earnings, setEarnings] = useState<any>(null);
  const [focus, setFocus] = useState<any>(null);
  const [work, setWork] = useState<{ summary?: DevWorkSummary; blocked?: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [pulse, setPulse] = useState(false);
  const prevPendingRef = useRef<number>(0);

  const load = useCallback(async () => {
    try {
      const [e, f, w] = await Promise.all([
        api.get('/developer/earnings/summary?period=today').then((r) => r.data).catch(() => null),
        api.get('/developer/focus').then((r) => r.data).catch(() => null),
        api.get('/dev/work').then((r) => r.data).catch(() => null),
      ]);
      if (e) {
        const pending = Number(e.pending_qa_amount || 0);
        if (pending > prevPendingRef.current && prevPendingRef.current > 0) {
          // Pending вырос между поллингами → визуальный «пульс» 3 секунды.
          setPulse(true);
          setTimeout(() => setPulse(false), 3000);
        }
        prevPendingRef.current = pending;
        setEarnings(e);
      }
      if (f !== null) setFocus(f);
      if (w) setWork(w);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  if (loading) {
    return (
      <View style={[s.container, s.loading]}>
        <ActivityIndicator color={T.primary} />
      </View>
    );
  }

  const pendingAmount = Number(earnings?.pending_qa_amount || 0);
  const pendingCount = Number(earnings?.pending_qa_count || 0);
  const todayFinal = Number(earnings?.breakdown?.final || 0);
  const hasPending = pendingAmount > 0 || pendingCount > 0;
  const hasFocus = !!focus?.unit_id;

  // Reverse pressure: blocked-модули, ожидающие действия клиента.
  // Это такая же «shared reality» — только наоборот: dev ждёт клиента.
  const blockedList: any[] = Array.isArray(work?.blocked) ? work!.blocked! : [];
  const blockedBySystem = blockedList.filter((m) => m?.paused_by_system).length;
  const blockedTotal = blockedList.length;
  const blockedEarnedLocked = blockedList.reduce(
    (acc, m) => acc + Math.max(0, Number(m?.earned || 0) - Number(m?.paid || 0)),
    0
  );
  const hasBlocked = blockedTotal > 0;

  // Lifetime pending из /dev/work (на случай если сегодня пусто, но вчера есть review).
  const lifetimePending = Number(work?.summary?.pending || 0);
  const hasLifetimePending = lifetimePending > 0 && !hasPending;

  // Если всё пусто — скрываем, чтобы не шуметь.
  if (!hasPending && !hasFocus && todayFinal <= 0 && !hasBlocked && !hasLifetimePending) return null;

  return (
    <View testID="dev-retention-layer" style={s.container}>
      {/* 1 + 2: Pending money + Client pressure (самое сильное — вверху блока) */}
      {hasPending && (
        <View
          testID="dev-pending-money"
          style={[s.pendingCard, pulse && s.pendingPulse]}
        >
          <View style={s.pendingLeft}>
            <View style={s.pendingIconWrap}>
              <Ionicons name="cash" size={20} color={T.risk} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.pendingAmount}>
                ${pendingAmount.toFixed(pendingAmount % 1 === 0 ? 0 : 2)} pending
              </Text>
              <Text style={s.pendingSub}>
                {pendingCount} {pendingCount === 1 ? 'module' : 'modules'} waiting for approval
              </Text>
            </View>
          </View>
          <View style={s.pressureRow}>
            <View style={s.pressureDot} />
            <Text style={s.pressureText}>Client is waiting for your review</Text>
          </View>
        </View>
      )}

      {/* Обратное давление: клиент держит твои деньги.
          Показываем если нет живого pending, но есть blocked-модули. */}
      {!hasPending && hasBlocked && (
        <View testID="dev-blocked-pressure" style={s.blockedCard}>
          <View style={s.pendingLeft}>
            <View style={[s.pendingIconWrap, { backgroundColor: T.riskBgStrong }]}>
              <Ionicons name="lock-closed" size={20} color={T.risk} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.pendingAmount}>
                {blockedTotal} {blockedTotal === 1 ? 'module' : 'modules'} locked
              </Text>
              <Text style={s.pendingSub}>
                {blockedBySystem > 0
                  ? `${blockedBySystem} paused by system · waiting for client`
                  : 'waiting on client action'}
                {blockedEarnedLocked > 0 ? ` · $${Math.round(blockedEarnedLocked)} on hold` : ''}
              </Text>
            </View>
          </View>
          <View style={s.pressureRow}>
            <View style={[s.pressureDot, { backgroundColor: T.risk }]} />
            <Text style={s.pressureText}>Waiting for client to unblock execution</Text>
          </View>
        </View>
      )}

      {/* Fallback: есть lifetime-pending, но сегодня без движения. */}
      {hasLifetimePending && !hasBlocked && (
        <View testID="dev-lifetime-pending" style={s.lifetimePendingCard}>
          <Ionicons name="time-outline" size={18} color={T.risk} />
          <Text style={s.lifetimePendingText}>
            ${lifetimePending.toFixed(0)} pending review
          </Text>
        </View>
      )}

      {/* 3 + 4: Today + Focus в одной полосе */}
      {(todayFinal > 0 || hasFocus) && (
        <View style={s.bottomRow}>
          {todayFinal > 0 && (
            <View testID="dev-today-earnings" style={s.todayCard}>
              <Ionicons name="trending-up" size={16} color={T.success} />
              <Text style={s.todayAmount}>
                +${todayFinal.toFixed(todayFinal % 1 === 0 ? 0 : 2)}
              </Text>
              <Text style={s.todayLabel}>earned today</Text>
            </View>
          )}
          {hasFocus && (
            <View testID="dev-focus-now" style={s.focusCard}>
              <Text style={s.focusLabel}>FOCUS NOW</Text>
              <Text style={s.focusTitle} numberOfLines={1}>
                {focus.title || 'Current task'}
              </Text>
              <Text style={s.focusProject} numberOfLines={1}>
                {focus.project_name || ''}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { marginBottom: T.lg, gap: T.sm },
  loading: { height: 80, alignItems: 'center', justifyContent: 'center' },

  // Pending money + client pressure — dominant карточка.
  pendingCard: {
    backgroundColor: T.riskBg,
    borderWidth: 1,
    borderColor: T.riskBorder,
    borderRadius: T.radius,
    padding: T.md,
    gap: T.sm,
  },
  pendingPulse: {
    borderColor: T.risk,
    shadowColor: T.risk,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 6,
  },
  pendingLeft: { flexDirection: 'row', alignItems: 'center', gap: T.sm },
  pendingIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: T.riskBgStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingAmount: { color: T.text, fontSize: T.h2, fontWeight: '800' },
  pendingSub: { color: T.risk, fontSize: T.small, marginTop: 2, fontWeight: '600' },
  pressureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: T.sm,
    borderTopWidth: 1,
    borderTopColor: T.riskBorder,
  },
  pressureDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: T.risk,
  },
  pressureText: { color: T.risk, fontSize: T.small, fontWeight: '700', letterSpacing: 0.2 },

  blockedCard: {
    backgroundColor: T.riskBg,
    borderWidth: 1,
    borderColor: T.riskBorder,
    borderRadius: T.radius,
    padding: T.md,
    gap: T.sm,
  },
  lifetimePendingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: T.riskBg,
    borderWidth: 1,
    borderColor: T.riskBorder,
    borderRadius: T.radius,
    paddingVertical: T.sm,
    paddingHorizontal: T.md,
  },
  lifetimePendingText: { color: T.risk, fontSize: T.body, fontWeight: '700' },

  bottomRow: { flexDirection: 'row', gap: T.sm },
  todayCard: {
    flex: 1,
    backgroundColor: T.successBg,
    borderWidth: 1,
    borderColor: T.successBorder,
    borderRadius: T.radius,
    padding: T.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.xs,
  },
  todayAmount: { color: T.success, fontSize: T.h3, fontWeight: '800' },
  todayLabel: { color: T.textMuted, fontSize: T.small, flex: 1 },

  focusCard: {
    flex: 1.3,
    backgroundColor: T.surface1,
    borderWidth: 1,
    borderColor: T.primaryBorder,
    borderRadius: T.radius,
    padding: T.md,
  },
  focusLabel: { color: T.primary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 4 },
  focusTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  focusProject: { color: T.textMuted, fontSize: T.small, marginTop: 2 },
});
