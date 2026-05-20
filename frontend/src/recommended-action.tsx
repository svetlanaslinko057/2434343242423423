import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import T from './theme';

type Breakdown = { label: string; amount: number };

type Props = {
  action: {
    type: string;
    title: string;
    subtitle?: string;
    amount?: number;
    severity: string;
    impact: string;
    consequences?: string[];
    // new fields
    unlock_label?: string;    // primary CTA action-oriented copy
    cta_subtitle?: string;    // small text under CTA button
    social_proof?: string;    // pre-CTA line ("2 developers reviewed your project")
    without_this?: string[];  // "if you don't do this..."
    breakdown?: Breakdown[];  // price composition
    urgency_note?: string;    // social/urgency signal
  } | null;
  onPress: () => void;
};

export default function RecommendedActionHero({ action, onPress }: Props) {
  if (!action) return null;
  const sevColor = action.severity === 'critical' ? T.danger : action.severity === 'high' ? T.risk : T.primary;
  const icon = action.type === 'pay_invoice' ? 'lock-open' : action.type === 'review_qa' ? 'search' : action.type === 'approve_deliverable' ? 'checkmark-done' : action.type === 'start_work' ? 'code-working' : action.type === 'sign_contract' ? 'create' : 'flash';

  // Action-oriented CTA copy: "Start" not "Pay"
  const ctaCopy = action.unlock_label
    || (action.type === 'pay_invoice' ? '🔓 Start development now'
      : action.type === 'review_qa' ? 'Review & unblock'
      : action.type === 'start_work' ? 'Start — unlock timer'
      : action.type === 'approve_deliverable' ? 'Approve & advance'
      : 'Take Action');

  const ctaSub = action.cta_subtitle
    || (action.type === 'pay_invoice' && action.amount
      ? `2 developers ready · $${action.amount} locked after confirmation`
      : undefined);

  return (
    <View testID="guided-action-hero" style={[s.container, { borderColor: sevColor }]}>
      <View style={s.header}>
        <Ionicons name="flash" size={14} color={sevColor} />
        <Text style={[s.label, { color: sevColor }]}>DO THIS NOW</Text>
        {action.urgency_note ? (
          <View style={[s.urgencyPill, { backgroundColor: sevColor + '15' }]}>
            <Text style={[s.urgencyText, { color: sevColor }]}>{action.urgency_note}</Text>
          </View>
        ) : null}
      </View>

      <View style={s.body}>
        <View style={[s.iconWrap, { backgroundColor: sevColor + '20' }]}>
          <Ionicons name={icon as any} size={22} color={sevColor} />
        </View>
        <View style={s.info}>
          <Text style={s.title}>{action.title}</Text>
          {action.subtitle ? <Text style={s.subtitle}>{action.subtitle}</Text> : null}
        </View>
        {action.amount != null && <Text style={[s.amount, { color: sevColor }]}>${action.amount}</Text>}
      </View>

      {/* Price breakdown — if provided */}
      {action.breakdown && action.breakdown.length > 0 && (
        <View style={s.breakdown} testID="guided-action-breakdown">
          {action.breakdown.map((b, i) => (
            <View key={i} style={s.breakRow}>
              <Text style={s.breakLabel}>{b.label}</Text>
              <Text style={s.breakAmount}>${b.amount}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Schema 5: LOSS FIRST — pressure block at top */}
      {action.without_this && action.without_this.length > 0 && (
        <View style={s.withoutWrap} testID="guided-action-without-this">
          <Text style={s.withoutLabel}>If you don't:</Text>
          {action.without_this.map((c, i) => (
            <View key={i} style={s.withoutRow}>
              <Text style={s.withoutText}>{c}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Schema 5: THEN GAIN — positive after loss */}
      {action.consequences && action.consequences.length > 0 && (
        <View style={s.consequencesPositive} testID="guided-action-this-will">
          <Text style={s.consLabel}>But if you start now:</Text>
          {action.consequences.slice(0, 3).map((c, i) => (
            <View key={i} style={s.consRow}>
              <Ionicons name="checkmark-circle" size={12} color={T.success} />
              <Text style={s.consText}>{c}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Social proof line — right before CTA ("Team is ready — waiting for your confirmation") */}
      {action.social_proof ? (
        <View style={s.socialProof} testID="guided-action-social-proof">
          <Ionicons name="people" size={13} color={T.success} />
          <Text style={s.socialProofText}>{action.social_proof}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        testID="guided-action-cta"
        style={[s.cta, { backgroundColor: sevColor }]}
        onPress={onPress}
        activeOpacity={0.85}
      >
        <Text style={s.ctaText}>{ctaCopy}</Text>
        <Ionicons name="chevron-forward" size={18} color={T.bg} />
      </TouchableOpacity>

      {ctaSub ? (
        <Text style={s.ctaSubText} testID="guided-action-cta-subtitle">{ctaSub}</Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  container: { backgroundColor: T.surface1, borderRadius: T.radius, padding: T.md, borderWidth: 2, marginBottom: T.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: T.sm },
  label: { fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  urgencyPill: { marginLeft: 'auto', paddingHorizontal: T.sm, paddingVertical: 3, borderRadius: 10 },
  urgencyText: { fontSize: 10, fontWeight: '700' },

  body: { flexDirection: 'row', alignItems: 'center', marginBottom: T.sm },
  iconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: T.md },
  info: { flex: 1 },
  title: { color: T.text, fontSize: T.h3, fontWeight: '700' },
  subtitle: { color: T.textMuted, fontSize: T.small, marginTop: 2 },
  amount: { fontSize: T.h2, fontWeight: '800' },

  breakdown: { backgroundColor: T.surface2, borderRadius: T.radiusSm, padding: 10, marginBottom: T.sm },
  breakRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  breakLabel: { color: T.textMuted, fontSize: T.small },
  breakAmount: { color: T.text, fontSize: T.small, fontWeight: '600' },

  consequencesPositive: { backgroundColor: T.surface2, borderRadius: T.radiusSm, padding: 10, marginBottom: T.sm },
  consLabel: { color: T.success, fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 4 },
  consRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  consText: { color: T.text, fontSize: T.small },

  withoutWrap: { backgroundColor: T.dangerBg, borderRadius: T.radiusSm, padding: 10, marginBottom: T.sm, borderLeftWidth: 3, borderLeftColor: T.danger },
  withoutLabel: { color: T.danger, fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 4 },
  withoutRow: { paddingVertical: 1 },
  withoutText: { color: T.text, fontSize: T.small },

  socialProof: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: T.sm, paddingHorizontal: 4 },
  socialProofText: { color: T.success, fontSize: T.tiny, fontWeight: '600', fontStyle: 'italic' },

  cta: { borderRadius: T.radiusSm, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  ctaText: { color: T.bg, fontWeight: '800', fontSize: T.body + 1 },
  ctaSubText: { color: T.textMuted, fontSize: T.tiny, textAlign: 'center', marginTop: T.sm, fontStyle: 'italic' },
});
