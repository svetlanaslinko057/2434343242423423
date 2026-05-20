import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import {
  ArrowLeft,
  Package,
  Check,
  ExternalLink,
  Code,
  FileText,
  Layers,
  Link as LinkIcon,
  MessageSquare,
  CheckCircle2,
  Clock,
  Loader2,
  ChevronRight,
  AlertCircle,
  ArrowRight,
  RefreshCw,
  HelpCircle
} from 'lucide-react';

/**
 * ClientDeliverablePage — slice #1 governed rewrite.
 *
 * Authority model (frozen — see /app/audit/SUBSTRATE_CONTRACT.md):
 *   - Canonical endpoint family: /api/client/deliverables/*
 *   - Canonical status enum:     pending_approval → approved | rejected
 *     Legacy read-side mapping:   pending → pending_approval,
 *                                 revision_requested → rejected
 *   - POST → refetch (no optimistic mutation, no local status flip).
 *   - No client-side derivation of business state (no synthesized
 *     summary buckets, no role/status-derived `canApprove`).
 *   - Loading / error / empty separated structurally as inline branches.
 */

const STATUS_LABELS = {
  pending_approval: 'pending approval',
  approved: 'approved',
  rejected: 'changes requested',
};

// Read-side normalization: legacy values are mapped to canonical for UI.
// No writes ever produce legacy values (canonical backend enforces).
function normalizeStatus(raw) {
  if (raw === 'pending') return 'pending_approval';
  if (raw === 'revision_requested') return 'rejected';
  return raw;
}

const getBlockIcon = (type) => {
  switch (type) {
    case 'feature': return Layers;
    case 'integration': return LinkIcon;
    case 'api': return Code;
    case 'design': return FileText;
    default: return Layers;
  }
};

const ClientDeliverablePage = () => {
  const { deliverableId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [deliverable, setDeliverable] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);

  const fetchDeliverable = useCallback(async () => {
    setError(null);
    try {
      const res = await runtime.get(`/api/client/deliverables/${deliverableId}`);
      setDeliverable(res.data);
    } catch (e) {
      setError(e?.response?.data?.message || e?.response?.data?.detail || 'Failed to load deliverable.');
    } finally {
      setLoading(false);
    }
  }, [deliverableId]);

  useEffect(() => {
    fetchDeliverable();
  }, [fetchDeliverable]);

  const handleApprove = async () => {
    setActionLoading(true);
    setActionError(null);
    try {
      await runtime.post(`/api/client/deliverables/${deliverableId}/approve`,
        {});
      setShowApproveConfirm(false);
      await fetchDeliverable();
    } catch (e) {
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
      await runtime.post(`/api/client/deliverables/${deliverableId}/reject`,
        { reason: rejectReason });
      setShowRejectModal(false);
      setRejectReason('');
      await fetchDeliverable();
    } catch (e) {
      setActionError(e?.response?.data?.message || e?.response?.data?.detail || 'Failed to request changes.');
    } finally {
      setActionLoading(false);
    }
  };

  // ─── STRUCTURAL STATES — inline, no abstraction ─────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="deliverable-loading">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="deliverable-error">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-danger mx-auto mb-4" />
          <p className="text-danger font-medium mb-2">Couldn't load delivery</p>
          <p className="text-muted-foreground text-sm mb-4">{error}</p>
          <button
            onClick={fetchDeliverable}
            className="px-4 py-2 border border-border rounded-xl text-sm hover:bg-muted"
            data-testid="deliverable-retry"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!deliverable) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="deliverable-empty">
        <div className="text-center">
          <Package className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Deliverable not found</p>
        </div>
      </div>
    );
  }

  const status = normalizeStatus(deliverable.status);
  const isPendingApproval = status === 'pending_approval';
  const isApproved = status === 'approved';
  const isRejected = status === 'rejected';

  return (
    <div className="p-8 max-w-4xl mx-auto" data-testid="client-deliverable-page">
      {/* Breadcrumb */}
      <button
        onClick={() => navigate('/client/dashboard')}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6"
        data-testid="deliverable-back"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Dashboard
      </button>

      {/* Status Banner */}
      {isApproved && (
        <div className="mb-8 border border-success/30 rounded-2xl bg-success/10 p-6 flex items-center gap-4">
          <CheckCircle2 className="w-10 h-10 text-success" />
          <div>
            <h3 className="text-lg font-semibold text-success">Delivery Approved</h3>
            <p className="text-success/70 text-sm">Thank you! Development continues to the next phase.</p>
          </div>
        </div>
      )}

      {isRejected && (
        <div className="mb-8 border border-warning/30 rounded-2xl bg-warning/10 p-6">
          <div className="flex items-center gap-4 mb-3">
            <RefreshCw className="w-8 h-8 text-warning" />
            <div>
              <h3 className="text-lg font-semibold text-warning">Revision In Progress</h3>
              <p className="text-warning/70 text-sm">Our team is working on your requested changes</p>
            </div>
          </div>
          {deliverable.client_feedback && (
            <div className="mt-4 p-4 bg-muted/50 rounded-xl">
              <p className="text-sm text-muted-foreground">Your feedback: {deliverable.client_feedback}</p>
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 text-muted-foreground text-sm mb-3">
          {deliverable.version && (
            <>
              <span className="px-2 py-1 bg-muted rounded-lg">{deliverable.version}</span>
              <span>·</span>
            </>
          )}
          <span className={`px-2 py-1 rounded-lg ${
            isPendingApproval ? 'bg-warning/10 text-warning' :
            isApproved ? 'bg-success/10 text-success' :
            'bg-signal/10 text-signal'
          }`}>
            {STATUS_LABELS[status] || status}
          </span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight mb-3">{deliverable.title}</h1>
        {deliverable.summary && (
          <p className="text-lg text-muted-foreground">{deliverable.summary}</p>
        )}
      </div>

      {/* What's Included — pure backend render */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">What's Included</h2>
        <div className="space-y-4">
          {(deliverable.blocks || []).map((block, index) => {
            const Icon = getBlockIcon(block.block_type);
            return (
              <div
                key={block.block_id || index}
                className="border border-border rounded-xl p-5 hover:border-border transition-all"
              >
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium">{block.title}</h3>
                      <CheckCircle2 className="w-4 h-4 text-success" />
                    </div>
                    {block.description && (
                      <p className="text-muted-foreground text-sm mt-1">{block.description}</p>
                    )}
                    {(block.preview_url || block.api_url) && (
                      <div className="flex items-center gap-3 mt-3">
                        {block.preview_url && (
                          <a
                            href={block.preview_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-signal hover:text-signal"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Preview
                          </a>
                        )}
                        {block.api_url && (
                          <a
                            href={block.api_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-signal hover:text-signal"
                          >
                            <Code className="w-3 h-3" />
                            API Docs
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {(!deliverable.blocks || deliverable.blocks.length === 0) && (
            <p className="text-muted-foreground text-sm" data-testid="deliverable-blocks-empty">
              No items in this delivery yet.
            </p>
          )}
        </div>
      </div>

      {/* Resources */}
      {deliverable.resources && deliverable.resources.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4">Resources</h2>
          <div className="grid grid-cols-2 gap-4">
            {deliverable.resources.map((res, index) => (
              <a
                key={res.resource_id || index}
                href={res.url}
                target="_blank"
                rel="noopener noreferrer"
                className="border border-border rounded-xl p-4 hover:border-border hover:bg-muted/30 transition-all group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-muted-foreground" />
                    <div>
                      <h4 className="font-medium text-sm">{res.title}</h4>
                      {res.resource_type && (
                        <p className="text-xs text-muted-foreground capitalize">{res.resource_type}</p>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-muted-foreground" />
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* What Happens Next — static UX copy, not state-derived */}
      <div className="mb-8 border border-border rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-border bg-muted/30">
          <h2 className="font-semibold flex items-center gap-2">
            <ArrowRight className="w-4 h-4 text-signal" />
            What Happens Next
          </h2>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-start gap-4">
            <div className="w-8 h-8 bg-success/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <Check className="w-4 h-4 text-success" />
            </div>
            <div>
              <h4 className="font-medium text-success">If you approve</h4>
              <p className="text-muted-foreground text-sm mt-1">
                Development continues to the next phase. You'll receive the next delivery once ready.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="w-8 h-8 bg-warning/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <RefreshCw className="w-4 h-4 text-warning" />
            </div>
            <div>
              <h4 className="font-medium text-warning">If you request changes</h4>
              <p className="text-muted-foreground text-sm mt-1">
                Our team will review your feedback and fix the issues. You'll receive an updated delivery.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons — backend status drives visibility, no role gating on UI */}
      {isPendingApproval && (
        <div className="border border-border rounded-2xl p-6 bg-muted/30" data-testid="deliverable-actions">
          <h3 className="font-semibold mb-4">Your Decision</h3>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowApproveConfirm(true)}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-4 bg-success text-success-ink font-semibold rounded-xl hover:bg-success/90 transition-colors"
              data-testid="approve-btn"
            >
              <CheckCircle2 className="w-5 h-5" />
              Approve Delivery
            </button>
            <button
              onClick={() => setShowRejectModal(true)}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-4 border border-border text-foreground font-medium rounded-xl hover:bg-muted transition-colors"
              data-testid="request-changes-btn"
            >
              <MessageSquare className="w-5 h-5" />
              Request Changes
            </button>
          </div>
          <p className="text-center text-muted-foreground text-sm mt-4">
            <HelpCircle className="w-3 h-3 inline mr-1" />
            Need help deciding? Contact our team through support.
          </p>
        </div>
      )}

      {/* Inline action error — structural render branch */}
      {actionError && (
        <div
          className="mt-4 border border-danger/30 rounded-xl bg-danger/10 p-4 flex items-start gap-3"
          data-testid="deliverable-action-error"
        >
          <AlertCircle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-danger font-medium">Action failed</p>
            <p className="text-sm text-danger/80">{actionError}</p>
          </div>
          <button
            onClick={() => setActionError(null)}
            className="text-danger/70 hover:text-danger text-sm"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Approve Confirmation Modal */}
      {showApproveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="w-full max-w-md mx-4 bg-card border border-border rounded-2xl p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-success/10 rounded-xl flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-success" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Approve Delivery?</h3>
                <p className="text-muted-foreground text-sm">This will move the project to the next phase</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowApproveConfirm(false)}
                className="flex-1 px-4 py-3 border border-border rounded-xl text-muted-foreground hover:bg-muted"
                data-testid="approve-cancel"
              >
                Cancel
              </button>
              <button
                onClick={handleApprove}
                disabled={actionLoading}
                className="flex-1 px-4 py-3 bg-success text-success-ink font-semibold rounded-xl hover:bg-success/90 disabled:opacity-50 flex items-center justify-center gap-2"
                data-testid="approve-confirm"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Confirm Approval
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="w-full max-w-lg mx-4 bg-card border border-border rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-border">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-warning/10 rounded-xl flex items-center justify-center">
                  <MessageSquare className="w-6 h-6 text-warning" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">Request Changes</h3>
                  <p className="text-muted-foreground text-sm">Tell us what needs to be fixed</p>
                </div>
              </div>
            </div>

            <div className="p-6">
              <label className="block text-sm font-medium mb-2">
                What needs to be changed? <span className="text-danger">*</span>
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Please describe the issues or changes you'd like us to make..."
                rows={5}
                className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-border resize-none"
                data-testid="reject-reason-input"
              />
              <p className="text-muted-foreground text-xs mt-2">
                Be specific so our team can address your concerns effectively.
              </p>
            </div>

            <div className="p-6 border-t border-border bg-muted/30 flex gap-3">
              <button
                onClick={() => {
                  setShowRejectModal(false);
                  setRejectReason('');
                }}
                className="flex-1 px-4 py-3 border border-border rounded-xl text-muted-foreground hover:bg-muted"
                data-testid="reject-cancel"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={!rejectReason.trim() || actionLoading}
                className="flex-1 px-4 py-3 bg-warning text-warning-ink font-semibold rounded-xl hover:bg-warning/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                data-testid="submit-changes-btn"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                Submit Feedback
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientDeliverablePage;
