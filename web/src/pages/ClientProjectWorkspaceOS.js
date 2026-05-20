import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import HvlStatusBlock from '@/components/HvlStatusBlock';
import {
  ArrowLeft,
  Package,
  Clock,
  CheckCircle2,
  AlertCircle,
  User,
  FileText,
  ThumbsUp,
  ThumbsDown,
  ExternalLink
} from 'lucide-react';

const ClientProjectWorkspaceOS = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);

  const fetchWorkspace = async () => {
    try {
      const res = await runtime.get(`/api/client/projects/${projectId}/workspace`);
      setWorkspace(res.data);
    } catch (error) {
      console.error('Error fetching workspace:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkspace();
  }, [projectId]);

  const handleApprove = async (moduleId, moduleName, price) => {
    if (!confirm(`Approve "${moduleName}"?\n\n✅ Module will be closed\n💰 Invoice $${price} will be created`)) {
      return;
    }
    
    setActionLoading(moduleId);
    try {
      await runtime.post(`/api/client/modules/${moduleId}/approve`, {});
      alert(`✅ Approved!\n\n💰 Invoice created: $${price}\n📦 Module closed`);
      await fetchWorkspace();
    } catch (error) {
      console.error('Error approving module:', error);
      alert('Failed to approve module');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (moduleId, moduleName) => {
    const feedback = prompt(`Request changes for "${moduleName}":\n\n⚠️ This will:\n• Return module to developer\n• Delay project delivery\n\nEnter your feedback:`);
    if (!feedback) return;

    setActionLoading(moduleId);
    try {
      await runtime.post(`/api/client/modules/${moduleId}/request-changes`,
        { feedback });
      alert(`✅ Revision requested\n\n👨‍💻 Developer notified\n⏱️ Delivery delayed`);
      await fetchWorkspace();
    } catch (error) {
      console.error('Error rejecting module:', error);
      alert('Failed to request changes');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="workspace-loading">
        <div className="w-8 h-8 border-2 border-border border-t-signal rounded-full animate-spin" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="workspace-error">
        <div className="text-muted-foreground">Project not found</div>
      </div>
    );
  }

  const { project, modules = [], timeline = [], deliverables = [] } = workspace;

  const getStatusColor = (status) => {
    const colors = {
      pending: 'bg-gray-500/20 text-gray-400',
      active: 'bg-signal/15 text-signal',
      submitted: 'bg-signal/10 text-signal',
      qa_done: 'bg-green-500/20 text-green-400',
      done: 'bg-green-600/20 text-green-500',
      revision: 'bg-yellow-500/20 text-yellow-400'
    };
    return colors[status] || colors.pending;
  };

  return (
    <div className="min-h-screen p-6 lg:p-8" data-testid="client-project-workspace-os">
      {/* Back button */}
      <button
        onClick={() => navigate('/client/dashboard-os')}
        className="flex items-center gap-2 text-muted-foreground hover:text-white mb-6 transition-colors"
        data-testid="back-btn"
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="text-sm">Back to Dashboard</span>
      </button>

      {/* Project Header */}
      <div className="border border-border rounded-lg p-6 mb-6" data-testid="project-header">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold text-white mb-2">{project.name}</h1>
            <div className="flex items-center gap-3 text-sm">
              <span className={`px-2 py-1 rounded text-xs ${getStatusColor(project.status)}`}>
                {project.status}
              </span>
              {project.last_activity && (
                <span className="text-muted-foreground text-xs">
                  Last activity: {new Date(project.last_activity).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Progress */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Overall Progress</span>
            <span className="text-sm text-muted-foreground font-medium">{project.progress}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-signal transition-all"
              style={{ width: `${project.progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Human Validation Layer — shows tier + live session status */}
      <HvlStatusBlock projectId={projectId} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Modules & Deliverables */}
        <div className="lg:col-span-2 space-y-6">
          {/* Modules */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Package className="w-5 h-5 text-signal" />
              <h2 className="text-lg font-semibold text-white">Modules</h2>
            </div>

            <div className="space-y-3" data-testid="modules-list">
              {modules.map((module) => (
                <div
                  key={module.module_id}
                  className="border border-border rounded-lg p-4"
                  data-testid={`module-${module.module_id}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="text-white font-medium mb-1">{module.name}</div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded text-xs ${getStatusColor(module.status)}`}>
                          {module.status}
                        </span>
                        {module.assigned_dev && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <User className="w-3 h-3" />
                            {module.assigned_dev.name}
                          </div>
                        )}
                        {module.eta_days !== null && module.eta_days !== undefined && (
                          <div className="flex items-center gap-1 text-xs text-signal">
                            <Clock className="w-3 h-3" />
                            ETA: {module.eta_days}d
                          </div>
                        )}
                        {module.delay_days > 0 && (
                          <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">
                            ⚠️ +{module.delay_days}d delay
                          </span>
                        )}
                      </div>
                      
                      {/* Currently Working */}
                      {module.currently_working && module.currently_working.status === 'active' && (
                        <div className="mt-2 text-xs text-green-400 flex items-center gap-1.5">
                          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                          Currently: {module.currently_working.activity}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Progress */}
                  <div className="mb-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">Progress</span>
                      <span className="text-xs text-muted-foreground">{module.progress}%</span>
                    </div>
                    <div className="h-1 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-signal transition-all"
                        style={{ width: `${module.progress}%` }}
                      />
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    {module.done_tasks}/{module.total_tasks} tasks completed
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Deliverables */}
          {deliverables.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <FileText className="w-5 h-5 text-green-400" />
                <h2 className="text-lg font-semibold text-white">Pending Approvals</h2>
                <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
                  {deliverables.length}
                </span>
              </div>

              <div className="space-y-3" data-testid="deliverables-list">
                {deliverables.map((deliverable) => (
                  <div
                    key={deliverable.module_id}
                    className="border border-green-500/30 bg-green-500/5 rounded-lg p-4"
                    data-testid={`deliverable-${deliverable.module_id}`}
                  >
                    <div className="mb-3">
                      <div className="text-white font-medium mb-1">{deliverable.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Submitted {new Date(deliverable.submitted_at).toLocaleDateString()}
                      </div>
                    </div>

                    {deliverable.preview_url !== '#' && (
                      <a
                        href={deliverable.preview_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-signal hover:text-signal/80 text-sm mb-3 transition-colors"
                      >
                        <ExternalLink className="w-4 h-4" />
                        Preview
                      </a>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApprove(deliverable.module_id, deliverable.name, deliverable.price || 0)}
                        disabled={actionLoading === deliverable.module_id}
                        className="flex-1 flex items-center justify-center gap-2 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-400 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
                        data-testid={`approve-btn-${deliverable.module_id}`}
                        title="Approve & Generate Invoice"
                      >
                        <ThumbsUp className="w-4 h-4" />
                        Approve & Invoice
                      </button>
                      <button
                        onClick={() => handleReject(deliverable.module_id, deliverable.name)}
                        disabled={actionLoading === deliverable.module_id}
                        className="flex-1 flex items-center justify-center gap-2 bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/30 text-yellow-400 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
                        data-testid={`reject-btn-${deliverable.module_id}`}
                        title="Request Fix (delays project)"
                      >
                        <ThumbsDown className="w-4 h-4" />
                        Request Fix
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Timeline */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-signal" />
            <h2 className="text-lg font-semibold text-white">Timeline</h2>
          </div>

          <div className="border border-border rounded-lg p-4" data-testid="timeline">
            {timeline.length === 0 ? (
              <div className="text-muted-foreground text-sm text-center py-8">No activity yet</div>
            ) : (
              <div className="space-y-4">
                {timeline.map((event, idx) => (
                  <div key={idx} className="flex gap-3" data-testid={`timeline-event-${idx}`}>
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-2 h-2 rounded-full ${
                          event.type === 'qa'
                            ? 'bg-signal'
                            : event.type === 'submission'
                            ? 'bg-green-400'
                            : 'bg-muted'
                        }`}
                      />
                      {idx < timeline.length - 1 && (
                        <div className="w-px h-full bg-muted mt-2" />
                      )}
                    </div>
                    <div className="flex-1 pb-4">
                      <div className="text-white text-sm mb-1">{event.text}</div>
                      <div className="text-muted-foreground text-xs">
                        {new Date(event.timestamp).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClientProjectWorkspaceOS;
