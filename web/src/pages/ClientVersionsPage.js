/**
 * ClientVersionsPage — slice #2 (ClientVersions) web surface.
 *
 * Authority model (frozen by slice #1, extended for chronology audit in slice #2):
 *   - Endpoint family for this surface: /api/projects/{id}/versions
 *     Registered as "canonical-within-mixed" per registry §1.3, D-1B in slice #2 audit.
 *     Full family migration deferred to slice #3 (ClientCabinet).
 *   - Status enum is the same canonical ladder as slice #1:
 *       pending_approval -> approved | rejected
 *     Legacy read-side mapping (mirrors slice #1, NOT extracted):
 *       pending             -> pending_approval
 *       revision_requested  -> rejected
 *   - Chronology authority: backend (`.sort("created_at", -1)` at server.py:6415).
 *     Implicit-coupling debt BD-12 tolerated because:
 *       backend ordering is stable,
 *       single-consumer,
 *       read-only,
 *       non-interactive chronology.
 *     If any of those conditions change (new consumer, mutation, pagination,
 *     pinning/reordering), promote I-11 candidacy in matrix §10.2.
 *   - Read-only surface: zero mutations -> no optimistic-mutation risk.
 *   - Project name reached via singular /api/projects/{id} (V-7 fix):
 *     do NOT consume the project list contract to synthesize a singular authority.
 *   - Loading / error / empty separated structurally (no error -> empty collapse).
 *   - No `.sort` / `.reverse` / `.filter` / `.reduce` / `useMemo` in page scope.
 *   - No "latest / current / active" derivation client-side.
 *   - No synthetic version labels.
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import {
  ArrowLeft,
  Package,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  ChevronRight,
  GitBranch
} from 'lucide-react';

// Inline, surface-owned, non-exported normalization.
// Same pattern as slice #1 ClientDeliverablePage. Do NOT extract a shared
// helper: that would implicitly declare status semantics globally stable,
// which doctrine has not frozen yet.
function normalizeStatus(raw) {
  if (raw === 'pending') return 'pending_approval';
  if (raw === 'revision_requested') return 'rejected';
  return raw;
}

const STATUS_LABEL = {
  pending_approval: 'pending approval',
  approved: 'approved',
  rejected: 'changes requested',
};

const ClientVersionsPage = () => {
  const { projectId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [versions, setVersions] = useState([]);
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    if (!projectId) return;
    setError(null);
    try {
      // Two independent backend contracts composed in parallel (I-09).
      // Singular project endpoint, NOT the list — see V-7 (authority-overreach
      // via convenience fetch shape).
      const [versionsRes, projectRes] = await Promise.all([
        runtime.get(`/api/projects/${projectId}/versions`),
        runtime.get(`/api/projects/${projectId}`),
      ]);
      setVersions(versionsRes.data || []);
      setProject(projectRes.data || null);
    } catch (e) {
      setError(
        e?.response?.data?.message ||
        e?.response?.data?.detail ||
        'Could not load version history.'
      );
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── STRUCTURAL STATES ──────────────────────────────────────────────

  if (loading) {
    return (
      <div
        className="min-h-screen bg-[var(--t-bg)] text-white flex items-center justify-center"
        data-testid="versions-loading"
      >
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="min-h-screen bg-[var(--t-bg)] text-white flex flex-col items-center justify-center px-6"
        data-testid="versions-error"
      >
        <AlertCircle className="w-12 h-12 text-red-400 mb-3" />
        <h3 className="text-lg font-semibold mb-1">Couldn't load version history</h3>
        <p className="text-muted-foreground text-sm text-center mb-4">{error}</p>
        <button
          onClick={fetchData}
          className="px-4 py-2 border border-border rounded-xl hover:bg-white/[0.04] transition-colors"
          data-testid="versions-retry"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--t-bg)] text-white" data-testid="versions-page">
      <header className="border-b border-border bg-black/60 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <button
            onClick={() => navigate('/client/dashboard')}
            className="flex items-center gap-2 text-muted-foreground hover:text-white transition-colors"
            data-testid="versions-back"
          >
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </button>
          <div className="flex items-center gap-3">
            <GitBranch className="w-5 h-5 text-signal" />
            <span className="font-semibold">Version History</span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">{project?.name || 'Project'}</h1>
          <p className="text-muted-foreground mt-2">All delivered versions of your product</p>
        </div>

        {versions.length === 0 ? (
          <div
            className="border border-border border-dashed rounded-2xl p-12 text-center"
            data-testid="versions-empty"
          >
            <Package className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No deliveries yet</h3>
            <p className="text-muted-foreground text-sm">
              Versions will appear here as they are delivered
            </p>
          </div>
        ) : (
          <div className="relative">
            {/* Vertical rail; UI reflects the backend-supplied order top -> bottom.
                Frontend does NOT re-order. */}
            <div className="absolute left-6 top-0 bottom-0 w-px bg-muted" />
            <div className="space-y-6">
              {versions.map((version) => {
                const status = normalizeStatus(version.status);
                const isApproved = status === 'approved';
                const isPendingApproval = status === 'pending_approval';
                const isRejected = status === 'rejected';

                const dotColor =
                  isApproved ? 'bg-emerald-400'
                  : isPendingApproval ? 'bg-amber-400'
                  : isRejected ? 'bg-blue-400'
                  : 'bg-muted';

                const badgeClass =
                  isApproved ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : isPendingApproval ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  : isRejected ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                  : 'bg-muted text-muted-foreground border-border';

                const StatusIcon =
                  isApproved ? CheckCircle2
                  : isPendingApproval ? Clock
                  : isRejected ? AlertCircle
                  : Clock;

                const iconColorClass =
                  isApproved ? 'text-emerald-400'
                  : isPendingApproval ? 'text-amber-400'
                  : isRejected ? 'text-blue-400'
                  : 'text-muted-foreground';

                return (
                  <div key={version.deliverable_id} className="relative pl-16">
                    <div className="absolute left-4 top-6 w-5 h-5 rounded-full bg-[var(--t-bg)] border-2 border-border flex items-center justify-center">
                      <div className={`w-2 h-2 rounded-full ${dotColor}`} />
                    </div>

                    <button
                      onClick={() => navigate(`/client/deliverable/${version.deliverable_id}`)}
                      className="w-full text-left border border-border rounded-2xl p-6 hover:bg-white/[0.02] transition-all group"
                      data-testid={`version-card-${version.deliverable_id}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-4">
                          <StatusIcon className={`w-5 h-5 ${iconColorClass}`} />
                          <div>
                            <div className="flex items-center gap-3 mb-1">
                              <h3 className="text-lg font-semibold">{version.version}</h3>
                              <span className={`px-2 py-0.5 text-xs rounded-lg border ${badgeClass}`}>
                                {STATUS_LABEL[status] || status}
                              </span>
                            </div>
                            <p className="text-muted-foreground">{version.title}</p>
                            <div className="flex items-center gap-4 mt-2 text-muted-foreground text-sm">
                              <span>{version.blocks_count} features</span>
                              <span>•</span>
                              <span>
                                {version.created_at
                                  ? new Date(version.created_at).toLocaleDateString()
                                  : '—'}
                              </span>
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-muted-foreground" />
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default ClientVersionsPage;
