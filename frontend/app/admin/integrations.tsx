/**
 * /admin/integrations — Capability / integration status (read-only here;
 * key rotation lives on web per product-scope-freeze).
 *
 * Endpoint: GET /api/integrations/manifest  (or /capabilities)
 * Surfaces each provider with mode badge (live / mock / degraded / offline).
 */
import React from 'react';
import { TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import T from '../../src/theme';
import { useAdminResource } from '../../src/admin/useAdminResource';
import { AdminHeader, AdminListScreen, AdminRow } from '../../src/admin/ui';

type ProviderState = {
  name: string;
  provider?: string;
  mode: 'live' | 'mock' | 'degraded' | 'unavailable' | string;
  available?: boolean;
  reason?: string;
};
type Manifest = {
  capabilities?: Record<string, ProviderState>;
  summary?: { live?: number; mock?: number; degraded?: number; unavailable?: number };
};

const MODE_TONE: Record<string, 'success' | 'warning' | 'info' | 'danger' | 'default'> = {
  live: 'success',
  mock: 'info',
  degraded: 'warning',
  unavailable: 'danger',
};

export default function AdminIntegrationsScreen() {
  const { data, loading, refreshing, reload } = useAdminResource<Manifest>('/integrations/manifest');

  const caps = data?.capabilities || {};
  const rows = Object.entries(caps).map(([key, state]) => ({ ...state, name: key })) as Array<ProviderState & { name: string }>;

  const summary = data?.summary;
  const subtitle = summary
    ? `live ${summary.live || 0}  ·  mock ${summary.mock || 0}  ·  degraded ${summary.degraded || 0}  ·  offline ${summary.unavailable || 0}`
    : undefined;

  return (
    <AdminListScreen
      header={
        <AdminHeader
          title="Integrations"
          subtitle={subtitle}
          right={
            <TouchableOpacity onPress={() => router.back()} testID="admin-integrations-back">
              <Ionicons name="close" size={22} color={T.textSecondary} />
            </TouchableOpacity>
          }
        />
      }
      loading={loading}
      empty={rows.length === 0}
      emptyLabel="No integrations registered."
      refreshing={refreshing}
      onRefresh={reload}
    >
      {rows.map((p) => (
        <AdminRow
          key={p.name}
          title={p.name}
          subtitle={(p.provider ? `provider: ${p.provider}` : 'provider: —') + (p.reason ? `  ·  ${p.reason}` : '')}
          rightLabel={p.mode}
          rightTone={MODE_TONE[p.mode] || 'default'}
          icon="extension-puzzle-outline"
          testID={`admin-integration-${p.name}`}
        />
      ))}
    </AdminListScreen>
  );
}
