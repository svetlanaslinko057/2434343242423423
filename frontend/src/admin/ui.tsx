/**
 * Admin shared design system primitives.
 *
 * Pattern: every Expo admin parity screen is a thin route that composes
 * these primitives + a backend endpoint. Keeps each route file under
 * ~150 LoC and guarantees visual consistency.
 *
 * NOT a generic component library — these are *opinionated* for the admin
 * cockpit aesthetic (dense rows, mono labels, single-action sheets).
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import T from '../theme';

/* ─── AdminHeader ──────────────────────────────────────────────────────────
 * Stack-style header with title + optional subtitle + optional right action.
 * Used on every admin parity screen so the layout reads identical.
 */
export function AdminHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.headerWrap, { paddingTop: insets.top + 12 }]} testID="admin-header">
      <View style={s.headerRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={s.headerSub} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {right ? <View style={s.headerRight}>{right}</View> : null}
      </View>
    </View>
  );
}

/* ─── AdminListScreen ──────────────────────────────────────────────────────
 * Standard list container: pull-to-refresh, loading state, empty state.
 * Children render the actual rows.
 */
export function AdminListScreen({
  header,
  loading,
  empty,
  emptyLabel = 'Nothing here yet.',
  refreshing,
  onRefresh,
  children,
}: {
  header: React.ReactNode;
  loading: boolean;
  empty: boolean;
  emptyLabel?: string;
  refreshing: boolean;
  onRefresh: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      {header}
      <ScrollView
        contentContainerStyle={s.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={T.primary}
          />
        }
        testID="admin-list-scroll"
      >
        {loading ? (
          <View style={s.loadingBlock} testID="admin-list-loading">
            <ActivityIndicator size="small" color={T.primary} />
            <Text style={s.loadingText}>Loading…</Text>
          </View>
        ) : empty ? (
          <View style={s.emptyBlock} testID="admin-list-empty">
            <Ionicons name="ellipse-outline" size={28} color={T.textMuted} />
            <Text style={s.emptyText}>{emptyLabel}</Text>
          </View>
        ) : (
          children
        )}
      </ScrollView>
    </View>
  );
}

/* ─── AdminRow ─────────────────────────────────────────────────────────────
 * Dense info row with optional left icon, title, subtitle and trailing meta.
 */
export function AdminRow({
  title,
  subtitle,
  rightLabel,
  rightTone,
  icon,
  onPress,
  testID,
}: {
  title: string;
  subtitle?: string;
  rightLabel?: string;
  rightTone?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  testID?: string;
}) {
  const tone = rightTone || 'default';
  const Container: any = onPress ? TouchableOpacity : View;
  return (
    <Container
      style={s.row}
      onPress={onPress}
      activeOpacity={0.8}
      testID={testID}
    >
      {icon ? (
        <View style={s.rowIcon}>
          <Ionicons name={icon} size={18} color={T.primary} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.rowTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={s.rowSub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {rightLabel ? (
        <View style={[s.rowMeta, toneStyles[tone]]}>
          <Text style={[s.rowMetaText, toneText[tone]]} numberOfLines={1}>
            {rightLabel}
          </Text>
        </View>
      ) : null}
    </Container>
  );
}

/* ─── AdminSection ─────────────────────────────────────────────────────────
 * Lightweight section header (eyebrow + optional count badge).
 */
export function AdminSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginTop: T.lg }}>
      <View style={s.sectionHead}>
        <Text style={s.sectionTitle}>{title.toUpperCase()}</Text>
        {typeof count === 'number' ? (
          <View style={s.sectionCount}>
            <Text style={s.sectionCountText}>{count}</Text>
          </View>
        ) : null}
      </View>
      <View style={s.sectionBody}>{children}</View>
    </View>
  );
}

/* ─── AdminActionSheet ─────────────────────────────────────────────────────
 * Bottom sheet with one or more action buttons. Used for QA-style admin
 * decisions (approve / revision / reject) — confirmation-first UX.
 */
export type AdminAction = {
  label: string;
  testID?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
  onPress: () => void | Promise<void>;
};

export function AdminActionSheet({
  visible,
  title,
  body,
  actions,
  onClose,
}: {
  visible: boolean;
  title: string;
  body?: string;
  actions: AdminAction[];
  onClose: () => void;
}) {
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={s.sheetBackdrop} onPress={onClose}>
        <Pressable style={s.sheetCard} onPress={(e) => e.stopPropagation()}>
          <Text style={s.sheetTitle}>{title}</Text>
          {body ? <Text style={s.sheetBody}>{body}</Text> : null}
          <View style={s.sheetActions}>
            {actions.map((a, i) => (
              <TouchableOpacity
                key={`${a.label}-${i}`}
                style={[s.sheetBtn, sheetToneStyles[a.tone || 'default']]}
                onPress={() => {
                  void a.onPress();
                }}
                testID={a.testID || `admin-sheet-action-${i}`}
              >
                <Text style={[s.sheetBtnText, sheetToneText[a.tone || 'default']]}>
                  {a.label}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={s.sheetCancel}
              onPress={onClose}
              testID="admin-sheet-cancel"
            >
              <Text style={s.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ─── Styles ──────────────────────────────────────────────────────────────── */

const toneStyles: Record<string, any> = {
  default: { backgroundColor: T.surface2, borderColor: T.border },
  success: { backgroundColor: 'rgba(126,150,132,0.10)', borderColor: 'rgba(126,150,132,0.32)' },
  warning: { backgroundColor: 'rgba(201,169,97,0.10)', borderColor: 'rgba(201,169,97,0.32)' },
  danger:  { backgroundColor: 'rgba(184,106,106,0.10)', borderColor: 'rgba(184,106,106,0.32)' },
  info:    { backgroundColor: 'rgba(120,132,145,0.10)', borderColor: 'rgba(120,132,145,0.32)' },
};
const toneText: Record<string, any> = {
  default: { color: T.textSecondary },
  success: { color: '#7E9684' },
  warning: { color: '#C9A961' },
  danger:  { color: '#B86A6A' },
  info:    { color: '#788491' },
};
const sheetToneStyles: Record<string, any> = {
  default: { backgroundColor: T.surface2, borderColor: T.border },
  success: { backgroundColor: T.primary, borderColor: T.primary },
  warning: { backgroundColor: '#C9A961', borderColor: '#C9A961' },
  danger:  { backgroundColor: '#B86A6A', borderColor: '#B86A6A' },
};
const sheetToneText: Record<string, any> = {
  default: { color: T.text },
  success: { color: T.bg, fontWeight: '700' },
  warning: { color: T.bg, fontWeight: '700' },
  danger:  { color: T.bg, fontWeight: '700' },
};

const s = StyleSheet.create({
  headerWrap: {
    backgroundColor: T.surface1,
    borderBottomColor: T.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 12,
  },
  headerRow: {
    paddingHorizontal: T.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.sm,
  },
  headerTitle: { color: T.text, fontSize: 20, fontWeight: '700' },
  headerSub:   { color: T.textSecondary, fontSize: 12, marginTop: 2 },
  headerRight: { marginLeft: 'auto' },

  listContent: { padding: T.lg, paddingBottom: T.xl * 2 },

  loadingBlock: { paddingVertical: T.xl, alignItems: 'center', gap: T.sm },
  loadingText: { color: T.textMuted, fontSize: 12 },

  emptyBlock: { paddingVertical: T.xl * 2, alignItems: 'center', gap: T.sm },
  emptyText: { color: T.textMuted, fontSize: 13 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.sm,
    backgroundColor: T.surface1,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 12,
    paddingVertical: T.sm + 2,
    paddingHorizontal: T.md,
    marginBottom: T.sm,
  },
  rowIcon: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: T.surface2,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { color: T.text, fontSize: 14, fontWeight: '600' },
  rowSub:   { color: T.textSecondary, fontSize: 12, marginTop: 2 },
  rowMeta: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
  },
  rowMetaText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },

  sectionHead: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: T.sm,
  },
  sectionTitle: { color: T.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1.6 },
  sectionCount: {
    minWidth: 22, height: 18, borderRadius: 999,
    backgroundColor: T.surface2,
    paddingHorizontal: 6,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionCountText: { color: T.textSecondary, fontSize: 11, fontWeight: '700' },
  sectionBody: {},

  sheetBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    backgroundColor: T.surface1,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: T.lg, paddingBottom: T.xl,
    borderTopColor: T.border, borderLeftColor: T.border, borderRightColor: T.border,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: { color: T.text, fontSize: 16, fontWeight: '700' },
  sheetBody:  { color: T.textSecondary, fontSize: 13, marginTop: 6, lineHeight: 18 },
  sheetActions: { marginTop: T.md, gap: T.sm },
  sheetBtn: {
    borderWidth: 1, borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  sheetBtnText: { fontSize: 14, fontWeight: '600' },
  sheetCancel: {
    borderRadius: 10, paddingVertical: 12, alignItems: 'center',
    backgroundColor: T.bg, borderWidth: 1, borderColor: T.border,
  },
  sheetCancelText: { color: T.textMuted, fontSize: 14 },
});
