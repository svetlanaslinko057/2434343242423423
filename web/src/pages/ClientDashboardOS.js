import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import {
  FolderKanban,
  AlertTriangle,
  DollarSign,
  CheckCircle2,
  Clock,
  FileText,
  ArrowRight,
  TrendingUp,
  AlertCircle
} from 'lucide-react';
import { ConfidenceScoreWidget } from '@/components/trust/ConfidenceScoreWidget';
import { RiskWarningsPanel } from '@/components/trust/RiskWarningsPanel';
import { NextStepsTracker } from '@/components/trust/NextStepsTracker';
import { TransparencyPanel } from '@/components/trust/TransparencyPanel';
import { SilenceKillerBanner } from '@/components/trust/SilenceKillerBanner';
import { RecommendedActionsPanel } from '@/components/trust/RecommendedActionsPanel';

const ClientDashboardOS = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [trustData, setTrustData] = useState(null);

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const res = await runtime.get(`/api/client/dashboard`);
        setDashboard(res.data);
        
        // Also fetch contract status for active projects
        if (res.data.projects && res.data.projects.length > 0) {
          const project = res.data.projects[0]; // First active project
          try {
            const contractRes = await runtime.get(`/api/client/projects/${project.project_id}/contract`);
            setDashboard(prev => ({ ...prev, contract: contractRes.data }));
          } catch (err) {
            // No contract yet
            console.log('No contract for project');
          }

          // Fetch Trust Engine data
          try {
            const [trustRes, risksRes, stepsRes, transparencyRes, updatesRes] = await Promise.all([
              runtime.get(`/api/client/projects/${project.project_id}/trust`),
              runtime.get(`/api/client/projects/${project.project_id}/risks`),
              runtime.get(`/api/client/projects/${project.project_id}/next-steps`),
              runtime.get(`/api/client/projects/${project.project_id}/transparency`),
              runtime.get(`/api/client/projects/${project.project_id}/updates`)
            ]);

            setTrustData({
              trust: trustRes.data,
              risks: risksRes.data.risks,
              nextSteps: stepsRes.data.next_steps,
              transparency: transparencyRes.data.transparency,
              updates: updatesRes.data.updates
            });
          } catch (err) {
            console.error('Error fetching trust data:', err);
          }
        }
      } catch (error) {
        console.error('Error fetching dashboard:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchDashboard();
  }, []);

  const handleActionClick = (action) => {
    if (action.type === 'approve_deliverable') {
      navigate(`/client/project-workspace/${action.project_id}`);
    } else if (action.type === 'pay_invoice') {
      navigate('/client/billing-os');
    } else if (action.type === 'approve_estimate') {
      navigate(`/client/project/${action.project_id}`);
    } else if (action.type === 'suggestion' && action.project_id) {
      navigate(`/client/project-workspace/${action.project_id}`);
    }
  };

  const getPriorityStyle = (priority) => {
    const styles = {
      urgent: 'border-red-500/50 bg-red-500/10',
      action: 'border-yellow-500/40 bg-yellow-500/5',
      info: 'border-signal/30 bg-signal/5'
    };
    return styles[priority] || styles.info;
  };

  const getPriorityIcon = (priority) => {
    if (priority === 'urgent') return <AlertTriangle className="w-5 h-5 text-red-400" />;
    if (priority === 'action') return <Clock className="w-5 h-5 text-yellow-400" />;
    return <CheckCircle2 className="w-5 h-5 text-signal" />;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="client-dashboard-os-loading">
        <div className="w-8 h-8 border-2 border-border border-t-signal rounded-full animate-spin" />
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="client-dashboard-os-error">
        <div className="text-muted-foreground">Failed to load dashboard</div>
      </div>
    );
  }

  const { pending_actions, projects, financial_summary, alerts } = dashboard;

  return (
    <div className="min-h-screen p-6 lg:p-8" data-testid="client-dashboard-os">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-semibold text-white mb-2">
          Client Operating Workspace
        </h1>
        <p className="text-muted-foreground text-sm">Action-first control center</p>
      </div>

      {/* Contract Status Widget */}
      {dashboard.contract && (
        <div className="mb-6">
          <div
            onClick={() => {
              if (dashboard.projects[0]) {
                navigate(`/client/contract/${dashboard.projects[0].project_id}`);
              }
            }}
            className={`border rounded-lg p-4 cursor-pointer transition-all ${
              dashboard.contract.status === 'active'
                ? 'border-green-500/30 bg-green-500/10 hover:bg-green-500/15'
                : 'border-yellow-500/40 bg-yellow-500/10 hover:bg-yellow-500/15'
            }`}
            data-testid="contract-status-widget"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText className={`w-5 h-5 ${
                  dashboard.contract.status === 'active' ? 'text-green-400' : 'text-yellow-400'
                }`} />
                <div>
                  <div className="text-white font-medium text-sm">Contract Status</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {dashboard.contract.status === 'active' ? 'Active & Signed' : 'Awaiting Signature'}
                  </div>
                </div>
              </div>
              
              {dashboard.contract.status !== 'active' && (
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-yellow-500/30 text-yellow-300 px-2 py-1 rounded font-medium">
                    ACTION REQUIRED
                  </span>
                  <ArrowRight className="w-4 h-4 text-yellow-400" />
                </div>
              )}
              
              {dashboard.contract.status === 'active' && (
                <CheckCircle2 className="w-5 h-5 text-green-400" />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Alerts - RISK SYSTEM */}
      {alerts && alerts.length > 0 && (
        <div className="mb-6 space-y-2" data-testid="client-alerts">
          {alerts.map((alert, idx) => (
            <div
              key={idx}
              className={`p-4 rounded-lg border flex items-start gap-3 ${ alert.severity === 'critical'
                  ? 'bg-red-500/15 border-red-500/40'
                  : alert.severity === 'high'
                  ? 'bg-yellow-500/10 border-yellow-500/30'
                  : 'bg-signal/10 border-signal/30'
              }`}
              data-testid={`alert-${alert.type}`}
            >
              <AlertTriangle className={`w-5 h-5 mt-0.5 ${
                alert.severity === 'critical' ? 'text-red-400' : 'text-yellow-400'
              }`} />
              <div className="flex-1">
                <div className="text-white font-medium text-sm mb-1">{alert.message}</div>
                {alert.details && alert.details.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {alert.details.map((d, i) => (
                      <div key={i}>• {d}</div>
                    ))}
                  </div>
                )}
              </div>
              {alert.severity === 'critical' && (
                <span className="text-xs bg-red-500/30 text-red-300 px-2 py-1 rounded font-medium">
                  CRITICAL
                </span>
              )}
            </div>
          ))}
        </div>
      )}


      {/* Trust Engine Section */}
      {trustData && (
        <>
          {/* Silence Killer Banner */}
          {trustData.updates && trustData.updates.length > 0 && (
            <SilenceKillerBanner updates={trustData.updates} />
          )}

          {/* Trust Engine Bento Grid */}
          <div className="mb-8 grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Confidence Score */}
            <ConfidenceScoreWidget
              score={trustData.trust.confidence_score}
              riskLevel={trustData.trust.risk_level}
              lastCalculated={trustData.trust.last_calculated_at}
              breakdown={trustData.trust.breakdown}
              trend={trustData.trust.trend}
              delta24h={trustData.trust.delta_24h}
              trendReason={trustData.trust.trend_reason}
            />

            {/* Recommended Actions */}
            <RecommendedActionsPanel actions={trustData.trust.recommended_actions} />
          </div>

          {/* Risk Warnings */}
          <div className="mb-8">
            <RiskWarningsPanel risks={trustData.risks} />
          </div>

          {/* Next Steps */}
          <div className="mb-8">
            <NextStepsTracker steps={trustData.nextSteps} />
          </div>

          {/* Transparency Panel */}
          <div className="mb-8">
            <TransparencyPanel 
              transparency={trustData.transparency} 
              devSession={trustData.trust.dev_session}
            />
          </div>
        </>
      )}


      {/* Pending Actions */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <AlertCircle className="w-5 h-5 text-red-400" />
          <h2 className="text-lg font-semibold text-foreground">Pending Actions</h2>
          <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
            {pending_actions.length}
          </span>
        </div>

        {pending_actions.length === 0 ? (
          <div
            className="border border-border rounded-lg p-8 text-center"
            data-testid="no-pending-actions"
          >
            <CheckCircle2 className="w-12 h-12 text-green-500/50 mx-auto mb-3" />
            <div className="text-muted-foreground text-sm">All caught up! No pending actions.</div>
          </div>
        ) : (
          <div className="space-y-3" data-testid="pending-actions-list">
            {pending_actions.map((action, idx) => (
              <div
                key={idx}
                onClick={() => handleActionClick(action)}
                className={`border rounded-lg p-4 hover:border-opacity-100 transition-all cursor-pointer group ${getPriorityStyle(action.priority || 'info')}`}
                data-testid={`pending-action-${action.type}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1">
                    <div className="mt-1">
                      {action.type === 'approve_deliverable' && (
                        <FileText className="w-5 h-5 text-signal" />
                      )}
                      {action.type === 'pay_invoice' && (
                        <DollarSign className="w-5 h-5 text-green-400" />
                      )}
                      {action.type === 'approve_estimate' && (
                        <Clock className="w-5 h-5 text-signal" />
                      )}
                      {action.type === 'suggestion' && (
                        <TrendingUp className="w-5 h-5 text-signal" />
                      )}
                    </div>

                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="text-white font-medium text-sm">
                          {action.type === 'approve_deliverable' && 'Approve Deliverable'}
                          {action.type === 'pay_invoice' && (action.overdue ? '⚠️ Payment Overdue' : 'Pay Invoice')}
                          {action.type === 'approve_estimate' && 'Approve Estimate'}
                          {action.type === 'suggestion' && action.message}
                        </div>
                        {action.priority === 'urgent' && (
                          <span className="text-xs bg-red-500/30 text-red-400 px-2 py-0.5 rounded-full font-medium">
                            URGENT
                          </span>
                        )}
                        {action.days_overdue > 0 && (
                          <span className="text-xs text-red-400">
                            +{action.days_overdue}d overdue
                          </span>
                        )}
                        {action.days_waiting > 2 && (
                          <span className="text-xs text-yellow-400">
                            waiting {action.days_waiting}d
                          </span>
                        )}
                      </div>
                      
                      <div className="text-muted-foreground text-xs mt-0.5">
                        {action.project_name || 'Project'}
                        {action.module_name && ` · ${action.module_name}`}
                        {action.amount && ` · $${action.amount}`}
                      </div>
                      
                      {action.impact && (
                        <div className="mt-2 text-xs text-muted-foreground border-t border-border pt-2">
                          <span className="text-muted-foreground">Impact:</span> {action.impact}
                        </div>
                      )}
                    </div>
                  </div>

                  <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-signal group-hover:translate-x-1 transition-all mt-1" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Projects & Financial Summary Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Projects */}
        <div className="lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <FolderKanban className="w-5 h-5 text-signal" />
            <h2 className="text-lg font-semibold text-foreground">Active Projects</h2>
          </div>

          {projects.length === 0 ? (
            <div
              className="border border-border rounded-lg p-8 text-center"
              data-testid="no-projects"
            >
              <div className="text-muted-foreground text-sm">No projects yet</div>
            </div>
          ) : (
            <div className="space-y-3" data-testid="projects-list">
              {projects.map((project) => (
                <div
                  key={project.project_id}
                  onClick={() => navigate(`/client/project-workspace/${project.project_id}`)}
                  className="border border-border rounded-lg p-4 hover:border-signal/30 hover:bg-muted transition-all cursor-pointer"
                  data-testid={`project-${project.project_id}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-white font-medium">{project.name}</div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-signal/15 text-signal px-2 py-1 rounded">
                        {project.status}
                      </span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="mb-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">Progress</span>
                      <span className="text-xs text-muted-foreground font-medium">{project.progress}%</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-signal transition-all"
                        style={{ width: `${project.progress}%` }}
                      />
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    {project.done_modules}/{project.total_modules} modules completed
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Financial Summary */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="w-5 h-5 text-green-400" />
            <h2 className="text-lg font-semibold text-foreground">Financial Snapshot</h2>
          </div>

          <div className="border border-border rounded-lg p-6 space-y-4" data-testid="financial-summary">
            <div>
              <div className="text-muted-foreground text-xs mb-1">Total Paid</div>
              <div className="text-2xl font-semibold text-green-400">
                ${financial_summary.paid.toLocaleString()}
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <div className="text-muted-foreground text-xs mb-1">Pending</div>
              <div className="text-xl font-semibold text-yellow-400">
                ${financial_summary.pending.toLocaleString()}
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <div className="text-muted-foreground text-xs mb-1">Total Invoices</div>
              <div className="text-lg text-muted-foreground">
                {financial_summary.total_invoices}
              </div>
            </div>

            <button
              onClick={() => navigate('/client/billing-os')}
              className="w-full mt-4 bg-signal/10 hover:bg-signal/15 border border-signal/30 text-signal py-2 rounded-lg text-sm font-medium transition-all"
              data-testid="view-billing-btn"
            >
              View All Invoices
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClientDashboardOS;
