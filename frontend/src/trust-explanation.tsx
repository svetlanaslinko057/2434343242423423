import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import T from './theme';

type Factor = { text: string; impact: string; type: 'positive' | 'negative' };
type Prediction = { text: string; timeframe: string; severity: string };

type Props = {
  score: number;
  trend: string;
  label: string;
  summary: string;
  factors: Factor[];
  predictions: Prediction[];
};

export default function TrustExplanationCard({ score, trend, label, summary, factors, predictions }: Props) {
  const scoreColor = score >= 85 ? T.primary : score >= 70 ? T.info : score >= 40 ? T.risk : T.danger;
  const trendIcon = trend === 'up' ? 'trending-up' : trend === 'down' ? 'trending-down' : 'remove';

  return (
    <View testID="trust-explanation" style={s.container}>
      {/* Score header */}
      <View style={s.header}>
        <View style={s.scoreWrap}>
          <Text style={[s.scoreNum, { color: scoreColor }]}>{score}</Text>
          <Ionicons name={trendIcon as any} size={20} color={scoreColor} />
        </View>
        <View style={s.labelWrap}>
          <Text style={[s.labelText, { color: scoreColor }]}>{label}</Text>
          <Text style={s.summary}>{summary}</Text>
        </View>
      </View>

      {/* Factors */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>WHY</Text>
        {factors.map((f, i) => (
          <View key={i} style={s.factorRow}>
            <View style={[s.factorDot, { backgroundColor: f.type === 'positive' ? T.success : T.danger }]} />
            <Text style={s.factorText}>{f.text}</Text>
            <Text style={[s.factorImpact, { color: f.type === 'positive' ? T.success : T.danger }]}>{f.impact}</Text>
          </View>
        ))}
      </View>

      {/* Predictions */}
      {predictions.length > 0 && predictions[0].severity !== 'low' && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>IF NO ACTION</Text>
          {predictions.filter(p => p.severity !== 'low').map((p, i) => {
            const pColor = p.severity === 'critical' ? T.danger : p.severity === 'high' ? T.risk : T.info;
            return (
              <View key={i} style={s.predRow}>
                <Ionicons name="arrow-forward" size={12} color={pColor} />
                <Text style={[s.predText, { color: pColor }]}>{p.text}</Text>
                <Text style={s.predTime}>{p.timeframe}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { backgroundColor: T.surface1, borderRadius: T.radius, padding: T.md, borderWidth: 1, borderColor: T.border },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: T.md },
  scoreWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: T.md },
  scoreNum: { fontSize: 36, fontWeight: '800' },
  labelWrap: { flex: 1 },
  labelText: { fontSize: T.body, fontWeight: '700' },
  summary: { color: T.textMuted, fontSize: T.small, marginTop: 2 },
  section: { marginTop: T.sm },
  sectionTitle: { color: T.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: 6 },
  factorRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: 8 },
  factorDot: { width: 6, height: 6, borderRadius: 3 },
  factorText: { color: T.text, fontSize: T.small, flex: 1 },
  factorImpact: { fontSize: T.small, fontWeight: '700', minWidth: 32, textAlign: 'right' },
  predRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, gap: 6 },
  predText: { fontSize: T.small, flex: 1 },
  predTime: { color: T.textMuted, fontSize: T.tiny },
});
