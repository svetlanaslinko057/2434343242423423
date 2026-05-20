/**
 * BLOCK 5.2 — Client Transparency feed component.
 * Human-readable auto_actions + confidence colour + Undo button.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import api from './api';
import T from './theme';

type HumanAction = {
  action_id: string;
  module_id: string;
  module_title?: string;
  icon: string;
  human_title: string;
  human_description: string;
  impact: string;
  why: string[];
  confidence: number;
  confidence_colour: 'green' | 'yellow' | 'grey';
  status: string;
  revert_available: boolean;
};

const CONF_COLOURS = {
  green: T.success,
  yellow: T.warning,
  grey: T.textMuted,
};

export function SystemActionsFeed({ limit = 5 }: { limit?: number }) {
  const [rows, setRows] = useState<HumanAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/client/system-actions?limit=${limit * 3}`);
      setRows(res.data.actions || []);
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed');
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => { load(); }, [load]);

  const undo = async (id: string) => {
    try {
      await api.post(`/auto-actions/${id}/revert`, {});
      Alert.alert(
        'Action reverted',
        'System will avoid similar action for next 10 min'
      );
      await load();
    } catch (e: any) {
      Alert.alert('Cannot undo', e?.response?.data?.detail || 'Error');
    }
  };

  if (loading) return null;
  if (error) return null;
  if (!rows.length) return null;

  const visible = showAll ? rows : rows.slice(0, limit);

  return (
    <View style={styles.card} testID="system-actions-feed">
      <View style={styles.header}>
        <Text style={styles.h}>⚙️ System actions</Text>
        <Text style={styles.count}>{rows.length} recent</Text>
      </View>

      {visible.map((a) => (
        <View key={a.action_id} style={styles.row} testID={`sa-${a.action_id}`}>
          <Text style={styles.icon}>{a.icon}</Text>
          <View style={styles.body}>
            <Text style={styles.title}>{a.human_title}</Text>
            <Text style={styles.desc}>{a.human_description}</Text>
            {a.module_title && <Text style={styles.mod}>· {a.module_title}</Text>}

            <View style={styles.confRow}>
              <View style={[styles.confDot, { backgroundColor: CONF_COLOURS[a.confidence_colour] }]} />
              <Text style={[styles.confTxt, { color: CONF_COLOURS[a.confidence_colour] }]}>
                confidence {(a.confidence * 100).toFixed(0)}%
              </Text>
              {a.revert_available && (
                <TouchableOpacity
                  style={styles.undoBtn}
                  onPress={() => undo(a.action_id)}
                  testID={`undo-${a.action_id}`}
                >
                  <Text style={styles.undoTxt}>Undo</Text>
                </TouchableOpacity>
              )}
            </View>

            {a.why.length > 0 && (
              <Text style={styles.why}>Why: {a.why.join(' · ')}</Text>
            )}
          </View>
        </View>
      ))}

      {rows.length > limit && (
        <TouchableOpacity onPress={() => setShowAll(!showAll)} style={styles.moreBtn}>
          <Text style={styles.moreTxt}>
            {showAll ? 'Show less' : `Show all ${rows.length}`}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: T.surface, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: T.border, marginVertical: 8,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 12,
  },
  h: { color: T.text, fontSize: 15, fontWeight: '700' },
  count: { color: T.textMuted, fontSize: 11 },

  row: {
    flexDirection: 'row', gap: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: T.border,
  },
  icon: { fontSize: 24 },
  body: { flex: 1 },
  title: { color: T.text, fontSize: 13, fontWeight: '700' },
  desc: { color: T.textSecondary, fontSize: 12, marginTop: 3, lineHeight: 16 },
  mod: { color: T.textMuted, fontSize: 10, marginTop: 2, fontStyle: 'italic' },
  confRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8,
  },
  confDot: { width: 8, height: 8, borderRadius: 4 },
  confTxt: { fontSize: 11, fontWeight: '600' },
  undoBtn: {
    marginLeft: 'auto', borderWidth: 1, borderColor: T.border,
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 4,
  },
  undoTxt: { color: T.text, fontSize: 11, fontWeight: '600' },
  why: { color: T.textMuted, fontSize: 10, marginTop: 6, fontStyle: 'italic' },

  moreBtn: { marginTop: 10, alignItems: 'center' },
  moreTxt: { color: T.primary, fontSize: 12, fontWeight: '600' },
});

export default SystemActionsFeed;
