/**
 * BLOCK 4.1 — Dev quality badge (used in dev/home & team viewer).
 * Renders score + band pill + component breakdown.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import api from './api';
import T from './theme';

type Score = {
  quality_score: number;
  band: 'strong' | 'stable' | 'weak' | 'risk';
  confidence: 'low' | 'medium' | 'high';
  qa_pass_rate: number;
  on_time_rate: number;
  completion_rate: number;
  issue_penalty: number;
  qa_reviews_count: number;
  tasks_assigned: number;
  issues_count: number;
  reason?: string;
};

const BAND_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  strong: { bg: T.successBg, fg: T.success, label: 'STRONG' },
  stable: { bg: T.successBg, fg: T.success, label: 'STABLE' },
  weak: { bg: T.warningBg, fg: T.warning, label: 'WEAK' },
  risk: { bg: T.dangerBg, fg: T.danger, label: 'RISK' },
};

type Props = { developerId?: string; compact?: boolean };

export function QualityBadge({ developerId, compact }: Props) {
  const [score, setScore] = useState<Score | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const path = developerId
          ? `/intelligence/developers/${developerId}`
          : '/intelligence/me';
        const res = await api.get(path);
        setScore(res.data);
      } catch (e: any) {
        setError(e?.response?.data?.detail || e?.message || 'Failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [developerId]);

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={T.primary} />
      </View>
    );
  }
  // Quietly hide for non-developers (403 "Developer only") — the badge is
  // a developer-only widget; admins/clients shouldn't see a red error.
  if (error || !score) {
    return null;
  }

  const band = BAND_COLORS[score.band] || BAND_COLORS.weak;

  if (compact) {
    return (
      <View style={[styles.pill, { backgroundColor: band.bg }]} testID="quality-pill">
        <Text style={[styles.pillScore, { color: band.fg }]}>
          {score.quality_score.toFixed(0)}
        </Text>
        <Text style={[styles.pillBand, { color: band.fg }]}>{band.label}</Text>
        {score.confidence === 'low' && (
          <Text style={styles.pillConf}>· new</Text>
        )}
      </View>
    );
  }

  return (
    <View style={styles.card} testID="quality-card">
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.h}>Quality score</Text>
          <Text style={styles.sub} numberOfLines={2}>
            Confidence: {score.confidence}
            {score.confidence === 'low' && ' · needs more data'}
          </Text>
        </View>
        <View style={[styles.pill, { backgroundColor: band.bg }]}>
          <Text style={[styles.pillScore, { color: band.fg }]}>
            {score.quality_score.toFixed(0)}
          </Text>
          <Text style={[styles.pillBand, { color: band.fg }]}>{band.label}</Text>
        </View>
      </View>

      <View style={styles.rows}>
        <Row label="QA pass rate" value={score.qa_pass_rate} note={`${score.qa_reviews_count} reviews`} weight={40} />
        <Row label="On time" value={score.on_time_rate} weight={25} />
        <Row label="Completion" value={score.completion_rate} note={`${score.tasks_assigned} assigned`} weight={20} />
        <Row label="Issue impact (inverse)" value={score.issue_penalty} note={`${score.issues_count} issues`} weight={15} />
      </View>

      {score.band === 'risk' && (
        <Text style={styles.warn}>
          You're flagged as RISK · system may exclude you from suggestions until
          your score improves.
        </Text>
      )}
      {score.band === 'strong' && (
        <Text style={styles.good}>
          You qualify for OWNER role on teams.
        </Text>
      )}
    </View>
  );
}

function Row({ label, value, note, weight }: { label: string; value: number; note?: string; weight: number }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowLabel}>{label} <Text style={styles.rowWeight}>· {weight}%</Text></Text>
        <Text style={styles.rowVal}>{(pct * 100).toFixed(0)}%</Text>
      </View>
      <View style={styles.bar}>
        <View style={[
          styles.barFill,
          { width: `${pct * 100}%`,
            backgroundColor: pct > 0.7 ? T.success : pct > 0.4 ? T.warning : T.danger },
        ]} />
      </View>
      {note && <Text style={styles.rowNote}>{note}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: T.surface, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: T.border, marginVertical: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerText: { flex: 1, minWidth: 0 },
  h: { color: T.text, fontSize: 16, fontWeight: '700' },
  sub: { color: T.textMuted, fontSize: 11, marginTop: 2 },
  err: { color: T.danger, fontSize: 13 },

  pill: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    alignItems: 'center', flexDirection: 'row', gap: 6,
    flexShrink: 0,
  },
  pillScore: { fontSize: 20, fontWeight: '800' },
  pillBand: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  pillConf: { color: T.textMuted, fontSize: 10 },

  rows: { marginTop: 14, gap: 12 },
  row: {},
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  rowLabel: { color: T.text, fontSize: 12, fontWeight: '600' },
  rowWeight: { color: T.textMuted, fontSize: 10, fontWeight: '400' },
  rowVal: { color: T.success, fontSize: 12, fontWeight: '700' },
  bar: { height: 4, backgroundColor: T.surface2, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: 4 },
  rowNote: { color: T.textMuted, fontSize: 10, marginTop: 3 },

  warn: {
    color: T.danger, fontSize: 11, marginTop: 12, fontStyle: 'italic',
    lineHeight: 16,
  },
  good: { color: T.success, fontSize: 11, marginTop: 12, fontWeight: '600' },
});

export default QualityBadge;
