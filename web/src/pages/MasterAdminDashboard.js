import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import { AdminRealtimeBridge } from '@/components/RealtimeBridge';
import AutoPricingPanel from '@/components/AutoPricingPanel';
import axios from 'axios';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  Eye,
  FileText,
  Inbox,
  Loader2,
  LogOut,
  MessageSquare,
  Play,
  RefreshCw,
  Send,
  Settings,
  Shield,
  Sparkles,
  User,
  Users,
  X,
  Zap
} from 'lucide-react';

const MasterAdminDashboard = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  
  const [pipeline, setPipeline] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [proposalModal, setProposalModal] = useState(false);

  const fetchData = async () => {
    try {
      const res = await axios.get(`${API}/admin/master/pipeline`, { withCredentials: true });
      setPipeline(res.data.pipeline);
      setStats(res.data.stats);
    } catch (error) {
      console.error('Error fetching pipeline:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, []);

  const handleStartReview = async (requestId) => {
    try {
      await axios.post(`${API}/admin/master/request/${requestId}/start-review`, {}, { withCredentials: true });
      fetchData();
    } catch (error) {
      console.error('Error starting review:', error);
    }
  };

  const handleOpenProposal = async (requestId) => {
    try {
      const res = await axios.get(`${API}/admin/master/request/${requestId}`, { withCredentials: true });
      setSelectedRequest(res.data);
      setProposalModal(true);
    } catch (error) {
      console.error('Error fetching request:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--t-bg)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--t-bg)] text-foreground" data-testid="master-admin-dashboard">
      {user?.user_id && (
        <AdminRealtimeBridge userId={user.user_id} onRefresh={handleRefresh} />
      )}
      
      {/* Header */}
      <header className="border-b border-border bg-[var(--t-bg)] sticky top-0 z-50">
        <div className="px-6 h-16 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Master Admin</h1>
            <p className="text-xs text-muted-foreground">Command Center</p>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={handleRefresh}
              className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              data-testid="refresh-btn"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="px-6 py-8 space-y-8">
        {/* Stats Overview */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="stats-overview">
          <StatCard 
            title="New Ideas" 
            value={stats?.idea_submitted || 0} 
            icon={Sparkles}
            color="blue"
          />
          <StatCard 
            title="In Review" 
            value={stats?.reviewing || 0} 
            icon={Eye}
            color="amber"
          />
          <StatCard 
            title="Proposals Ready" 
            value={stats?.proposal_ready || 0} 
            icon={FileText}
            color="violet"
          />
          <StatCard 
            title="Active Projects" 
            value={stats?.active || 0} 
            icon={Zap}
            color="emerald"
          />
        </section>

        {/* Pipeline Kanban */}
        <section data-testid="pipeline-kanban">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold">Request Pipeline</h2>
            <span className="text-sm text-muted-foreground">{stats?.total || 0} total requests</span>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
            <PipelineColumn
              title="Idea Submitted"
              icon={Inbox}
              items={pipeline?.idea_submitted || []}
              color="blue"
              onAction={(id) => handleStartReview(id)}
              actionLabel="Start Review"
              onView={handleOpenProposal}
            />
            <PipelineColumn
              title="Reviewing"
              icon={Eye}
              items={pipeline?.reviewing || []}
              color="amber"
              onAction={(id) => handleOpenProposal(id)}
              actionLabel="Create Proposal"
              onView={handleOpenProposal}
            />
            <PipelineColumn
              title="Proposal Ready"
              icon={FileText}
              items={pipeline?.proposal_ready || []}
              color="violet"
              onView={handleOpenProposal}
              actionLabel="View"
            />
            <PipelineColumn
              title="Active"
              icon={Zap}
              items={pipeline?.active || []}
              color="emerald"
              onAction={(id) => {
                const item = pipeline?.active?.find(i => i.request_id === id);
                if (item?.project_id) {
                  navigate(`/admin/project/${item.project_id}/scope`);
                }
              }}
              actionLabel="Manage Scope"
              onView={(id) => {
                const item = pipeline?.active?.find(i => i.request_id === id);
                if (item?.project_id) {
                  navigate(`/admin/project/${item.project_id}/scope`);
                }
              }}
            />
          </div>
        </section>

        {/* Quick Actions */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="quick-actions">
          <QuickActionCard
            title="Go to Control Center"
            description="Full pipeline, team health, alerts"
            icon={Activity}
            onClick={() => navigate('/admin/control-center')}
          />
          <QuickActionCard
            title="Manage Team"
            description="Developers, testers, assignments"
            icon={Users}
            onClick={() => navigate('/admin/dashboard')}
          />
          <QuickActionCard
            title="Support Tickets"
            description="Client feedback, issues"
            icon={MessageSquare}
            onClick={() => navigate('/admin/dashboard')}
          />
        </section>
      </main>

      {/* Proposal Modal */}
      {proposalModal && selectedRequest && (
        <ProposalModal
          request={selectedRequest}
          onClose={() => {
            setProposalModal(false);
            setSelectedRequest(null);
          }}
          onRefresh={fetchData}
        />
      )}
    </div>
  );
};


// ============ COMPONENTS ============

const StatCard = ({ title, value, icon: Icon, color }) => {
  const colors = {
    blue: 'border-signal/50 bg-signal/5',
    amber: 'border-warning/50 bg-warning/5',
    violet: 'border-signal/50 bg-signal/5',
    emerald: 'border-success/50 bg-success/5',
  };
  
  const iconColors = {
    blue: 'text-signal',
    amber: 'text-warning',
    violet: 'text-signal',
    emerald: 'text-success',
  };

  return (
    <div className={`rounded-2xl border ${colors[color]} p-5`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted-foreground">{title}</span>
        <Icon className={`w-5 h-5 ${iconColors[color]}`} />
      </div>
      <div className="text-3xl font-semibold">{value}</div>
    </div>
  );
};

const PipelineColumn = ({ title, icon: Icon, items, color, onAction, actionLabel, onView }) => {
  const colors = {
    blue: { border: 'border-signal/30', badge: 'bg-signal/20 text-signal', icon: 'text-signal' },
    amber: { border: 'border-warning/30', badge: 'bg-warning/20 text-warning', icon: 'text-warning' },
    violet: { border: 'border-signal/30', badge: 'bg-signal/20 text-signal', icon: 'text-signal' },
    emerald: { border: 'border-success/30', badge: 'bg-success/20 text-success', icon: 'text-success' },
  };
  
  const style = colors[color];

  return (
    <div className={`rounded-2xl border ${style.border} bg-[var(--t-surface)] p-4 min-h-[400px]`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${style.icon}`} />
          <span className="font-medium">{title}</span>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-xs ${style.badge}`}>
          {items.length}
        </span>
      </div>
      
      <div className="space-y-3">
        {items.slice(0, 5).map((item) => (
          <RequestCard
            key={item.request_id}
            item={item}
            onAction={onAction}
            actionLabel={actionLabel}
            onView={onView}
          />
        ))}
        {items.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-8">No items</div>
        )}
        {items.length > 5 && (
          <button className="w-full py-2 text-sm text-muted-foreground hover:text-foreground">
            +{items.length - 5} more
          </button>
        )}
      </div>
    </div>
  );
};

const RequestCard = ({ item, onAction, actionLabel, onView }) => {
  return (
    <div className="rounded-xl border border-border bg-black/50 p-4 hover:border-border transition-all">
      <div className="font-medium text-sm mb-1 truncate">{item.title}</div>
      <div className="text-xs text-muted-foreground mb-2">{item.client_name}</div>
      <div className="text-xs text-muted-foreground line-clamp-2 mb-3">
        {item.description || item.business_idea}
      </div>
      <div className="flex items-center gap-2">
        {onAction && actionLabel !== 'View' && (
          <button
            onClick={() => onAction(item.request_id)}
            className="flex-1 px-3 py-1.5 bg-white text-black rounded-lg text-xs font-medium hover:bg-muted transition-colors"
            data-testid={`action-${item.request_id}`}
          >
            {actionLabel}
          </button>
        )}
        <button
          onClick={() => onView(item.request_id)}
          className="px-3 py-1.5 border border-border rounded-lg text-xs hover:bg-muted transition-colors"
          data-testid={`view-${item.request_id}`}
        >
          <Eye className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

const QuickActionCard = ({ title, description, icon: Icon, onClick }) => (
  <button
    onClick={onClick}
    className="text-left rounded-2xl border border-border bg-[var(--t-surface)] p-5 hover:border-border hover:bg-surface-raised transition-all group"
    data-testid={`quick-action-${title.toLowerCase().replace(/\s/g, '-')}`}
  >
    <div className="flex items-center gap-3 mb-2">
      <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center group-hover:bg-muted transition-colors">
        <Icon className="w-5 h-5 text-muted-foreground" />
      </div>
      <div className="flex-1">
        <div className="font-medium">{title}</div>
        <div className="text-sm text-muted-foreground">{description}</div>
      </div>
      <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-muted-foreground group-hover:translate-x-1 transition-all" />
    </div>
  </button>
);


// ============ PROPOSAL MODAL ============

const ProposalModal = ({ request, onClose, onRefresh }) => {
  const [summary, setSummary] = useState(request.proposal?.summary || '');
  const [timeline, setTimeline] = useState(request.proposal?.timeline_text || '');
  const [cost, setCost] = useState(request.proposal?.estimated_cost?.toString() || '');
  const [notes, setNotes] = useState(request.proposal?.notes || '');
  const [features, setFeatures] = useState(
    request.proposal?.features?.length > 0
      ? request.proposal.features
      : [{ title: '', description: '', hours: '' }]
  );
  const [submitting, setSubmitting] = useState(false);

  const handleAddFeature = () => {
    setFeatures([...features, { title: '', description: '', hours: '' }]);
  };

  const handleRemoveFeature = (index) => {
    setFeatures(features.filter((_, i) => i !== index));
  };

  const handleFeatureChange = (index, field, value) => {
    const updated = [...features];
    updated[index][field] = value;
    setFeatures(updated);
  };

  const handleSubmitProposal = async () => {
    const validFeatures = features.filter(f => f.title.trim());
    if (!summary.trim() || validFeatures.length === 0) return;
    
    setSubmitting(true);
    try {
      await axios.post(`${API}/admin/master/request/${request.request_id}/proposal`, {
        summary,
        features: validFeatures.map(f => ({
          title: f.title,
          description: f.description || null,
          hours: f.hours ? parseInt(f.hours) : null,
        })),
        timeline_text: timeline || null,
        estimated_cost: cost ? parseFloat(cost) : null,
        notes: notes || null,
      }, { withCredentials: true });
      
      onRefresh();
      onClose();
    } catch (error) {
      console.error('Error creating proposal:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!window.confirm('Are you sure you want to reject this request?')) return;
    
    try {
      await axios.post(`${API}/admin/master/request/${request.request_id}/reject`, {}, { 
        withCredentials: true,
        params: { reason: 'Rejected by admin' }
      });
      onRefresh();
      onClose();
    } catch (error) {
      console.error('Error rejecting request:', error);
    }
  };

  const canSubmit = summary.trim() && features.filter(f => f.title.trim()).length > 0;
  const isProposalReady = request.status === 'proposal_ready';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
      <div className="w-full max-w-4xl max-h-[90vh] overflow-auto bg-[var(--t-surface)] border border-border rounded-3xl">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[var(--t-surface)] border-b border-border px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">{request.title}</h2>
            <p className="text-sm text-muted-foreground">
              {request.client?.name} · {request.client?.email}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-muted transition-colors"
            data-testid="close-modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Original Request */}
          <section className="rounded-2xl border border-border bg-black/30 p-5">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Original Request</h3>
            <p className="text-foreground whitespace-pre-wrap">{request.business_idea || request.description}</p>
            {request.target_audience && (
              <div className="mt-3 text-sm text-muted-foreground">
                <span className="font-medium">Target:</span> {request.target_audience}
              </div>
            )}
            {request.budget_range && (
              <div className="text-sm text-muted-foreground">
                <span className="font-medium">Budget:</span> {request.budget_range}
              </div>
            )}
          </section>

          {/* Proposal Builder */}
          {!isProposalReady && (
            <section className="space-y-4">
              <h3 className="text-lg font-semibold">Build Proposal</h3>
              
              {/* Auto Pricing Engine */}
              <AutoPricingPanel 
                idea={`${request.title}\n${request.business_idea || request.description || ''}`}
                requestId={request.request_id}
                onPriceSelected={(price) => setCost(String(Math.round(price)))}
              />
              
              <div>
                <label className="block text-sm text-muted-foreground mb-2">Summary *</label>
                <textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="Brief summary of what will be built..."
                  className="w-full h-24 bg-background border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-signal"
                  data-testid="proposal-summary"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-muted-foreground mb-2">Timeline</label>
                  <input
                    value={timeline}
                    onChange={(e) => setTimeline(e.target.value)}
                    placeholder="e.g., 4 weeks"
                    className="w-full bg-background border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-signal"
                    data-testid="proposal-timeline"
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-2">Estimated Cost ($)</label>
                  <input
                    type="number"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    placeholder="e.g., 4800"
                    className="w-full bg-background border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-signal"
                    data-testid="proposal-cost"
                  />
                </div>
              </div>

              {/* Features */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm text-muted-foreground">Features *</label>
                  <button
                    onClick={handleAddFeature}
                    className="text-sm text-signal hover:text-signal"
                    data-testid="add-feature-btn"
                  >
                    + Add Feature
                  </button>
                </div>
                <div className="space-y-3">
                  {features.map((feature, index) => (
                    <div key={index} className="flex gap-3 items-start">
                      <div className="flex-1 grid grid-cols-3 gap-3">
                        <input
                          value={feature.title}
                          onChange={(e) => handleFeatureChange(index, 'title', e.target.value)}
                          placeholder="Feature title *"
                          className="col-span-1 bg-background border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-signal"
                          data-testid={`feature-title-${index}`}
                        />
                        <input
                          value={feature.description}
                          onChange={(e) => handleFeatureChange(index, 'description', e.target.value)}
                          placeholder="Description (optional)"
                          className="col-span-1 bg-background border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-signal"
                          data-testid={`feature-desc-${index}`}
                        />
                        <input
                          type="number"
                          value={feature.hours}
                          onChange={(e) => handleFeatureChange(index, 'hours', e.target.value)}
                          placeholder="Hours"
                          className="col-span-1 bg-background border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-signal"
                          data-testid={`feature-hours-${index}`}
                        />
                      </div>
                      {features.length > 1 && (
                        <button
                          onClick={() => handleRemoveFeature(index)}
                          className="p-3 text-muted-foreground hover:text-danger transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm text-muted-foreground mb-2">Notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional notes for the client..."
                  className="w-full h-20 bg-background border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-signal"
                  data-testid="proposal-notes"
                />
              </div>
            </section>
          )}

          {/* Existing Proposal View */}
          {isProposalReady && request.proposal && (
            <section className="rounded-2xl border border-signal/50 bg-signal/5 p-5">
              <h3 className="text-lg font-semibold text-signal mb-4">Proposal Sent</h3>
              <p className="text-foreground mb-4">{request.proposal.summary}</p>
              
              {request.proposal.features?.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">Features</h4>
                  <div className="space-y-2">
                    {request.proposal.features.map((f, i) => (
                      <div key={i} className="flex items-center justify-between py-2 border-b border-border">
                        <div>
                          <span className="font-medium">{f.title}</span>
                          {f.description && <span className="text-sm text-muted-foreground ml-2">{f.description}</span>}
                        </div>
                        {f.hours && <span className="text-sm text-muted-foreground">{f.hours}h</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                {request.proposal.timeline_text && (
                  <div>
                    <span className="text-muted-foreground">Timeline:</span>{' '}
                    <span className="text-foreground">{request.proposal.timeline_text}</span>
                  </div>
                )}
                {request.proposal.estimated_cost && (
                  <div>
                    <span className="text-muted-foreground">Cost:</span>{' '}
                    <span className="text-foreground">${request.proposal.estimated_cost}</span>
                  </div>
                )}
              </div>
              
              <div className="mt-4 px-4 py-3 rounded-xl bg-signal/10 border border-signal/20">
                <div className="flex items-center gap-2 text-sm text-signal">
                  <Clock className="w-4 h-4" />
                  Waiting for client approval
                </div>
              </div>
            </section>
          )}
        </div>

        {/* Footer Actions */}
        <div className="sticky bottom-0 bg-[var(--t-surface)] border-t border-border px-6 py-4 flex items-center justify-between">
          <button
            onClick={handleReject}
            className="px-4 py-2 text-sm text-danger hover:text-danger/80 border border-danger/50 rounded-xl hover:bg-danger/10 transition-colors"
            data-testid="reject-btn"
          >
            Reject Request
          </button>
          
          {!isProposalReady && (
            <button
              onClick={handleSubmitProposal}
              disabled={!canSubmit || submitting}
              className="flex items-center gap-2 px-6 py-2.5 bg-signal/15 text-foreground rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              data-testid="submit-proposal-btn"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Publish Proposal
            </button>
          )}
        </div>
      </div>
    </div>
  );
};


export default MasterAdminDashboard;
