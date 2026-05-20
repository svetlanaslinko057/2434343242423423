/**
 * /admin/templates — Scope & decomposition templates.
 *
 * Two backend endpoints surface different template families:
 *   GET /api/admin/scope-templates           — top-level scope blueprints
 *   GET /api/admin/decomposition/templates   — module decomposition recipes
 *
 * We merge them into two sections so the admin doesn't have to bounce
 * between two screens; both share the same row shape.
 */
import React from 'react';
import { TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import T from '../../src/theme';
import { useAdminResource } from '../../src/admin/useAdminResource';
import { AdminHeader, AdminListScreen, AdminRow, AdminSection } from '../../src/admin/ui';

type Tpl = {
  id: string;
  title?: string;
  name?: string;
  description?: string;
  category?: string;
  modules_count?: number;
  used_count?: number;
};

export default function AdminTemplatesScreen() {
  const scope = useAdminResource<{ templates?: Tpl[] } | Tpl[]>('/admin/scope-templates');
  const decomp = useAdminResource<{ templates?: Tpl[] } | Tpl[]>('/admin/decomposition/templates');

  const onRefresh = async () => {
    await Promise.all([scope.reload(), decomp.reload()]);
  };

  const scopeList = Array.isArray(scope.data) ? scope.data : (scope.data?.templates || []);
  const decompList = Array.isArray(decomp.data) ? decomp.data : (decomp.data?.templates || []);

  return (
    <AdminListScreen
      header={
        <AdminHeader
          title="Templates"
          subtitle={`scope ${scopeList.length}  ·  decomposition ${decompList.length}`}
          right={
            <TouchableOpacity onPress={() => router.back()} testID="admin-templates-back">
              <Ionicons name="close" size={22} color={T.textSecondary} />
            </TouchableOpacity>
          }
        />
      }
      loading={scope.loading && decomp.loading}
      empty={scopeList.length === 0 && decompList.length === 0}
      emptyLabel="No templates yet."
      refreshing={scope.refreshing || decomp.refreshing}
      onRefresh={onRefresh}
    >
      {scopeList.length > 0 && (
        <AdminSection title="Scope templates" count={scopeList.length}>
          {scopeList.map((t) => (
            <AdminRow
              key={t.id}
              title={t.title || t.name || t.id}
              subtitle={`${t.category || '—'}${t.modules_count ? `  ·  ${t.modules_count} modules` : ''}`}
              rightLabel={typeof t.used_count === 'number' ? `${t.used_count}×` : undefined}
              rightTone="info"
              icon="layers-outline"
              testID={`admin-tpl-scope-${t.id}`}
            />
          ))}
        </AdminSection>
      )}
      {decompList.length > 0 && (
        <AdminSection title="Decomposition recipes" count={decompList.length}>
          {decompList.map((t) => (
            <AdminRow
              key={t.id}
              title={t.title || t.name || t.id}
              subtitle={t.description?.slice(0, 70)}
              rightLabel={typeof t.used_count === 'number' ? `${t.used_count}×` : undefined}
              rightTone="info"
              icon="grid-outline"
              testID={`admin-tpl-decomp-${t.id}`}
            />
          ))}
        </AdminSection>
      )}
    </AdminListScreen>
  );
}
