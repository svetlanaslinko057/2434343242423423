/**
 * /admin/marketplace — Marketplace quality oversight.
 *
 * Endpoint: GET /api/marketplace/modules?admin=1  → list of marketplace
 * modules with quality_score, reviews, sales count. Admin sees the FULL
 * catalogue (public is filtered to published-only); we pass `?admin=1`
 * so the backend skips the publish-state filter when caller has admin role.
 *
 * Filters: status (all / published / draft / removed).
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, TouchableOpacity, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import T from '../../src/theme';
import { useAdminResource } from '../../src/admin/useAdminResource';
import { AdminHeader, AdminListScreen, AdminRow } from '../../src/admin/ui';

type Module = {
  id: string;
  title: string;
  status?: string;
  quality_score?: number;
  sales_count?: number;
  reviews_count?: number;
  developer_id?: string;
  developer_name?: string;
};

const STATUSES = ['all', 'published', 'draft', 'removed'] as const;
type StatusFilter = typeof STATUSES[number];

function qualityTone(q?: number): 'success' | 'warning' | 'danger' | 'default' {
  if (typeof q !== 'number') return 'default';
  if (q >= 0.85) return 'success';
  if (q >= 0.6) return 'warning';
  return 'danger';
}

export default function AdminMarketplaceScreen() {
  const { data, loading, refreshing, reload } = useAdminResource<Module[] | { modules?: Module[] }>(
    '/marketplace/modules',
    { params: { admin: 1 } },
  );
  const [filter, setFilter] = useState<StatusFilter>('all');

  const list = Array.isArray(data) ? data : (data?.modules || []);
  const rows = useMemo(() => {
    if (filter === 'all') return list;
    return list.filter((m) => (m.status || 'published') === filter);
  }, [list, filter]);

  return (
    <AdminListScreen
      header={
        <>
          <AdminHeader
            title="Marketplace quality"
            subtitle={`${rows.length} of ${list.length}`}
            right={
              <TouchableOpacity onPress={() => router.back()} testID="admin-marketplace-back">
                <Ionicons name="close" size={22} color={T.textSecondary} />
              </TouchableOpacity>
            }
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters}>
            {STATUSES.map((st) => (
              <TouchableOpacity
                key={st}
                style={[s.chip, filter === st && s.chipActive]}
                onPress={() => setFilter(st)}
                testID={`admin-marketplace-filter-${st}`}
              >
                <Text style={[s.chipText, filter === st && s.chipTextActive]}>{st}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      }
      loading={loading}
      empty={rows.length === 0}
      emptyLabel={filter === 'all' ? 'No marketplace modules yet.' : `No ${filter} modules.`}
      refreshing={refreshing}
      onRefresh={reload}
    >
      {rows.map((m) => (
        <AdminRow
          key={m.id}
          title={m.title}
          subtitle={`${m.developer_name || m.developer_id || '—'}${typeof m.sales_count === 'number' ? `  ·  ${m.sales_count} sales` : ''}${typeof m.reviews_count === 'number' ? `  ·  ${m.reviews_count} reviews` : ''}`}
          rightLabel={typeof m.quality_score === 'number' ? m.quality_score.toFixed(2) : (m.status || '—')}
          rightTone={qualityTone(m.quality_score)}
          icon="star-outline"
          testID={`admin-marketplace-row-${m.id}`}
        />
      ))}
    </AdminListScreen>
  );
}

const s = StyleSheet.create({
  filters: { paddingHorizontal: T.lg, paddingTop: T.sm, paddingBottom: T.sm, gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: T.surface2, borderWidth: 1, borderColor: T.border, marginRight: 6,
  },
  chipActive: { backgroundColor: T.primary, borderColor: T.primary },
  chipText: { color: T.textSecondary, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: T.bg, fontWeight: '700' },
});
