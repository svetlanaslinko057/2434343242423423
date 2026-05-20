/**
 * /admin/team — Team / capacity rebalance (parity with web AdminTeamPage).
 *
 * Endpoints:
 *   GET /api/admin/team/capacity     → { developers: [], totals: {...} }
 *   GET /api/admin/team/bottlenecks  → { bottlenecks: [] }
 *
 * View: capacity rows (one per dev) sorted by load %, plus a bottleneck
 * section above the list. Background AUTO_BALANCER loop already moves
 * units between devs every 3 min (see `team_balancer.py`) — this screen
 * surfaces the SAME signals so the admin can see *why* a rebalance moved.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import T from '../../src/theme';
import { useAdminResource } from '../../src/admin/useAdminResource';
import { AdminHeader, AdminListScreen, AdminRow, AdminSection } from '../../src/admin/ui';

type Capacity = {
  developers: Array<{
    id: string;
    name: string;
    load_pct?: number;
    active_units?: number;
    capacity_units?: number;
    tier?: string;
  }>;
  totals?: { avg_load?: number; overloaded?: number; idle?: number };
};
type Bottlenecks = { bottlenecks?: Array<{ module_id: string; title: string; reason: string; waiting_for?: string }> };

function loadTone(pct?: number): 'success' | 'warning' | 'danger' | 'default' {
  if (typeof pct !== 'number') return 'default';
  if (pct >= 95) return 'danger';
  if (pct >= 75) return 'warning';
  return 'success';
}

export default function AdminTeamScreen() {
  const cap = useAdminResource<Capacity>('/admin/team/capacity');
  const bn = useAdminResource<Bottlenecks>('/admin/team/bottlenecks');

  const devs = cap.data?.developers || [];
  const bottlenecks = bn.data?.bottlenecks || [];

  const onRefresh = async () => {
    await Promise.all([cap.reload(), bn.reload()]);
  };

  return (
    <AdminListScreen
      header={
        <AdminHeader
          title="Team capacity"
          subtitle={
            cap.data?.totals
              ? `avg ${Math.round(cap.data.totals.avg_load || 0)}% · overloaded ${cap.data.totals.overloaded || 0} · idle ${cap.data.totals.idle || 0}`
              : undefined
          }
          right={
            <TouchableOpacity onPress={() => router.back()} testID="admin-team-back">
              <Ionicons name="close" size={22} color={T.textSecondary} />
            </TouchableOpacity>
          }
        />
      }
      loading={cap.loading && bn.loading}
      empty={devs.length === 0 && bottlenecks.length === 0}
      emptyLabel="Team idle — no signal."
      refreshing={cap.refreshing || bn.refreshing}
      onRefresh={onRefresh}
    >
      {bottlenecks.length > 0 && (
        <AdminSection title="Bottlenecks" count={bottlenecks.length}>
          {bottlenecks.map((b) => (
            <AdminRow
              key={b.module_id}
              title={b.title}
              subtitle={`${b.reason}${b.waiting_for ? ' · waiting for ' + b.waiting_for : ''}`}
              rightLabel="blocked"
              rightTone="danger"
              icon="alert-circle-outline"
              testID={`admin-bottleneck-${b.module_id}`}
            />
          ))}
        </AdminSection>
      )}
      <AdminSection title="Developers" count={devs.length}>
        {devs.map((d) => (
          <AdminRow
            key={d.id}
            title={d.name + (d.tier ? `  ·  ${d.tier}` : '')}
            subtitle={`${d.active_units || 0} active · ${d.capacity_units || 0} capacity`}
            rightLabel={typeof d.load_pct === 'number' ? `${Math.round(d.load_pct)}%` : '—'}
            rightTone={loadTone(d.load_pct)}
            icon="people-outline"
            testID={`admin-team-dev-${d.id}`}
          />
        ))}
      </AdminSection>
    </AdminListScreen>
  );
}
