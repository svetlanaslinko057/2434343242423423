import { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, TextInput, Alert } from 'react-native';
import api from '../../src/api';
import T from '../../src/theme';

export default function ClientSupport() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');

  const load = async () => { try { const r = await api.get('/client/support-tickets'); setTickets(r.data.tickets || []); } catch {} };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!title) { Alert.alert('Error', 'Title required'); return; }
    try { await api.post('/client/support-tickets', { title, description: desc }); setShowNew(false); setTitle(''); setDesc(''); load(); }
    catch (e: any) { Alert.alert('Error', e.response?.data?.detail || 'Failed'); }
  };

  const statusColor = (s: string) => s === 'resolved' ? T.success : s === 'open' ? T.risk : T.info;

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={T.primary} />}>
      <View testID="client-support" style={s.content}>
        <View style={s.header}>
          <Text style={s.title}>Support</Text>
          <TouchableOpacity testID="new-ticket-btn" style={s.newBtn} onPress={() => setShowNew(!showNew)}><Text style={s.newBtnText}>+ New</Text></TouchableOpacity>
        </View>
        {showNew && (
          <View style={s.form}>
            <TextInput style={s.input} placeholder="Title" placeholderTextColor={T.textMuted} value={title} onChangeText={setTitle} />
            <TextInput style={s.input} placeholder="Description" placeholderTextColor={T.textMuted} value={desc} onChangeText={setDesc} multiline />
            <TouchableOpacity testID="submit-ticket-btn" style={s.submitBtn} onPress={create}><Text style={s.submitBtnText}>Submit Ticket</Text></TouchableOpacity>
          </View>
        )}
        {tickets.map(t => (
          <View key={t.ticket_id} style={s.card}>
            <View style={s.cardHeader}><Text style={s.cardTitle}>{t.title}</Text><Text style={[s.cardStatus, { color: statusColor(t.status) }]}>{t.status}</Text></View>
            <Text style={s.cardPriority}>Priority: {t.priority}</Text>
            {t.messages?.length > 0 && <Text style={s.lastMsg}>Last reply: {t.messages[t.messages.length - 1]?.text?.substring(0, 50)}...</Text>}
          </View>
        ))}
        {tickets.length === 0 && !showNew && <Text style={s.empty}>No support tickets</Text>}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: T.lg },
  title: { color: T.text, fontSize: T.h1, fontWeight: '800' },
  newBtn: { backgroundColor: T.primary, borderRadius: T.radiusSm, paddingHorizontal: 16, paddingVertical: 8 },
  newBtnText: { color: T.bg, fontWeight: '700', fontSize: T.small },
  form: { backgroundColor: T.surface1, borderRadius: T.radius, padding: T.md, marginBottom: T.lg, borderWidth: 1, borderColor: T.primaryBorder },
  input: { backgroundColor: T.surface2, borderRadius: T.radiusSm, padding: 12, color: T.text, fontSize: T.body, marginBottom: T.sm, borderWidth: 1, borderColor: T.border },
  submitBtn: { backgroundColor: T.primary, borderRadius: T.radiusSm, padding: 14, alignItems: 'center' },
  submitBtnText: { color: T.bg, fontWeight: '700' },
  card: { backgroundColor: T.surface1, borderRadius: T.radius, padding: T.md, marginBottom: T.md, borderWidth: 1, borderColor: T.border },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: T.text, fontSize: T.body, fontWeight: '600', flex: 1 },
  cardStatus: { fontSize: T.small, fontWeight: '600', textTransform: 'capitalize' },
  cardPriority: { color: T.textMuted, fontSize: T.small, marginTop: 4 },
  lastMsg: { color: T.textMuted, fontSize: T.tiny, marginTop: 4, fontStyle: 'italic' },
  empty: { color: T.textMuted, textAlign: 'center', padding: T.lg },
});
