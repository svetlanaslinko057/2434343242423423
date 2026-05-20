// Operator-Console primitives for the 5 client screens.
//
// Goal: a coherent visual language across Home / Projects / Activity / Billing /
// Profile without forking the existing UI kit (src/ui.tsx). Components here are
// pure projections — they accept ready-to-render props and never aggregate data.

import React from 'react';
import { View, Text, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import T from './theme';
import { PressScale } from './ui';

/* --------------------------------------------------------- ScreenTitle */
/** Big page title + small subtitle. Sits at the top of the scroll content
 *  (the global app-header carries the bell + chat icons). */
export function ScreenTitle({
  title, subtitle, testID,
}: { title: string; subtitle?: string; testID?: string }) {
  return (
    <View testID={testID} style={ts.wrap}>
      <Text style={ts.title}>{title}</Text>
      {subtitle ? <Text style={ts.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const ts = StyleSheet.create({
  wrap: { marginBottom: T.lg },
  title: { color: T.text, fontSize: T.h1, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: T.textSecondary, fontSize: T.small, marginTop: 4, fontWeight: '500' },
});

/* --------------------------------------------------------- SectionLabel */
export function SectionLabel({ children, action, onAction }: {
  children: React.ReactNode;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={sl.row}>
      <Text style={sl.label}>{children}</Text>
      {action && onAction ? (
        <Text onPress={onAction} style={sl.action}>{action}</Text>
      ) : null}
    </View>
  );
}

const sl = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: T.sm, marginTop: T.lg },
  label: { color: T.textMuted, fontSize: T.tiny, fontWeight: '800', letterSpacing: 1.8, textTransform: 'uppercase' },
  action: { color: T.primary, fontSize: T.small, fontWeight: '700' },
});

/* --------------------------------------------------------- StatusPill */
export type PillTone = 'success' | 'risk' | 'danger' | 'info' | 'neutral';

const PILL_COLORS: Record<PillTone, { bg: string; bd: string; fg: string }> = {
  success: { bg: T.successTint, bd: T.successBorder, fg: T.success },
  risk:    { bg: T.riskTint,    bd: T.riskBorder,    fg: T.risk    },
  danger:  { bg: T.dangerTint,  bd: T.dangerBorder,  fg: T.danger  },
  info:    { bg: T.infoTint,    bd: T.infoBorder,    fg: T.info    },
  neutral: { bg: T.neutralTint, bd: T.neutralBorder, fg: T.textSecondary },
};

export function StatusPill({
  tone = 'neutral', label, dot = false,
}: { tone?: PillTone; label: string; dot?: boolean }) {
  const c = PILL_COLORS[tone];
  return (
    <View style={[sp.pill, { backgroundColor: c.bg, borderColor: c.bd }]}>
      {dot ? <View style={[sp.dot, { backgroundColor: c.fg }]} /> : null}
      <Text style={[sp.text, { color: c.fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const sp = StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 999, borderWidth: 1, alignSelf: 'flex-start',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
});

/* --------------------------------------------------------- StatCard */
/** A single stat tile in a horizontal strip. Mono-feel value + tiny upper label. */
export function StatCard({
  label, value, accent = T.text, sub, testID, style,
}: {
  label: string; value: string;
  accent?: string;
  sub?: string;
  testID?: string;
  style?: ViewStyle;
}) {
  return (
    <View testID={testID} style={[stc.card, style]}>
      <Text style={stc.label} numberOfLines={1}>{label}</Text>
      <Text style={[stc.value, { color: accent }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55}>{value}</Text>
      {sub ? <Text style={stc.sub} numberOfLines={1}>{sub}</Text> : null}
    </View>
  );
}

const stc = StyleSheet.create({
  card: {
    flex: 1, minWidth: 72,
    backgroundColor: T.surface2,
    borderWidth: 1, borderColor: T.border,
    borderRadius: T.radius,
    paddingVertical: T.md,
    paddingHorizontal: 10,
  },
  label: { color: T.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  value: { fontSize: 17, fontWeight: '800', marginTop: 6, letterSpacing: -0.5,
    fontVariant: ['tabular-nums'] },
  sub: { color: T.textMuted, fontSize: T.tiny, marginTop: 2, fontWeight: '600' },
});

/* --------------------------------------------------------- Avatar */
export function Avatar({ initial, size = 64, color = T.info }: {
  initial: string; size?: number; color?: string;
}) {
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: color + '22',
      borderWidth: 1, borderColor: color + '44',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ color, fontSize: size * 0.42, fontWeight: '800' }}>{initial}</Text>
    </View>
  );
}

/* --------------------------------------------------------- MenuRow */
export function MenuRow({
  icon, label, value, onPress, danger = false, testID, accent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  onPress: () => void;
  danger?: boolean;
  testID?: string;
  accent?: string;
}) {
  const fg = danger ? T.danger : (accent || T.text);
  return (
    <PressScale onPress={onPress} testID={testID} style={mr.row}>
      <View style={[mr.iconWrap, { backgroundColor: (accent || T.textSecondary) + '14' }]}>
        <Ionicons name={icon} size={18} color={accent || T.textSecondary} />
      </View>
      <Text style={[mr.label, { color: fg }]}>{label}</Text>
      {value ? <Text style={mr.value}>{value}</Text> : null}
      {!danger ? <Ionicons name="chevron-forward" size={16} color={T.textMuted} /> : null}
    </PressScale>
  );
}

const mr = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.border,
    borderRadius: T.radius,
    paddingVertical: 14, paddingHorizontal: T.md,
    marginBottom: T.sm,
    gap: T.md,
  },
  iconWrap: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  label: { fontSize: T.body, fontWeight: '600', flex: 1 },
  value: { color: T.textMuted, fontSize: T.small, fontWeight: '500', marginRight: 4 },
});

/* --------------------------------------------------------- EmptyState */
export function EmptyState({
  icon, title, sub, action, onAction, testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub?: string;
  action?: string;
  onAction?: () => void;
  testID?: string;
}) {
  return (
    <View style={es.wrap} testID={testID}>
      <View style={es.iconWrap}>
        <Ionicons name={icon} size={28} color={T.textMuted} />
      </View>
      <Text style={es.title}>{title}</Text>
      {sub ? <Text style={es.sub}>{sub}</Text> : null}
      {action && onAction ? (
        <PressScale onPress={onAction} style={es.cta}>
          <Text style={es.ctaText}>{action}</Text>
        </PressScale>
      ) : null}
    </View>
  );
}

const es = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 56 },
  iconWrap: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: T.surface2,
    borderWidth: 1, borderColor: T.border,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: T.md,
  },
  title: { color: T.text, fontSize: T.h3, fontWeight: '700' },
  sub: { color: T.textMuted, fontSize: T.small, marginTop: 6, textAlign: 'center', maxWidth: 300, lineHeight: 20 },
  cta: {
    marginTop: T.md, backgroundColor: T.primary,
    paddingVertical: 10, paddingHorizontal: T.lg,
    borderRadius: 999,
  },
  ctaText: { color: T.bg, fontSize: T.small, fontWeight: '800' },
});

/* --------------------------------------------------------- Banner */
/** Full-width call-out: Attention (danger) / Trust (success) / Note (info). */
export function Banner({
  tone = 'info', icon, title, sub, action, onAction, testID,
}: {
  tone?: 'success' | 'risk' | 'danger' | 'info';
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub?: string;
  action?: string;
  onAction?: () => void;
  testID?: string;
}) {
  const c = PILL_COLORS[tone];
  const body = (
    <View style={[bn.wrap, { backgroundColor: c.bg, borderColor: c.bd }]} testID={testID}>
      <View style={[bn.iconWrap, { backgroundColor: c.fg + '22' }]}>
        <Ionicons name={icon} size={20} color={c.fg} />
      </View>
      <View style={bn.body}>
        <Text style={bn.title} numberOfLines={2}>{title}</Text>
        {sub ? <Text style={bn.sub} numberOfLines={3}>{sub}</Text> : null}
      </View>
      {action ? (
        <View style={[bn.cta, { backgroundColor: c.fg }]}>
          <Text style={[bn.ctaText, { color: tone === 'risk' ? '#1A1305' : T.bg }]} numberOfLines={1}>{action}</Text>
          <Ionicons name="chevron-forward" size={14} color={tone === 'risk' ? '#1A1305' : T.bg} />
        </View>
      ) : null}
    </View>
  );
  if (onAction) return <PressScale onPress={onAction}>{body}</PressScale>;
  return body;
}

const bn = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderRadius: T.radius,
    padding: T.md,
    marginBottom: T.md,
  },
  iconWrap: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  body: { flex: 1, minWidth: 0 },
  title: { color: T.text, fontSize: T.body, fontWeight: '800' },
  sub: { color: T.textMuted, fontSize: T.tiny, marginTop: 2 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: T.radiusSm, flexShrink: 0 },
  ctaText: { fontSize: T.small, fontWeight: '800' },
});

/* --------------------------------------------------------- ProgressBar */
/** Tiny static progress bar. (Animated version lives in ui.tsx.) */
export function MiniProgress({ pct }: { pct: number }) {
  const v = Math.max(0, Math.min(100, pct));
  return (
    <View style={mp.bg}>
      <View style={[mp.fill, { width: `${v}%` }]} />
    </View>
  );
}

const mp = StyleSheet.create({
  bg: { height: 6, borderRadius: 3, backgroundColor: T.surface3, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: T.primary, borderRadius: 3 },
});

/* --------------------------------------------------------- TimelineRow */
/** Single row in the activity feed: vertical spine + colored dot + content. */
export function TimelineRow({
  color, title, meta, isLast = false, onPress, testID,
}: {
  color: string;
  title: React.ReactNode;
  meta: string;
  isLast?: boolean;
  onPress?: () => void;
  testID?: string;
}) {
  const inner = (
    <View style={tr.row} testID={testID}>
      <View style={tr.spineWrap}>
        <View style={[tr.dot, { backgroundColor: color, borderColor: color + '55' }]} />
        {!isLast ? <View style={tr.spine} /> : null}
      </View>
      <View style={tr.content}>
        <Text style={tr.title} numberOfLines={2}>{title}</Text>
        <Text style={tr.meta} numberOfLines={1}>{meta}</Text>
      </View>
    </View>
  );
  if (onPress) return <PressScale onPress={onPress}>{inner}</PressScale>;
  return inner;
}

const tr = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14, paddingBottom: 14 },
  spineWrap: { width: 16, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, marginTop: 4 },
  spine: { flex: 1, width: 2, backgroundColor: T.border, marginTop: 4, borderRadius: 1 },
  content: {
    flex: 1, paddingBottom: 4,
    backgroundColor: T.surface1,
    borderWidth: 1, borderColor: T.border,
    borderRadius: T.radius,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  title: { color: T.text, fontSize: T.body, lineHeight: 20 },
  meta: { color: T.textMuted, fontSize: T.tiny, marginTop: 4, fontWeight: '600' },
});
