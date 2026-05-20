/**
 * /admin/master — Master Dashboard.
 *
 * Endpoint: GET /api/admin/master/pipeline → { stages: [...] }
 * Single funnel-style readout of how many entities are in each stage
 * (leads → estimates → projects → modules in build → modules in QA →
 * modules done → payouts pending). Lets the admin see at a glance whether
 * the system is healthy without drilling into individual cabinets.
 *
 * Tap a stage → /admin/control-center (existing deep-link) for details.
 */
import React, { useMemo } from 'react';
import { TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import T from '../../src/theme';
import { useAdminResource } from '../../src/admin/useAdminResource';
import { AdminHeader, AdminListScreen, AdminRow, AdminSection } from '../../src/admin/ui';

type Stage = {
  key: string;
  label: string;
  count: number;
  trend_pct?: number;
  alert?: boolean;
};
type Pipeline = {
  stages?: Stage[];
  generated_at?: string;
};

function trendTone(t?: number): 'success' | 'warning' | 'danger' | 'default' {
  if (typeof t !== 'number') return 'default';
  if (t > 5) return 'success';
  if (t < -10) return 'danger';
  if (t < 0) return 'warning';
  return 'default';
}

function trendLabel(t?: number): string {
  if (typeof t !== 'number') return '';
  const sign = t > 0 ? '+' : '';
  return `${sign}${t.toFixed(0)}%`;
}

export default function AdminMasterDashboardScreen() {
  const { data, loading, refreshing, reload } = useAdminResource<Pipeline>('/admin/master/pipeline');

  const stages = useMemo(() => data?.stages || [], [data]);
  const alerts = stages.filter((s) => s.alert);

  return (
    <AdminListScreen
      header={
        <AdminHeader
          title="Master dashboard"
          subtitle={data?.generated_at ? `as of ${new Date(data.generated_at).toLocaleTimeString()}` : 'pipeline overview'}
          right={
            <TouchableOpacity onPress={() => router.back()} testID="admin-master-back">
              <Ionicons name="close" size={22} color={T.textSecondary} />
            </TouchableOpacity>
          }
        />
      }
      loading={loading}
      empty={stages.length === 0}
      emptyLabel="No pipeline data yet."
      refreshing={refreshing}
      onRefresh={reload}
    >
      {alerts.length > 0 && (
        <AdminSection title="Needs attention" count={alerts.length}>
          {alerts.map((st) => (
            <AdminRow
              key={`alert-${st.key}`}
              title={st.label}
              subtitle={`${st.count} entities`}
              rightLabel="alert"
              rightTone="danger"
              icon="alert-circle-outline"
              onPress={() => router.push('/admin/control')}
              testID={`admin-master-alert-${st.key}`}
            />
          ))}
        </AdminSection>
      )}
      <AdminSection title="Pipeline stages" count={stages.length}>
        {stages.map((st) => (
          <AdminRow
            key={st.key}
            title={st.label}
            subtitle={`${st.count} entities`}
            rightLabel={trendLabel(st.trend_pct) || String(st.count)}
            rightTone={trendTone(st.trend_pct)}
            icon="git-network-outline"
            onPress={() => router.push('/admin/control')}
            testID={`admin-master-stage-${st.key}`}
          />
        ))}
      </AdminSection>
    </AdminListScreen>
  );
}
