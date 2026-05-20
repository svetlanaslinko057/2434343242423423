import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, Alert, Linking, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { runtime } from '../../../../src/runtime';
import T from '../../../../src/theme';

/**
 * Mission Detail — open preview, look around, submit feedback.
 *
 * Backend:
 *   GET  /api/validator/missions/{id}                → { campaign, my_submission }
 *   POST /api/validator/missions/{id}/submit         → { kind, category, comment, platform_hint }
 *
 * UX shape:
 *   1) Goal + project + reward
 *   2) "Open preview" button (opens preview_url in browser)
 *   3) Checklist of things to look at
 *   4) Two big choices: "Looks good" / "Report issue"
 *   5) If issue → category picker + comment textarea
 *   6) Submit → confirmation, return home
 *
 * NO severity (low/medium/high/critical). NO reproduction matrix.
 * Consumer-simple. One submission per validator per mission (v1).
 */
type Mission = {
  campaign_id: string;
  project_title: string;
  goal: string;
  reward_per_useful: number;
  preview_url?: string | null;
  checklist: string[];
  deadline_at: string;
  max_validators: number;
};

export default function MissionDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [mission, setMission] = useState<Mission | null>(null);
  const [mySub, setMySub] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  // form state
  const [kind, setKind] = useState<'looks_good' | 'issue' | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [comment, setComment] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await runtime.get<{ campaign: Mission; my_submission: any }>(`/api/validator/missions/${id}`);
      setMission(r.data?.campaign || null);
      setMySub(r.data?.my_submission || null);
    } catch { /* swallow */ }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const platformHint = Platform.OS === 'web'
    ? `Web / ${typeof window !== 'undefined' && window.innerWidth < 768 ? 'mobile-viewport' : 'desktop'}`
    : `${Platform.OS} ${Platform.Version}`;

  const submit = async () => {
    if (!mission || !kind) return;
    if (kind === 'issue' && !comment.trim()) {
      Alert.alert('Tell us what you noticed', 'Add a short comment so we know what you spotted.');
      return;
    }
    setBusy(true);
    try {
      await runtime.post(`/api/validator/missions/${mission.campaign_id}/submit`, {
        kind,
        category: kind === 'issue' ? (category || 'General') : null,
        comment: comment.trim() || null,
        platform_hint: platformHint,
      });
      Alert.alert(
        'Thanks!',
        'Your feedback is in. We will review and award credits if it is useful.',
        [{ text: 'OK', onPress: () => router.replace('/client/validation' as any) }],
      );
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.response?.data?.detail || 'Could not submit. Try again.';
      Alert.alert('Submit failed', String(msg));
    } finally {
      setBusy(false);
    }
  };

  if (!mission) {
    return (
      <View style={[s.container, { padding: T.lg }]}>
        <Text style={s.title}>Loading mission…</Text>
      </View>
    );
  }

  if (mySub) {
    return (
      <ScrollView style={s.container}>
        <View style={s.content}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={18} color={T.text} />
            <Text style={s.backText}>Missions</Text>
          </TouchableOpacity>
          <Text style={s.kicker}>{mission.goal.toUpperCase()}</Text>
          <Text style={s.title}>{mission.project_title}</Text>
          <View style={s.doneCard}>
            <Ionicons name="checkmark-circle" size={28} color={T.success} />
            <Text style={s.doneTitle}>You already contributed</Text>
            <Text style={s.doneSub}>
              Your feedback is being reviewed. Check History to see the verdict.
            </Text>
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={s.container} testID="mission-detail">
      <View style={s.content}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={18} color={T.text} />
          <Text style={s.backText}>Missions</Text>
        </TouchableOpacity>

        <Text style={s.kicker}>{mission.goal.toUpperCase()}</Text>
        <Text style={s.title}>{mission.project_title}</Text>

        <View style={s.rewardCard}>
          <View>
            <Text style={s.rewardLabel}>IF MARKED USEFUL</Text>
            <Text style={s.rewardValue}>+{mission.reward_per_useful} credits</Text>
          </View>
          <Ionicons name="diamond" size={24} color={T.primary} />
        </View>

        {/* Open preview CTA */}
        {mission.preview_url ? (
          <TouchableOpacity
            testID="open-preview-btn"
            style={s.openBtn}
            onPress={() => Linking.openURL(mission.preview_url!)}
          >
            <Ionicons name="open-outline" size={18} color={T.text} />
            <Text style={s.openBtnText}>Open product preview</Text>
            <Ionicons name="chevron-forward" size={16} color={T.textMuted} />
          </TouchableOpacity>
        ) : null}

        {/* Checklist */}
        <Text style={s.sectionTitle}>What to look at</Text>
        <View style={s.checklistBox}>
          {mission.checklist.map((c, i) => (
            <View key={i} style={s.checklistItem}>
              <View style={s.bullet} />
              <Text style={s.checklistText}>{c}</Text>
            </View>
          ))}
        </View>

        {/* Submit choice */}
        <Text style={s.sectionTitle}>Your feedback</Text>
        <View style={s.choiceRow}>
          <TouchableOpacity
            testID="choice-looks-good"
            style={[s.choiceCard, kind === 'looks_good' && s.choiceCardActiveGood]}
            onPress={() => { setKind('looks_good'); setCategory(null); }}
          >
            <Ionicons name="checkmark-circle-outline" size={22} color={kind === 'looks_good' ? T.success : T.textMuted} />
            <Text style={[s.choiceText, kind === 'looks_good' && { color: T.success }]}>Looks good</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="choice-issue"
            style={[s.choiceCard, kind === 'issue' && s.choiceCardActiveIssue]}
            onPress={() => setKind('issue')}
          >
            <Ionicons name="alert-circle-outline" size={22} color={kind === 'issue' ? T.warning : T.textMuted} />
            <Text style={[s.choiceText, kind === 'issue' && { color: T.warning }]}>Found issue</Text>
          </TouchableOpacity>
        </View>

        {/* Issue details — only if "issue" chosen */}
        {kind === 'issue' && (
          <View>
            <Text style={s.subLabel}>Where did you notice it?</Text>
            <View style={s.catRow}>
              {mission.checklist.map((c) => (
                <TouchableOpacity
                  key={c}
                  testID={`cat-${c}`}
                  style={[s.catChip, category === c && s.catChipActive]}
                  onPress={() => setCategory(c)}
                >
                  <Text style={[s.catChipText, category === c && { color: T.primaryInk }]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.subLabel}>What did you notice?</Text>
            <TextInput
              testID="issue-comment"
              style={s.textarea}
              value={comment}
              onChangeText={setComment}
              placeholder="Describe what felt off, broken, or confusing…"
              placeholderTextColor={T.textMuted}
              multiline
              maxLength={600}
            />
          </View>
        )}

        {kind === 'looks_good' && (
          <View>
            <Text style={s.subLabel}>Anything to add? (optional)</Text>
            <TextInput
              testID="looks-good-comment"
              style={s.textarea}
              value={comment}
              onChangeText={setComment}
              placeholder="Optional: one thing that felt great…"
              placeholderTextColor={T.textMuted}
              multiline
              maxLength={400}
            />
          </View>
        )}

        {kind && (
          <TouchableOpacity
            testID="submit-feedback-btn"
            style={[s.submitBtn, busy && { opacity: 0.6 }]}
            onPress={submit}
            disabled={busy}
          >
            <Text style={s.submitText}>{busy ? 'Sending…' : 'Submit feedback'}</Text>
          </TouchableOpacity>
        )}

        <View style={s.footnote}>
          <Ionicons name="information-circle-outline" size={14} color={T.textMuted} />
          <Text style={s.footnoteText}>
            One submission per mission. Admin reads everything and decides what
            is signal vs noise. You earn credits only on useful feedback.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: T.md },
  backBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: T.md, gap: 4 },
  backText: { color: T.text, fontSize: T.body },
  kicker: { color: T.primary, fontSize: 10, letterSpacing: 2.5, fontWeight: '700', marginBottom: 6 },
  title: { color: T.text, fontSize: T.h2 || T.h1, fontWeight: '800' },
  rewardCard: {
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    padding: T.md, marginTop: T.md, marginBottom: T.md,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1, borderColor: T.border,
  },
  rewardLabel: { color: T.textMuted, fontSize: 9, letterSpacing: 1.5, marginBottom: 4 },
  rewardValue: { color: T.text, fontSize: 18, fontWeight: '800' },
  openBtn: {
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    padding: T.md, marginBottom: T.lg,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: T.border,
  },
  openBtnText: { color: T.text, fontSize: T.body, fontWeight: '700', flex: 1 },
  sectionTitle: { color: T.textMuted, fontSize: T.small, textTransform: 'uppercase', letterSpacing: 2, marginBottom: T.sm, marginTop: T.xs },
  checklistBox: { marginBottom: T.lg, gap: T.xs },
  checklistItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.primary },
  checklistText: { color: T.text, fontSize: T.body },
  choiceRow: { flexDirection: 'row', gap: T.sm, marginBottom: T.md },
  choiceCard: {
    flex: 1, backgroundColor: T.surface1, borderRadius: T.radiusSm,
    padding: T.md, alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: T.border,
  },
  choiceCardActiveGood: { borderColor: T.success, backgroundColor: T.successTint || T.surface1 },
  choiceCardActiveIssue: { borderColor: T.warning, backgroundColor: T.warningTint || T.surface1 },
  choiceText: { color: T.text, fontSize: T.body, fontWeight: '700' },
  subLabel: { color: T.textMuted, fontSize: T.tiny, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6, marginTop: T.sm },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: T.sm },
  catChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    backgroundColor: T.surface1, borderWidth: 1, borderColor: T.border,
  },
  catChipActive: { backgroundColor: T.primary, borderColor: T.primary },
  catChipText: { color: T.text, fontSize: 12 },
  textarea: {
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    padding: T.md, color: T.text, fontSize: T.body,
    borderWidth: 1, borderColor: T.border, minHeight: 100, textAlignVertical: 'top',
  },
  submitBtn: {
    backgroundColor: T.primary, borderRadius: T.radiusSm,
    paddingVertical: 14, alignItems: 'center', marginTop: T.md,
  },
  submitText: { color: T.primaryInk, fontSize: T.body, fontWeight: '800' },
  footnote: { flexDirection: 'row', gap: 6, marginTop: T.lg, alignItems: 'flex-start', paddingHorizontal: T.sm },
  footnoteText: { flex: 1, color: T.textMuted, fontSize: T.tiny, lineHeight: 16 },
  doneCard: {
    backgroundColor: T.surface1, borderRadius: T.radiusSm,
    padding: T.lg, marginTop: T.lg, alignItems: 'center', gap: T.sm,
    borderWidth: 1, borderColor: T.successBorder || T.border,
  },
  doneTitle: { color: T.text, fontSize: T.body, fontWeight: '700' },
  doneSub: { color: T.textMuted, fontSize: T.small, textAlign: 'center' },
});
