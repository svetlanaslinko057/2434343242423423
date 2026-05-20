/**
 * /admin/contracts — Contracts overview (parity with web AdminContractsPage).
 *
 * Endpoint: GET /api/admin/contracts → { contracts: [...] }
 * Each row links to existing /admin/projects/[id] view, where the legal
 * contract section already renders. We just surface a flat list so the
 * admin can find a specific contract without project drill-down.
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, TouchableOpacity, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import T from '../../src/theme';
import { useAdminResource } from '../../src/admin/useAdminResource';
import { AdminHeader, AdminListScreen, AdminRow } from '../../src/admin/ui';

type Contract = {
  id: string;
  project_id: string;
  project_title?: string;
  client_id?: string;
  client_name?: string;
  status: string;
  amount?: number;
  currency?: string;
  signed_at?: string;
};

const STATUSES = ['all', 'draft', 'signed', 'active', 'closed'] as const;
type StatusFilter = typeof STATUSES[number];

const STATUS_TONE: Record<string, 'success' | 'warning' | 'info' | 'default'> = {
  draft: 'warning',
  signed: 'info',
  active: 'success',
  closed: 'default',
};

export default function AdminContractsScreen() {
  const { data, loading, refreshing, reload } = useAdminResource<{ contracts: Contract[] }>('/admin/contracts');
  const [filter, setFilter] = useState<StatusFilter>('all');

  const rows = useMemo(() => {
    const list = data?.contracts || [];
    return filter === 'all' ? list : list.filter((c) => c.status === filter);
  }, [data, filter]);

  return (
    <AdminListScreen
      header={
        <>
          <AdminHeader
            title="Contracts"
            subtitle={`${rows.length} of ${data?.contracts?.length || 0}`}
            right={
              <TouchableOpacity onPress={() => router.back()} testID="admin-contracts-back">
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
                testID={`admin-contracts-filter-${st}`}
              >
                <Text style={[s.chipText, filter === st && s.chipTextActive]}>{st}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      }
      loading={loading}
      empty={rows.length === 0}
      emptyLabel={filter === 'all' ? 'No contracts yet.' : `No ${filter} contracts.`}
      refreshing={refreshing}
      onRefresh={reload}
    >
      {rows.map((c) => (
        <AdminRow
          key={c.id}
          title={c.project_title || c.project_id}
          subtitle={`${c.client_name || c.client_id || '—'}${c.amount ? `  ·  ${c.currency || '$'}${c.amount.toLocaleString()}` : ''}`}
          rightLabel={c.status}
          rightTone={STATUS_TONE[c.status] || 'default'}
          icon="document-text-outline"
          onPress={() => router.push(`/admin/projects/${c.project_id}`)}
          testID={`admin-contract-row-${c.id}`}
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
