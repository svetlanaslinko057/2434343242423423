import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import axios from 'axios';
import {
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Activity,
  XCircle,
  AlertCircle,
  ChevronRight,
  Zap,
  Target,
  TrendingUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/**
 * DEVELOPER PROFILE 2.0 - Operations Card
 * 
 * This is NOT a simple user profile.
 * This is an operational card of developer as a production unit.
 * 
 * Answers:
 * - Is this person speeding up or slowing down the system?
 * - Can we trust this developer?
 * - What is their quality level?
 */

const AdminDeveloperProfile = () => {
  const { developerId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  // Fetch profile
  const fetchProfile = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API}/admin/developers/${developerId}/profile`);
      setData(response.data);
    } catch (error) {
      console.error('Failed to fetch developer profile:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, [developerId]);

  // Status styling
  const getStatusStyle = (status) => {
    switch (status) {
      case 'overloaded':
        return 'bg-red-500 text-white';
      case 'at_risk':
        return 'bg-orange-500 text-white';
      case 'loaded':
        return 'bg-yellow-500 text-black';
      default:
        return 'bg-green-500 text-white';
    }
  };

  // Time ago
  const timeAgo = (timestamp) => {
    if (!timestamp) return 'N/A';
    const now = new Date();
    const created = new Date(timestamp);
    const diffMs = now - created;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays}d ago`;
    if (diffHours > 0) return `${diffHours}h ago`;
    return 'just now';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-background)] flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-[var(--color-primary)]" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[var(--color-background)] flex items-center justify-center">
        <div className="text-center">
          <XCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
          <p>Failed to load developer</p>
        </div>
      </div>
    );
  }

  const { developer, stats, timeline, workload, quality, time, projects, events } = data;

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      {/* Header */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/admin/team')}
              className="gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Team
            </Button>
            <div className="text-sm text-[var(--color-text-muted)]">/</div>
            <div className="text-sm text-[var(--color-text)]">Developer</div>
            <div className="ml-auto">
              <Button onClick={fetchProfile} variant="outline" size="sm" className="gap-2">
                <RefreshCw className="w-4 h-4" />
                Refresh
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        
        {/* ============ A. DEVELOPER HEADER ============ */}
        <Card className="p-6">
          <div className="flex items-start justify-between gap-6">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl font-bold text-[var(--color-text)]">
                  {developer.name}
                </h1>
                <Badge className={`${getStatusStyle(developer.status)} font-semibold`}>
                  {developer.status.toUpperCase()}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                <div>
                  <span className="text-[var(--color-text-muted)]">Active Tasks:</span>{' '}
                  <span className="text-[var(--color-text)] font-medium">{stats.active_tasks}</span>
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)]">In Review:</span>{' '}
                  <span className="text-[var(--color-text)] font-medium">{stats.waiting_review}</span>
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)]">Revisions:</span>{' '}
                  <span className="text-red-500 font-medium">{stats.revision_tasks}</span>
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)]">Last Activity:</span>{' '}
                  <span className="text-[var(--color-text)] font-medium">{timeAgo(developer.last_activity_at)}</span>
                </div>
              </div>
            </div>

            {/* Quality Stats */}
            <div className="grid grid-cols-2 gap-4 text-center">
              <div>
                <div className={`text-2xl font-bold ${quality.qa_pass_rate >= 70 ? 'text-green-500' : 'text-red-500'}`}>
                  {quality.qa_pass_rate}%
                </div>
                <div className="text-xs text-[var(--color-text-muted)]">QA Pass Rate</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-[var(--color-text)]">
                  {time.confidence_score ? Math.round(time.confidence_score * 100) : 0}%
                </div>
                <div className="text-xs text-[var(--color-text-muted)]">Time Confidence</div>
              </div>
            </div>
          </div>
        </Card>

        {/* ============ B. ACTIVITY TIMELINE + C. WORKLOAD ============ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Timeline */}
          <div className="lg:col-span-2">
            <Card className="p-6">
              <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5" />
                Activity Timeline
              </h2>
              {timeline.length === 0 ? (
                <div className="text-center py-8 text-[var(--color-text-muted)]">No recent activity</div>
              ) : (
                <div className="space-y-3">
                  {timeline.map((event, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-3 p-3 rounded-lg hover:bg-[var(--color-surface-elevated)] transition-colors"
                    >
                      <div className="text-xs text-[var(--color-text-muted)] whitespace-nowrap mt-0.5">
                        {timeAgo(event.timestamp)}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-[var(--color-text)]">{event.title}</p>
                        <Badge variant="outline" className="text-xs mt-1">
                          {event.type}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Workload Summary */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-[var(--color-text)]">Workload</h2>
            
            <Card className="p-4">
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[var(--color-text-muted)]">Active</span>
                  <Badge variant="outline">{stats.active_tasks}</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[var(--color-text-muted)]">In Review</span>
                  <Badge variant="outline" className="bg-yellow-500/10">{stats.waiting_review}</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[var(--color-text-muted)]">Revisions</span>
                  <Badge variant="outline" className="bg-red-500/10">{stats.revision_tasks}</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[var(--color-text-muted)]">Stuck</span>
                  <Badge variant="outline">{stats.stuck_tasks}</Badge>
                </div>
                <div className="flex justify-between items-center pt-3 border-t border-[var(--color-border)]">
                  <span className="text-sm font-medium text-[var(--color-text)]">Completed</span>
                  <span className="text-sm font-bold text-green-500">{stats.completed_tasks}</span>
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* ============ D. QUALITY METRICS + E. TRUST & TIME ============ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Quality Metrics */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
              <Target className="w-5 h-5" />
              Quality Metrics
            </h2>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-[var(--color-text-muted)]">QA Pass Rate:</span>
                <span className={`font-medium ${quality.qa_pass_rate >= 70 ? 'text-green-500' : 'text-red-500'}`}>
                  {quality.qa_pass_rate}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-[var(--color-text-muted)]">Revision Rate:</span>
                <span className="text-[var(--color-text)] font-medium">{quality.revision_rate}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-[var(--color-text-muted)]">Avg Iterations:</span>
                <span className="text-[var(--color-text)] font-medium">{quality.avg_iterations}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-[var(--color-text-muted)]">High Severity Issues:</span>
                <span className="text-red-500 font-medium">{quality.high_severity_issues}</span>
              </div>
            </div>
          </Card>

          {/* Trust & Time */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Trust & Time
            </h2>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-[var(--color-text-muted)]">Time Logged:</span>
                <span className="text-[var(--color-text)] font-medium">{time.time_logged || 0}h</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-[var(--color-text-muted)]">Manual:</span>
                <span className="text-[var(--color-text)] font-medium">
                  {time.manual_ratio ? Math.round(time.manual_ratio * 100) : 0}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-[var(--color-text-muted)]">Auto:</span>
                <span className="text-[var(--color-text)] font-medium">
                  {time.manual_ratio ? Math.round((1 - time.manual_ratio) * 100) : 0}%
                </span>
              </div>
              <div className="flex justify-between pt-3 border-t border-[var(--color-border)]">
                <span className="text-sm font-medium text-[var(--color-text)]">Confidence:</span>
                <span className="text-[var(--color-text)] font-bold">
                  {time.confidence_score ? Math.round(time.confidence_score * 100) : 0}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-[var(--color-text-muted)]">Anomalies:</span>
                <span className="text-red-500 font-medium">{time.anomalies_count || 0}</span>
              </div>
            </div>
          </Card>
        </div>

        {/* ============ F. PROJECT INVOLVEMENT ============ */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4">
            Project Involvement ({projects.length})
          </h2>
          {projects.length === 0 ? (
            <div className="text-center py-8 text-[var(--color-text-muted)]">
              No active projects
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((project) => (
                <Card
                  key={project.project_id}
                  className="p-4 cursor-pointer hover:border-[var(--color-primary)] transition-colors"
                  onClick={() => navigate(`/admin/project/${project.project_id}/war-room`)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-medium text-[var(--color-text)] flex-1">
                      {project.project_name}
                    </h3>
                    <ChevronRight className="w-4 h-4 text-[var(--color-text-muted)]" />
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-muted)]">Active:</span>
                      <span className="text-[var(--color-text)] font-medium">{project.active_tasks_count}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-muted)]">Total:</span>
                      <span className="text-[var(--color-text)] font-medium">{project.total_tasks_count}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-[var(--color-border)]">
                      <span className="text-[var(--color-text-muted)]">Status:</span>
                      <Badge
                        className={`text-xs ${
                          project.risk_level === 'critical' ? 'bg-red-500' :
                          project.risk_level === 'risk' ? 'bg-orange-500' :
                          'bg-green-500'
                        }`}
                      >
                        {project.risk_level.toUpperCase()}
                      </Badge>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Card>

        {/* Events */}
        {events.length > 0 && (
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-orange-500" />
              Open Issues ({events.length})
            </h2>
            <div className="space-y-2">
              {events.map((event) => (
                <div
                  key={event.event_id}
                  className="p-3 rounded bg-[var(--color-surface-elevated)]"
                >
                  <div className="flex items-start gap-2">
                    {event.severity === 'critical' ? (
                      <XCircle className="w-4 h-4 text-red-500 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-yellow-500 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <p className="text-sm font-medium text-[var(--color-text)]">{event.title}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{event.message}</p>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {event.severity}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};

export default AdminDeveloperProfile;
