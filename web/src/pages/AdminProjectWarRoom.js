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
  Users,
  Activity,
  XCircle,
  AlertCircle,
  ChevronRight,
  Zap
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/**
 * PROJECT WAR ROOM - Operations Command Center for Project
 * 
 * This is NOT a simple project detail page.
 * This is an operational war room.
 * 
 * 5 seconds → understand status
 * 10 seconds → see problem
 * 20 seconds → know who's responsible
 */

const AdminProjectWarRoom = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  // Fetch war room data
  const fetchWarRoom = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API}/admin/projects/${projectId}/war-room`);
      setData(response.data);
    } catch (error) {
      console.error('Failed to fetch war room:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWarRoom();

    // Auto-refresh every 2 minutes
    const interval = setInterval(fetchWarRoom, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [projectId]);

  // Risk badge styling
  const getRiskStyle = (risk) => {
    switch (risk) {
      case 'critical':
        return 'bg-red-500 text-white';
      case 'risk':
        return 'bg-orange-500 text-white';
      case 'watch':
        return 'bg-yellow-500 text-black';
      default:
        return 'bg-green-500 text-white';
    }
  };

  // Time ago helper
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
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-[var(--color-primary)] mx-auto mb-3" />
          <p className="text-sm text-[var(--color-text-muted)]">Loading War Room...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[var(--color-background)] flex items-center justify-center">
        <div className="text-center">
          <XCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
          <p className="text-[var(--color-text)]">Failed to load project</p>
          <Button onClick={() => navigate('/admin/projects')} className="mt-4">
            Back to Projects
          </Button>
        </div>
      </div>
    );
  }

  const { project, stats, timeline, delivery, qa, team, events } = data;

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      {/* Back Button */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/admin/projects')}
              className="gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Projects
            </Button>
            <div className="text-sm text-[var(--color-text-muted)]">/</div>
            <div className="text-sm text-[var(--color-text)]">War Room</div>
            <div className="ml-auto">
              <Button onClick={fetchWarRoom} variant="outline" size="sm" className="gap-2">
                <RefreshCw className="w-4 h-4" />
                Refresh
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        
        {/* ============ 1. PROJECT HEADER ============ */}
        <Card className="p-6">
          <div className="flex items-start justify-between gap-6">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl font-bold text-[var(--color-text)]">
                  {project.name}
                </h1>
                <Badge className={`${getRiskStyle(project.risk_level)} font-semibold`}>
                  {project.risk_level.toUpperCase()}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                <div>
                  <span className="text-[var(--color-text-muted)]">Client:</span>{' '}
                  <span className="text-[var(--color-text)] font-medium">{project.client_name}</span>
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)]">Stage:</span>{' '}
                  <span className="text-[var(--color-text)] font-medium">{project.stage}</span>
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)]">Progress:</span>{' '}
                  <span className="text-[var(--color-text)] font-medium">{project.progress_percent}%</span>
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)]">Last Activity:</span>{' '}
                  <span className="text-[var(--color-text)] font-medium">{timeAgo(project.last_activity_at)}</span>
                </div>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-[var(--color-text)]">{stats.active_tasks}</div>
                <div className="text-xs text-[var(--color-text-muted)]">Active</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-yellow-500">{stats.waiting_review}</div>
                <div className="text-xs text-[var(--color-text-muted)]">In QA</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-500">{stats.revision_tasks}</div>
                <div className="text-xs text-[var(--color-text-muted)]">Revisions</div>
              </div>
            </div>
          </div>
        </Card>

        {/* ============ 2. TIMELINE ============ */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Timeline
          </h2>
          
          {timeline.length === 0 ? (
            <div className="text-center py-8 text-[var(--color-text-muted)]">
              No activity yet
            </div>
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
                    {event.entity_type && (
                      <Badge variant="outline" className="text-xs mt-1">
                        {event.entity_type}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ============ 3. DELIVERY GRID + 4. QA PANEL ============ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* DELIVERY GRID (2 columns) */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-lg font-semibold text-[var(--color-text)]">Delivery Grid</h2>
            
            {/* Active Tasks */}
            <Card className="p-4">
              <h3 className="font-medium text-[var(--color-text)] mb-3 flex items-center gap-2">
                <Zap className="w-4 h-4 text-green-500" />
                Active ({delivery.active_tasks.length})
              </h3>
              {delivery.active_tasks.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">No active tasks</p>
              ) : (
                <div className="space-y-2">
                  {delivery.active_tasks.map((task) => (
                    <div
                      key={task.unit_id}
                      className="flex items-center justify-between p-2 rounded bg-[var(--color-surface-elevated)]"
                    >
                      <div className="flex-1">
                        <p className="text-sm font-medium text-[var(--color-text)]">{task.title}</p>
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {task.assigned_to || 'Unassigned'}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {task.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Waiting Review */}
            <Card className="p-4">
              <h3 className="font-medium text-[var(--color-text)] mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4 text-yellow-500" />
                Waiting Review ({delivery.waiting_review.length})
              </h3>
              {delivery.waiting_review.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">No tasks waiting</p>
              ) : (
                <div className="space-y-2">
                  {delivery.waiting_review.map((task) => (
                    <div
                      key={task.unit_id}
                      className="flex items-center justify-between p-2 rounded bg-[var(--color-surface-elevated)]"
                    >
                      <div className="flex-1">
                        <p className="text-sm font-medium text-[var(--color-text)]">{task.title}</p>
                        <p className="text-xs text-[var(--color-text-muted)]">
                          waiting {timeAgo(task.submitted_at || task.updated_at)}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-xs bg-yellow-500/10">
                        {task.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Revision Tasks */}
            {delivery.revision_tasks.length > 0 && (
              <Card className="p-4">
                <h3 className="font-medium text-[var(--color-text)] mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  Revision ({delivery.revision_tasks.length})
                </h3>
                <div className="space-y-2">
                  {delivery.revision_tasks.map((task) => (
                    <div
                      key={task.unit_id}
                      className="flex items-center justify-between p-2 rounded bg-red-500/5"
                    >
                      <div className="flex-1">
                        <p className="text-sm font-medium text-[var(--color-text)]">{task.title}</p>
                        <p className="text-xs text-[var(--color-text-muted)]">
                          revision #{task.revision_count || 1}
                        </p>
                      </div>
                      <Badge variant="destructive" className="text-xs">
                        HIGH
                      </Badge>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Blocked Tasks */}
            {delivery.blocked_tasks.length > 0 && (
              <Card className="p-4">
                <h3 className="font-medium text-[var(--color-text)] mb-3 flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-gray-500" />
                  Blocked ({delivery.blocked_tasks.length})
                </h3>
                <div className="space-y-2">
                  {delivery.blocked_tasks.map((task) => (
                    <div
                      key={task.unit_id}
                      className="flex items-center justify-between p-2 rounded bg-[var(--color-surface-elevated)]"
                    >
                      <div className="flex-1">
                        <p className="text-sm font-medium text-[var(--color-text)]">{task.title}</p>
                        <p className="text-xs text-red-500">no assignee</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>

          {/* QA + RISK PANEL (1 column) */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-[var(--color-text)]">QA & Risk</h2>
            
            {/* QA Health */}
            <Card className="p-4">
              <h3 className="font-medium text-[var(--color-text)] mb-3">QA Health</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Submitted:</span>
                  <span className="text-[var(--color-text)] font-medium">{qa.submitted_count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Passed:</span>
                  <span className="text-green-500 font-medium">{qa.passed_count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Revisions:</span>
                  <span className="text-red-500 font-medium">{qa.revision_count}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-[var(--color-border)]">
                  <span className="text-[var(--color-text-muted)]">First-pass:</span>
                  <span className="text-[var(--color-text)] font-bold">{stats.first_pass_rate}%</span>
                </div>
              </div>
            </Card>

            {/* Events */}
            <Card className="p-4">
              <h3 className="font-medium text-[var(--color-text)] mb-3">Open Issues</h3>
              {events.length === 0 ? (
                <div className="text-center py-4">
                  <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
                  <p className="text-sm text-[var(--color-text-muted)]">No open issues</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {events.map((event) => (
                    <div
                      key={event.event_id}
                      className="p-2 rounded bg-[var(--color-surface-elevated)]"
                    >
                      <div className="flex items-start gap-2">
                        {event.severity === 'critical' ? (
                          <XCircle className="w-4 h-4 text-red-500 mt-0.5" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-yellow-500 mt-0.5" />
                        )}
                        <div className="flex-1">
                          <p className="text-sm text-[var(--color-text)]">{event.title}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">{event.message}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>

        {/* ============ 5. TEAM PANEL ============ */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
            <Users className="w-5 h-5" />
            Team ({team.length})
          </h2>
          
          {team.length === 0 ? (
            <div className="text-center py-8 text-[var(--color-text-muted)]">
              No team members assigned
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {team.map((member) => (
                <Card
                  key={member.user_id}
                  className="p-4 cursor-pointer hover:border-[var(--color-primary)] transition-colors"
                  onClick={() => navigate(`/admin/dev/${member.user_id}`)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-medium text-[var(--color-text)]">{member.name}</h3>
                    <ChevronRight className="w-4 h-4 text-[var(--color-text-muted)]" />
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-muted)]">Active:</span>
                      <span className="text-[var(--color-text)] font-medium">{member.active_tasks_count}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-muted)]">QA Pass:</span>
                      <span className={`font-medium ${member.qa_pass_rate >= 70 ? 'text-green-500' : 'text-red-500'}`}>
                        {member.qa_pass_rate}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-muted)]">Revisions:</span>
                      <span className="text-[var(--color-text)] font-medium">{member.revision_count}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-[var(--color-border)]">
                      <span className="text-[var(--color-text-muted)]">Last update:</span>
                      <span className="text-[var(--color-text)] font-medium">{timeAgo(member.last_activity_at)}</span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default AdminProjectWarRoom;
