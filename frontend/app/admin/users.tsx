/**
 * /admin/users — Users management (parity with web AdminUsersPage).
 *
 * Endpoint: GET /api/admin/users  → User[]
 * Filters: role chips (all / client / developer / admin / tester).
 * Action: tap row → role/status sheet (placeholder for now — full role-
 *         change flow ships in next admin pass; keeping shell so future
 *         PRs only edit the action handler).
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import T from '../../src/theme';
import { useAdminResource } from '../../src/admin/useAdminResource';
import { AdminHeader, AdminListScreen, AdminRow, AdminActionSheet } from '../../src/admin/ui';

type UserRow = {
  id: string;
  email: string;
  name?: string;
  roles?: string[];
  status?: string;
};

const ROLE_FILTERS = ['all', 'client', 'developer', 'admin', 'tester'] as const;
type RoleFilter = typeof ROLE_FILTERS[number];

export default function AdminUsersScreen() {
  const { data, loading, refreshing, reload } = useAdminResource<UserRow[]>('/admin/users');
  const [filter, setFilter] = useState<RoleFilter>('all');
  const [active, setActive] = useState<UserRow | null>(null);

  const rows = useMemo(() => {
    const list = Array.isArray(data) ? data : [];
    if (filter === 'all') return list;
    return list.filter((u) => (u.roles || []).includes(filter));
  }, [data, filter]);

  return (
    <AdminListScreen
      header={
        <>
          <AdminHeader
            title="Users"
            subtitle={`${rows.length} of ${data?.length || 0}`}
            right={
              <TouchableOpacity onPress={() => router.back()} testID="admin-users-back">
                <Ionicons name="close" size={22} color={T.textSecondary} />
              </TouchableOpacity>
            }
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.filters}
          >
            {ROLE_FILTERS.map((r) => (
              <TouchableOpacity
                key={r}
                style={[s.chip, filter === r && s.chipActive]}
                onPress={() => setFilter(r)}
                testID={`admin-users-filter-${r}`}
              >
                <Text style={[s.chipText, filter === r && s.chipTextActive]}>{r}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      }
      loading={loading}
      empty={rows.length === 0}
      emptyLabel={filter === 'all' ? 'No users yet.' : `No ${filter}s yet.`}
      refreshing={refreshing}
      onRefresh={reload}
    >
      {rows.map((u) => (
        <AdminRow
          key={u.id}
          title={u.name || u.email}
          subtitle={u.email + (u.roles ? ` · ${u.roles.join(', ')}` : '')}
          rightLabel={u.status || 'active'}
          rightTone={u.status === 'suspended' ? 'danger' : 'success'}
          icon="person-outline"
          onPress={() => setActive(u)}
          testID={`admin-user-row-${u.id}`}
        />
      ))}
      <AdminActionSheet
        visible={!!active}
        title={active?.name || active?.email || ''}
        body={active ? `User id: ${active.id}\nRoles: ${(active.roles || []).join(', ') || '—'}` : undefined}
        actions={[
          { label: 'View activity', testID: 'admin-user-view', onPress: () => { setActive(null); } },
        ]}
        onClose={() => setActive(null)}
      />
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
