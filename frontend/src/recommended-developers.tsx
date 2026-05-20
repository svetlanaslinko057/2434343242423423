import { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from './api';
import T from './theme';

// Wave 9 — shows top-3 recommended developers for a module with one-click "Invite top N" CTA.
// NEVER auto-assigns. Only invites developers to bid.

export default function RecommendedDevelopers({ moduleId, moduleTitle }: { moduleId: string; moduleTitle?: string }) {
  const [recs, setRecs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [invited, setInvited] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/modules/${moduleId}/recommended-developers`);
      setRecs(r.data.recommended || []);
      // Default select all with score >= 70
      const def: Record<string, boolean> = {};
      (r.data.recommended || []).forEach((d: any) => { def[d.developer_id] = d.score >= 70; });
      setSelected(def);
    } catch {} finally { setLoading(false); }
  }, [moduleId]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) => setSelected(p => ({ ...p, [id]: !p[id] }));

  const inviteSelected = async () => {
    const ids = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
    if (ids.length === 0) { Alert.alert('Select at least one developer'); return; }
    setInviting(true);
    try {
      const r = await api.post(`/modules/${moduleId}/invite-developers`, { developer_ids: ids });
      Alert.alert('Invited', `${r.data.count} developer(s) invited to bid on ${moduleTitle || 'this module'}`);
      setInvited(true);
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed');
    } finally { setInviting(false); }
  };

  if (loading && recs.length === 0) return <View style={s.wrap}><ActivityIndicator color={T.primary} /></View>;
  if (recs.length === 0) return null;

  const fitColor = (f: string) => f === 'strong' ? T.success : f === 'good' ? T.primary : f === 'fair' ? T.risk : T.textMuted;
  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <View testID="recommended-developers" style={s.wrap}>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.iconWrap}><Ionicons name="people" size={14} color={T.primary} /></View>
          <Text style={s.title}>Recommended developers</Text>
          <View style={s.countBadge}><Text style={s.countText}>{recs.length}</Text></View>
        </View>
        <TouchableOpacity onPress={load} testID="recommend-refresh">
          <Ionicons name="refresh" size={16} color={T.textMuted} />
        </TouchableOpacity>
      </View>

      <Text style={s.principle}>System recommends — market decides. No auto-assign.</Text>

      {recs.map((d, idx) => (
        <TouchableOpacity
          key={d.developer_id}
          testID={`rec-dev-${idx + 1}`}
          style={[s.devCard, selected[d.developer_id] && s.devCardOn]}
          onPress={() => toggle(d.developer_id)}
          activeOpacity={0.7}
        >
          <View style={[s.rank, { backgroundColor: fitColor(d.fit) + '22' }]}>
            <Text style={[s.rankText, { color: fitColor(d.fit) }]}>#{idx + 1}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={s.devNameRow}>
              <Text style={s.devName}>{d.name}</Text>
              {d.tier === 'elite' && <View style={s.eliteBadge}><Ionicons name="star" size={9} color={T.primary} /><Text style={s.eliteText}>ELITE</Text></View>}
              <View style={s.scorePill}><Text style={[s.scorePillText, { color: fitColor(d.fit) }]}>{d.score}%</Text></View>
            </View>
            <View style={s.reasonsRow}>
              {(d.reasons || []).slice(0, 3).map((r: string, i: number) => (
                <View key={i} style={s.reasonChip}>
                  <Ionicons name="checkmark" size={9} color={T.success} />
                  <Text style={s.reasonText}>{r}</Text>
                </View>
              ))}
            </View>
            {(d.penalties || []).length > 0 && (
              <View style={s.penaltyRow}>
                {d.penalties.map((p: string, i: number) => (
                  <Text key={i} style={s.penaltyText}>⚠ {p}</Text>
                ))}
              </View>
            )}
            <Text style={s.capLine}>Load: {d.active_modules}/{d.capacity} · QA {d.qa_pass_rate}%{d.avg_delivery_days ? ` · ${d.avg_delivery_days}d avg` : ''}</Text>
          </View>
          <View style={[s.checkbox, selected[d.developer_id] && s.checkboxOn]}>
            {selected[d.developer_id] && <Ionicons name="checkmark" size={14} color={T.bg} />}
          </View>
        </TouchableOpacity>
      ))}

      <TouchableOpacity
        testID="invite-developers-cta"
        style={[s.inviteBtn, (selectedCount === 0 || inviting || invited) && s.inviteBtnDisabled]}
        onPress={inviteSelected}
        disabled={selectedCount === 0 || inviting || invited}
      >
        {inviting ? <ActivityIndicator color={T.bg} /> : (
          <>
            <Ionicons name={invited ? 'checkmark-done' : 'paper-plane'} size={16} color={T.bg} />
            <Text style={s.inviteBtnText}>{invited ? 'Invited ✓' : `Invite top ${selectedCount}`}</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginHorizontal: T.md, marginBottom: T.md, backgroundColor: T.surface1, borderRadius: T.radius, padding: T.md, borderWidth: 1, borderColor: T.primaryBorder },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconWrap: { width: 22, height: 22, borderRadius: 11, backgroundColor: T.primaryBgStrong, alignItems: 'center', justifyContent: 'center' },
  title: { color: T.text, fontSize: T.body, fontWeight: '700' },
  countBadge: { backgroundColor: T.primaryBgStrong, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  countText: { color: T.primary, fontSize: T.tiny, fontWeight: '700' },
  principle: { color: T.textMuted, fontSize: T.tiny, marginBottom: T.sm, fontStyle: 'italic' },

  devCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: T.surface2, borderRadius: T.radiusSm, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: T.border },
  devCardOn: { borderColor: T.primary, backgroundColor: T.primaryBg },
  rank: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontSize: T.tiny, fontWeight: '800' },
  devNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  devName: { color: T.text, fontSize: T.small, fontWeight: '700' },
  eliteBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: T.primaryBgStrong, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  eliteText: { color: T.primary, fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  scorePill: { backgroundColor: T.surface3, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  scorePillText: { fontSize: T.tiny, fontWeight: '800' },
  reasonsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  reasonChip: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: T.successBg, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  reasonText: { color: T.textMuted, fontSize: 10 },
  penaltyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 3 },
  penaltyText: { color: T.risk, fontSize: 10 },
  capLine: { color: T.textMuted, fontSize: 10, marginTop: 3 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: T.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: T.primary, borderColor: T.primary },

  inviteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: T.primary, borderRadius: T.radiusSm, paddingVertical: 12, marginTop: 6 },
  inviteBtnDisabled: { opacity: 0.5 },
  inviteBtnText: { color: T.bg, fontWeight: '800', fontSize: T.body },
});
