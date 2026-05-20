/**
 * /admin/inbox — Admin messages inbox.
 *
 * Endpoint: GET /api/admin/messages/inbox  → { messages: [] }
 * Each row: from / subject / preview / timestamp.
 * Tap → /admin/inbox/[id] (deferred — backend message detail endpoint
 *      already exists at /api/admin/messages/{id}; UI ships in next pass).
 */
import React from 'react';
import { TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import T from '../../src/theme';
import { useAdminResource } from '../../src/admin/useAdminResource';
import { AdminHeader, AdminListScreen, AdminRow } from '../../src/admin/ui';

type Msg = {
  id: string;
  from?: string;
  from_name?: string;
  subject?: string;
  preview?: string;
  unread?: boolean;
  created_at?: string;
};

function ago(iso?: string): string {
  if (!iso) return '';
  try {
    const t = new Date(iso).getTime();
    const diff = Math.max(0, Date.now() - t);
    const h = Math.floor(diff / 3_600_000);
    if (h < 1) return 'now';
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  } catch {
    return '';
  }
}

export default function AdminInboxScreen() {
  const { data, loading, refreshing, reload } = useAdminResource<{ messages?: Msg[] } | Msg[]>('/admin/messages/inbox');
  const list = Array.isArray(data) ? data : (data?.messages || []);

  const unreadCount = list.filter((m) => m.unread).length;

  return (
    <AdminListScreen
      header={
        <AdminHeader
          title="Inbox"
          subtitle={`${list.length} messages${unreadCount ? `  ·  ${unreadCount} unread` : ''}`}
          right={
            <TouchableOpacity onPress={() => router.back()} testID="admin-inbox-back">
              <Ionicons name="close" size={22} color={T.textSecondary} />
            </TouchableOpacity>
          }
        />
      }
      loading={loading}
      empty={list.length === 0}
      emptyLabel="Inbox empty."
      refreshing={refreshing}
      onRefresh={reload}
    >
      {list.map((m) => (
        <AdminRow
          key={m.id}
          title={(m.subject || '(no subject)') + (m.unread ? '  •' : '')}
          subtitle={`${m.from_name || m.from || '—'}${m.preview ? `  ·  ${m.preview.slice(0, 50)}` : ''}`}
          rightLabel={ago(m.created_at)}
          rightTone={m.unread ? 'info' : 'default'}
          icon="mail-outline"
          testID={`admin-inbox-msg-${m.id}`}
        />
      ))}
    </AdminListScreen>
  );
}
