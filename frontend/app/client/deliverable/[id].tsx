/**
 * Client Deliverable detail — slice #1 mobile parity surface.
 *
 * Semantic parity with web ClientDeliverablePage (NOT visual identity).
 *
 * Authority model (frozen — see /app/audit/SUBSTRATE_CONTRACT.md):
 *   - Canonical endpoint family: /api/client/deliverables/*
 *   - Canonical status enum:     pending_approval → approved | rejected
 *     Legacy read-side mapping:   pending → pending_approval,
 *                                 revision_requested → rejected
 *   - POST → refetch (no optimistic mutation).
 *   - No client-side derivation (no synthesized summary buckets,
 *     no role/status-derived `canApprove`).
 *   - Loading / error / empty separated structurally as inline branches.
 *   - Action visibility driven by backend `status`, not local role logic.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Modal, TextInput, KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../../../src/api';
import T from '../../../src/theme';

type Block = {
  block_id?: string;
  block_type?: string;
  title?: string;
  description?: string;
  preview_url?: string;
  api_url?: string;
};

type Resource = {
  resource_id?: string;
  title?: string;
  resource_type?: string;
  url?: string;
};

type Deliverable = {
  deliverable_id: string;
  project_id?: string;
  title?: string;
  summary?: string;
  version?: string;
  status: string;
  client_feedback?: string;
  blocks?: Block[];
  resources?: Resource[];
};

const STATUS_LABELS: Record<string, string> = {
  pending_approval: 'pending approval',
  approved: 'approved',
  rejected: 'changes requested',
};

function normalizeStatus(raw?: string): string {
  if (raw === 'pending') return 'pending_approval';
  if (raw === 'revision_requested') return 'rejected';
  return raw || '';
}

function blockIcon(type?: string): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case 'feature': return 'layers';
    case 'integration': return 'link';
    case 'api': return 'code-slash';
    case 'design': return 'document-text';
    default: return 'layers';
  }
}

export default function ClientDeliverableScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [deliverable, setDeliverable] = useState<Deliverable | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const r = await api.get<Deliverable>(`/client/deliverables/${id}`);
      setDeliverable(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.response?.data?.detail || 'Failed to load deliverable.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); void load(); };

  const handleApprove = async () => {
    setActionLoading(true);
    setActionError(null);
    try {
      await api.post(`/client/deliverables/${id}/approve`, {});
      setShowApproveModal(false);
      await load();
    } catch (e: any) {
      setActionError(e?.response?.data?.message || e?.response?.data?.detail || 'Failed to approve.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await api.post(`/client/deliverables/${id}/reject`, { reason: rejectReason });
      setShowRejectModal(false);
      setRejectReason('');
      await load();
    } catch (e: any) {
      setActionError(e?.response?.data?.message || e?.response?.data?.detail || 'Failed to request changes.');
    } finally {
      setActionLoading(false);
    }
  };

  // ─── STRUCTURAL STATES ─────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={s.centered} testID="deliverable-loading">
          <ActivityIndicator size="large" color={T.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={s.centered} testID="deliverable-error">
          <Ionicons name="alert-circle" size={48} color={T.danger} />
          <Text style={s.errorTitle}>Couldn't load delivery</Text>
          <Text style={s.errorBody}>{error}</Text>
          <TouchableOpacity
            onPress={load}
            style={s.retryBtn}
            testID="deliverable-retry"
          >
            <Text style={s.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!deliverable) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={s.centered} testID="deliverable-empty">
          <Ionicons name="cube-outline" size={48} color={T.textMuted} />
          <Text style={s.emptyText}>Deliverable not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const status = normalizeStatus(deliverable.status);
  const isPendingApproval = status === 'pending_approval';
  const isApproved = status === 'approved';
  const isRejected = status === 'rejected';

  const statusStyle = isPendingApproval
    ? { bg: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' }
    : isApproved
    ? { bg: 'rgba(34, 197, 94, 0.1)', color: '#22c55e' }
    : { bg: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={s.container}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.primary} />}
        testID="client-deliverable-screen"
      >
        {/* Header back button */}
        <TouchableOpacity
          onPress={() => router.back()}
          style={s.backRow}
          testID="deliverable-back"
        >
          <Ionicons name="chevron-back" size={20} color={T.textMuted} />
          <Text style={s.backText}>Back</Text>
        </TouchableOpacity>

        {/* Status Banner */}
        {isApproved && (
          <View style={[s.banner, { borderColor: 'rgba(34, 197, 94, 0.3)', backgroundColor: 'rgba(34, 197, 94, 0.1)' }]}>
            <Ionicons name="checkmark-circle" size={36} color="#22c55e" />
            <View style={s.bannerText}>
              <Text style={[s.bannerTitle, { color: '#22c55e' }]}>Delivery Approved</Text>
              <Text style={[s.bannerBody, { color: 'rgba(34, 197, 94, 0.7)' }]}>
                Thank you! Development continues to the next phase.
              </Text>
            </View>
          </View>
        )}

        {isRejected && (
          <View style={[s.banner, { borderColor: 'rgba(245, 158, 11, 0.3)', backgroundColor: 'rgba(245, 158, 11, 0.1)' }]}>
            <Ionicons name="refresh" size={32} color="#f59e0b" />
            <View style={s.bannerText}>
              <Text style={[s.bannerTitle, { color: '#f59e0b' }]}>Revision In Progress</Text>
              <Text style={[s.bannerBody, { color: 'rgba(245, 158, 11, 0.7)' }]}>
                Our team is working on your requested changes
              </Text>
              {!!deliverable.client_feedback && (
                <View style={s.feedbackBox}>
                  <Text style={s.feedbackText}>Your feedback: {deliverable.client_feedback}</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Title block */}
        <View style={s.titleBlock}>
          <View style={s.tagRow}>
            {!!deliverable.version && (
              <>
                <View style={s.versionTag}>
                  <Text style={s.versionText}>{deliverable.version}</Text>
                </View>
                <Text style={s.dot}>·</Text>
              </>
            )}
            <View style={[s.statusTag, { backgroundColor: statusStyle.bg }]}>
              <Text style={[s.statusText, { color: statusStyle.color }]}>
                {STATUS_LABELS[status] || status}
              </Text>
            </View>
          </View>
          <Text style={s.title}>{deliverable.title || 'Untitled delivery'}</Text>
          {!!deliverable.summary && <Text style={s.summary}>{deliverable.summary}</Text>}
        </View>

        {/* What's Included */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>What's Included</Text>
          {(deliverable.blocks || []).map((block, i) => (
            <View key={block.block_id || i} style={s.blockCard}>
              <View style={s.blockIconWrap}>
                <Ionicons name={blockIcon(block.block_type)} size={18} color={T.textMuted} />
              </View>
              <View style={s.blockBody}>
                <View style={s.blockHeader}>
                  <Text style={s.blockTitle}>{block.title || 'Untitled item'}</Text>
                  <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
                </View>
                {!!block.description && (
                  <Text style={s.blockDescription}>{block.description}</Text>
                )}
                {(block.preview_url || block.api_url) && (
                  <View style={s.linkRow}>
                    {!!block.preview_url && (
                      <TouchableOpacity onPress={() => Linking.openURL(block.preview_url!)} style={s.linkBtn}>
                        <Ionicons name="open-outline" size={12} color={T.primary} />
                        <Text style={s.linkText}>Preview</Text>
                      </TouchableOpacity>
                    )}
                    {!!block.api_url && (
                      <TouchableOpacity onPress={() => Linking.openURL(block.api_url!)} style={s.linkBtn}>
                        <Ionicons name="code-slash" size={12} color={T.primary} />
                        <Text style={s.linkText}>API Docs</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            </View>
          ))}
          {(!deliverable.blocks || deliverable.blocks.length === 0) && (
            <Text style={s.emptyInline} testID="deliverable-blocks-empty">
              No items in this delivery yet.
            </Text>
          )}
        </View>

        {/* Resources */}
        {!!deliverable.resources && deliverable.resources.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Resources</Text>
            {deliverable.resources.map((res, i) => (
              <TouchableOpacity
                key={res.resource_id || i}
                style={s.resourceCard}
                onPress={() => res.url && Linking.openURL(res.url)}
              >
                <View style={s.resourceLeft}>
                  <Ionicons name="open-outline" size={16} color={T.textMuted} />
                  <View>
                    <Text style={s.resourceTitle}>{res.title || 'Resource'}</Text>
                    {!!res.resource_type && (
                      <Text style={s.resourceType}>{res.resource_type}</Text>
                    )}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color={T.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* What Happens Next — static UX copy */}
        <View style={s.nextBlock}>
          <View style={s.nextHeader}>
            <Ionicons name="arrow-forward" size={16} color={T.primary} />
            <Text style={s.nextHeaderText}>What Happens Next</Text>
          </View>
          <View style={s.nextItem}>
            <View style={[s.nextDot, { backgroundColor: 'rgba(34, 197, 94, 0.1)' }]}>
              <Ionicons name="checkmark" size={14} color="#22c55e" />
            </View>
            <View style={s.nextItemBody}>
              <Text style={[s.nextItemTitle, { color: '#22c55e' }]}>If you approve</Text>
              <Text style={s.nextItemDesc}>
                Development continues to the next phase. You'll receive the next delivery once ready.
              </Text>
            </View>
          </View>
          <View style={s.nextItem}>
            <View style={[s.nextDot, { backgroundColor: 'rgba(245, 158, 11, 0.1)' }]}>
              <Ionicons name="refresh" size={14} color="#f59e0b" />
            </View>
            <View style={s.nextItemBody}>
              <Text style={[s.nextItemTitle, { color: '#f59e0b' }]}>If you request changes</Text>
              <Text style={s.nextItemDesc}>
                Our team will review your feedback and fix the issues. You'll receive an updated delivery.
              </Text>
            </View>
          </View>
        </View>

        {/* Actions — visibility driven by backend status only */}
        {isPendingApproval && (
          <View style={s.actionsBlock} testID="deliverable-actions">
            <Text style={s.actionsTitle}>Your Decision</Text>
            <View style={s.actionsRow}>
              <TouchableOpacity
                onPress={() => setShowApproveModal(true)}
                style={[s.actionBtn, s.actionBtnPrimary]}
                testID="approve-btn"
              >
                <Ionicons name="checkmark-circle" size={18} color="#062e10" />
                <Text style={s.actionBtnPrimaryText}>Approve</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowRejectModal(true)}
                style={[s.actionBtn, s.actionBtnGhost]}
                testID="request-changes-btn"
              >
                <Ionicons name="chatbubble" size={18} color={T.text} />
                <Text style={s.actionBtnGhostText}>Request changes</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Inline action error */}
        {!!actionError && (
          <View style={s.actionError} testID="deliverable-action-error">
            <Ionicons name="alert-circle" size={18} color={T.danger} />
            <View style={{ flex: 1 }}>
              <Text style={s.actionErrorTitle}>Action failed</Text>
              <Text style={s.actionErrorBody}>{actionError}</Text>
            </View>
            <TouchableOpacity onPress={() => setActionError(null)}>
              <Text style={s.actionErrorDismiss}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Approve Modal */}
      <Modal visible={showApproveModal} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <View style={[s.modalIconWrap, { backgroundColor: 'rgba(34, 197, 94, 0.1)' }]}>
                <Ionicons name="checkmark-circle" size={24} color="#22c55e" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.modalTitle}>Approve Delivery?</Text>
                <Text style={s.modalSubtitle}>This will move the project to the next phase</Text>
              </View>
            </View>
            <View style={s.modalActions}>
              <TouchableOpacity
                onPress={() => setShowApproveModal(false)}
                style={[s.modalBtn, s.modalBtnGhost]}
                testID="approve-cancel"
              >
                <Text style={s.modalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleApprove}
                disabled={actionLoading}
                style={[s.modalBtn, s.modalBtnPrimary, actionLoading && { opacity: 0.6 }]}
                testID="approve-confirm"
              >
                {actionLoading ? (
                  <ActivityIndicator size="small" color="#062e10" />
                ) : (
                  <Ionicons name="checkmark" size={16} color="#062e10" />
                )}
                <Text style={s.modalBtnPrimaryText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Reject Modal */}
      <Modal visible={showRejectModal} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={s.modalOverlay}
        >
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <View style={[s.modalIconWrap, { backgroundColor: 'rgba(245, 158, 11, 0.1)' }]}>
                <Ionicons name="chatbubble" size={24} color="#f59e0b" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.modalTitle}>Request Changes</Text>
                <Text style={s.modalSubtitle}>Tell us what needs to be fixed</Text>
              </View>
            </View>
            <View style={s.modalBody}>
              <Text style={s.modalLabel}>What needs to be changed? <Text style={{ color: T.danger }}>*</Text></Text>
              <TextInput
                value={rejectReason}
                onChangeText={setRejectReason}
                placeholder="Please describe the issues or changes you'd like us to make..."
                placeholderTextColor={T.textMuted}
                multiline
                numberOfLines={5}
                style={s.textArea}
                testID="reject-reason-input"
              />
              <Text style={s.modalHint}>
                Be specific so our team can address your concerns effectively.
              </Text>
            </View>
            <View style={s.modalActions}>
              <TouchableOpacity
                onPress={() => { setShowRejectModal(false); setRejectReason(''); }}
                style={[s.modalBtn, s.modalBtnGhost]}
                testID="reject-cancel"
              >
                <Text style={s.modalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleReject}
                disabled={!rejectReason.trim() || actionLoading}
                style={[s.modalBtn, s.modalBtnWarning, (!rejectReason.trim() || actionLoading) && { opacity: 0.5 }]}
                testID="submit-changes-btn"
              >
                {actionLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="send" size={16} color="#fff" />
                )}
                <Text style={s.modalBtnWarningText}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg },
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  errorTitle: { color: T.danger, fontWeight: '600', fontSize: 16, marginTop: 8 },
  errorBody: { color: T.textMuted, fontSize: 13, textAlign: 'center', marginBottom: 8 },
  retryBtn: { paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderColor: T.border, borderRadius: 12 },
  retryBtnText: { color: T.text, fontSize: 13, fontWeight: '500' },
  emptyText: { color: T.textMuted, fontSize: 14, marginTop: 8 },

  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 16 },
  backText: { color: T.textMuted, fontSize: 14 },

  banner: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16, flexDirection: 'row', gap: 12 },
  bannerText: { flex: 1 },
  bannerTitle: { fontSize: 16, fontWeight: '600' },
  bannerBody: { fontSize: 13, marginTop: 2 },
  feedbackBox: { marginTop: 12, padding: 12, backgroundColor: T.surface, borderRadius: 10 },
  feedbackText: { fontSize: 13, color: T.textMuted },

  titleBlock: { marginBottom: 20 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  versionTag: { paddingHorizontal: 8, paddingVertical: 4, backgroundColor: T.surface, borderRadius: 6 },
  versionText: { color: T.textMuted, fontSize: 12 },
  dot: { color: T.textMuted },
  statusTag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusText: { fontSize: 12, fontWeight: '500' },
  title: { color: T.text, fontSize: 24, fontWeight: '700', marginBottom: 6 },
  summary: { color: T.textMuted, fontSize: 15, lineHeight: 22 },

  section: { marginBottom: 20 },
  sectionTitle: { color: T.text, fontSize: 18, fontWeight: '600', marginBottom: 12 },

  blockCard: { flexDirection: 'row', gap: 12, padding: 14, borderWidth: 1, borderColor: T.border, borderRadius: 12, marginBottom: 10 },
  blockIconWrap: { width: 36, height: 36, borderRadius: 8, backgroundColor: T.surface, alignItems: 'center', justifyContent: 'center' },
  blockBody: { flex: 1 },
  blockHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  blockTitle: { color: T.text, fontSize: 14, fontWeight: '500', flex: 1 },
  blockDescription: { color: T.textMuted, fontSize: 13, marginTop: 4, lineHeight: 18 },
  linkRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  linkText: { color: T.primary, fontSize: 12 },
  emptyInline: { color: T.textMuted, fontSize: 13, fontStyle: 'italic' },

  resourceCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderWidth: 1, borderColor: T.border, borderRadius: 12, marginBottom: 10 },
  resourceLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  resourceTitle: { color: T.text, fontSize: 14, fontWeight: '500' },
  resourceType: { color: T.textMuted, fontSize: 11, textTransform: 'capitalize' },

  nextBlock: { borderWidth: 1, borderColor: T.border, borderRadius: 16, marginBottom: 20, overflow: 'hidden' },
  nextHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderBottomWidth: 1, borderColor: T.border, backgroundColor: T.surface },
  nextHeaderText: { color: T.text, fontWeight: '600' },
  nextItem: { flexDirection: 'row', gap: 12, padding: 14 },
  nextDot: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  nextItemBody: { flex: 1 },
  nextItemTitle: { fontSize: 14, fontWeight: '500' },
  nextItemDesc: { color: T.textMuted, fontSize: 13, marginTop: 4, lineHeight: 18 },

  actionsBlock: { borderWidth: 1, borderColor: T.border, borderRadius: 16, padding: 16, backgroundColor: T.surface, marginBottom: 12 },
  actionsTitle: { color: T.text, fontWeight: '600', fontSize: 15, marginBottom: 12 },
  actionsRow: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 12 },
  actionBtnPrimary: { backgroundColor: '#22c55e' },
  actionBtnPrimaryText: { color: '#062e10', fontWeight: '600' },
  actionBtnGhost: { borderWidth: 1, borderColor: T.border },
  actionBtnGhostText: { color: T.text, fontWeight: '500' },

  actionError: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.3)', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: 12, marginBottom: 12 },
  actionErrorTitle: { color: T.danger, fontWeight: '500', fontSize: 13 },
  actionErrorBody: { color: T.danger, fontSize: 13, opacity: 0.8, marginTop: 2 },
  actionErrorDismiss: { color: T.danger, fontSize: 13, opacity: 0.7 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalCard: { width: '100%', maxWidth: 480, backgroundColor: T.bg, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: T.border },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20, borderBottomWidth: 1, borderColor: T.border },
  modalIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { color: T.text, fontWeight: '600', fontSize: 16 },
  modalSubtitle: { color: T.textMuted, fontSize: 13, marginTop: 2 },
  modalBody: { padding: 20 },
  modalLabel: { color: T.text, fontSize: 14, fontWeight: '500', marginBottom: 8 },
  textArea: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 12, padding: 12, color: T.text, fontSize: 14, minHeight: 120, textAlignVertical: 'top' },
  modalHint: { color: T.textMuted, fontSize: 12, marginTop: 8 },
  modalActions: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1, borderColor: T.border, backgroundColor: T.surface },
  modalBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12 },
  modalBtnGhost: { borderWidth: 1, borderColor: T.border },
  modalBtnGhostText: { color: T.textMuted, fontWeight: '500' },
  modalBtnPrimary: { backgroundColor: '#22c55e' },
  modalBtnPrimaryText: { color: '#062e10', fontWeight: '600' },
  modalBtnWarning: { backgroundColor: '#f59e0b' },
  modalBtnWarningText: { color: '#fff', fontWeight: '600' },
});
