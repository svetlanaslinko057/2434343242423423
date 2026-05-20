import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import axios from 'axios';
import {
  ArrowLeft,
  Play,
  Clock,
  AlertCircle,
  CheckCircle2,
  Send,
  Plus,
  Link as LinkIcon,
  Loader2,
  FileText,
  Folder,
  Timer,
  ChevronRight
} from 'lucide-react';

const DeveloperWorkPage = () => {
  const { unitId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [workUnit, setWorkUnit] = useState(null);
  const [workLogs, setWorkLogs] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Form state
  const [logHours, setLogHours] = useState('');
  const [logDescription, setLogDescription] = useState('');
  const [submitSummary, setSubmitSummary] = useState('');
  const [submitLinks, setSubmitLinks] = useState(['']);

  useEffect(() => {
    fetchData();
  }, [unitId]);

  const fetchData = async () => {
    try {
      const [unitsRes, logsRes, subsRes] = await Promise.all([
        axios.get(`${API}/developer/work-units`, { withCredentials: true }),
        axios.get(`${API}/work-units/${unitId}/logs`, { withCredentials: true }),
        axios.get(`${API}/work-units/${unitId}/submissions`, { withCredentials: true })
      ]);
      
      const unit = unitsRes.data.find(u => u.unit_id === unitId);
      setWorkUnit(unit);
      setWorkLogs(logsRes.data);
      setSubmissions(subsRes.data);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStartWork = async () => {
    setActionLoading(true);
    try {
      await axios.post(`${API}/developer/work-units/${unitId}/start`, {}, { withCredentials: true });
      await fetchData();
    } catch (error) {
      alert('Failed to start work');
    } finally {
      setActionLoading(false);
    }
  };

  const handleLogWork = async (e) => {
    e.preventDefault();
    if (!logHours || !logDescription.trim()) return;
    
    setActionLoading(true);
    try {
      await axios.post(`${API}/work-units/${unitId}/log`, {
        hours: parseFloat(logHours),
        description: logDescription
      }, { withCredentials: true });
      
      setLogHours('');
      setLogDescription('');
      await fetchData();
    } catch (error) {
      alert('Failed to log work');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!submitSummary.trim()) return;
    
    // Check if has logged hours
    if (workLogs.length === 0) {
      alert('You must log at least some work before submitting');
      return;
    }
    
    setActionLoading(true);
    try {
      await axios.post(`${API}/work-units/${unitId}/submit`, {
        summary: submitSummary,
        links: submitLinks.filter(l => l.trim())
      }, { withCredentials: true });
      
      await fetchData();
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to submit work');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-border border-t-signal rounded-full animate-spin" />
      </div>
    );
  }

  if (!workUnit) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Work unit not found</p>
          <button 
            onClick={() => navigate('/developer/assignments')}
            className="mt-4 text-signal hover:text-signal"
          >
            Back to Assignments
          </button>
        </div>
      </div>
    );
  }

  const status = workUnit.status;
  const canStart = status === 'assigned';
  const canLog = ['in_progress', 'revision'].includes(status);
  const canSubmit = ['in_progress', 'revision'].includes(status);
  const isSubmitted = ['submitted', 'validation'].includes(status);
  const isRevision = status === 'revision';
  const isCompleted = status === 'completed';

  const totalHours = workLogs.reduce((sum, log) => sum + log.hours, 0);
  const latestSubmission = submissions[submissions.length - 1];

  return (
    <div className="min-h-screen p-8" data-testid="developer-work-page">
      {/* Background */}
      
      {/* Breadcrumb */}
      <button
        onClick={() => navigate('/developer/assignments')}
        className="relative flex items-center gap-2 text-muted-foreground hover:text-white text-sm mb-8 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Assignments
      </button>

      <div className="relative grid grid-cols-3 gap-8 max-w-6xl">
        {/* LEFT COLUMN - Main Work */}
        <div className="col-span-2 space-y-6">
          {/* Header */}
          <div className="flex items-start gap-4">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${
              isRevision ? 'bg-red-500/10 border border-red-500/20' :
              isCompleted ? 'bg-emerald-500/10 border border-emerald-500/20' :
              isSubmitted ? 'bg-amber-500/10 border border-amber-500/20' :
              'bg-signal/10 border border-signal/20'
            }`}>
              {isRevision && <AlertCircle className="w-6 h-6 text-red-400" />}
              {isCompleted && <CheckCircle2 className="w-6 h-6 text-emerald-400" />}
              {isSubmitted && <Clock className="w-6 h-6 text-amber-400" />}
              {!isRevision && !isCompleted && !isSubmitted && <Play className="w-6 h-6 text-signal" />}
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{workUnit.title}</h1>
              <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
                <span className="capitalize">{workUnit.unit_type || 'Task'}</span>
                <span className="w-1 h-1 rounded-full bg-muted" />
                <span>{workUnit.estimated_hours}h estimated</span>
              </div>
            </div>
          </div>

          {/* Revision Alert */}
          {isRevision && latestSubmission && (
            <div className="rounded-2xl border border-red-500/30 bg-signal/15 p-6">
              <div className="flex items-center gap-3 mb-3">
                <AlertCircle className="w-5 h-5 text-red-400" />
                <h3 className="font-semibold text-red-400">Revision Required</h3>
              </div>
              <p className="text-muted-foreground text-sm">
                {latestSubmission.feedback || 'Review feedback and make necessary changes'}
              </p>
            </div>
          )}

          {/* Start Work Button */}
          {canStart && (
            <button
              onClick={handleStartWork}
              disabled={actionLoading}
              className="w-full bg-signal hover:bg-signal text-white rounded-2xl p-5 font-semibold flex items-center justify-center gap-3 transition-all shadow-lg shadow-signal/20 disabled:opacity-50"
              data-testid="start-work-btn"
            >
              {actionLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Play className="w-5 h-5" />
                  Start Working
                </>
              )}
            </button>
          )}

          {/* Task Description */}
          <Card title="Task Description">
            <p className="text-muted-foreground leading-relaxed">
              {workUnit.description || 'No description provided'}
            </p>
          </Card>

          {/* Requirements */}
          {workUnit.requirements && (
            <Card title="Requirements">
              <p className="text-muted-foreground whitespace-pre-wrap leading-relaxed">{workUnit.requirements}</p>
            </Card>
          )}

          {/* Log Work */}
          {canLog && (
            <Card title="Log Work" icon={<Timer className="w-4 h-4 text-signal" />}>
              <form onSubmit={handleLogWork} className="space-y-4">
                <div className="grid grid-cols-4 gap-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-2">Hours</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      value={logHours}
                      onChange={(e) => setLogHours(e.target.value)}
                      placeholder="0.5"
                      className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-white placeholder:text-muted-foreground focus:outline-none focus:border-signal/50 transition-all"
                      data-testid="log-hours-input"
                    />
                  </div>
                  <div className="col-span-3">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-2">Description</label>
                    <input
                      type="text"
                      value={logDescription}
                      onChange={(e) => setLogDescription(e.target.value)}
                      placeholder="What did you work on?"
                      className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-white placeholder:text-muted-foreground focus:outline-none focus:border-signal/50 transition-all"
                      data-testid="log-description-input"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={actionLoading || !logHours || !logDescription.trim()}
                  className="px-6 py-3 bg-muted border border-border rounded-xl text-muted-foreground font-medium hover:bg-muted hover:border-border disabled:opacity-50 transition-all flex items-center gap-2"
                  data-testid="log-work-btn"
                >
                  <Plus className="w-4 h-4" />
                  Log Hours
                </button>
              </form>
            </Card>
          )}

          {/* Work Logs */}
          {workLogs.length > 0 && (
            <Card title={`Work Log`} badge={`${totalHours}h total`}>
              <div className="space-y-3">
                {workLogs.map((log, i) => (
                  <div key={log.log_id || i} className="flex items-start gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                    <div className="w-12 h-12 rounded-xl bg-signal/10 flex items-center justify-center font-bold text-signal">
                      {log.hours}h
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-muted-foreground">{log.description}</p>
                      <p className="text-muted-foreground text-xs mt-1">
                        {new Date(log.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Submit Work */}
          {canSubmit && (
            <Card 
              title="Submit for Review" 
              icon={<Send className="w-4 h-4 text-signal" />}
              variant="submit"
            >
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-2">Summary *</label>
                  <textarea
                    value={submitSummary}
                    onChange={(e) => setSubmitSummary(e.target.value)}
                    placeholder="Describe what you've completed..."
                    className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-white placeholder:text-muted-foreground focus:outline-none focus:border-signal/50 h-28 resize-none transition-all"
                    data-testid="submit-summary-input"
                  />
                </div>
                
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-2">Links (optional)</label>
                  <div className="space-y-2">
                    {submitLinks.map((link, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <LinkIcon className="w-4 h-4 text-muted-foreground" />
                        <input
                          type="url"
                          value={link}
                          onChange={(e) => {
                            const newLinks = [...submitLinks];
                            newLinks[i] = e.target.value;
                            setSubmitLinks(newLinks);
                          }}
                          placeholder="https://..."
                          className="flex-1 bg-muted border border-border rounded-xl px-4 py-3 text-white placeholder:text-muted-foreground focus:outline-none focus:border-signal/50 font-mono text-sm transition-all"
                        />
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setSubmitLinks([...submitLinks, ''])}
                      className="text-sm text-muted-foreground hover:text-muted-foreground flex items-center gap-1 transition-colors"
                    >
                      <Plus className="w-3 h-3" /> Add another link
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={actionLoading || !submitSummary.trim()}
                  className="w-full bg-signal hover:bg-signal text-white rounded-xl p-4 font-semibold flex items-center justify-center gap-2 transition-all shadow-lg shadow-signal/20 disabled:opacity-50"
                  data-testid="submit-work-btn"
                >
                  {actionLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Send className="w-5 h-5" />
                      Submit for Review
                    </>
                  )}
                </button>
              </form>
            </Card>
          )}

          {/* Submitted State */}
          {isSubmitted && (
            <div className="rounded-2xl border border-amber-500/30 bg-signal/15 p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-amber-500/20 rounded-xl flex items-center justify-center">
                  <Clock className="w-6 h-6 text-amber-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-amber-400">Waiting for Review</h3>
                  <p className="text-amber-400/70 text-sm">Your work has been submitted and is being reviewed</p>
                </div>
              </div>
            </div>
          )}

          {/* Completed State */}
          {isCompleted && (
            <div className="rounded-2xl border border-emerald-500/30 bg-signal/15 p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-500/20 rounded-xl flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-emerald-400">Task Completed</h3>
                  <p className="text-emerald-400/70 text-sm">This task has been completed and validated</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN - Status Panel */}
        <div className="space-y-6">
          {/* Status */}
          <Card title="Status">
            <StatusBadge status={status} />
          </Card>

          {/* Time */}
          <Card title="Time Tracked">
            <div className="flex items-end gap-2">
              <span className="text-4xl font-bold text-white">{totalHours}</span>
              <span className="text-muted-foreground text-lg mb-1">/ {workUnit.estimated_hours}h</span>
            </div>
            <div className="mt-4">
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className={`h-full rounded-full transition-all ${
                    totalHours > workUnit.estimated_hours ? 'bg-red-500' : 'bg-signal'
                  }`}
                  style={{ width: `${Math.min((totalHours / workUnit.estimated_hours) * 100, 100)}%` }}
                />
              </div>
            </div>
          </Card>

          {/* Project */}
          <Card title="Project">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                <Folder className="w-4 h-4 text-muted-foreground" />
              </div>
              <span className="font-medium">{workUnit.project_name || 'Project'}</span>
            </div>
          </Card>

          {workUnit.scope_item_name && (
            <Card title="Feature">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                </div>
                <span className="font-medium">{workUnit.scope_item_name}</span>
              </div>
            </Card>
          )}

          {/* Submissions History */}
          {submissions.length > 0 && (
            <Card title="Submission History">
              <div className="space-y-3">
                {submissions.map((sub, i) => (
                  <div key={sub.submission_id} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${
                        sub.status === 'approved' ? 'bg-emerald-400' :
                        sub.status === 'revision_needed' ? 'bg-red-400' :
                        'bg-amber-400'
                      }`} />
                      <span className="text-sm text-muted-foreground">#{i + 1}</span>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-lg ${
                      sub.status === 'approved' ? 'bg-emerald-500/10 text-emerald-400' :
                      sub.status === 'revision_needed' ? 'bg-red-500/10 text-red-400' :
                      'bg-amber-500/10 text-amber-400'
                    }`}>
                      {sub.status.replace('_', ' ')}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

const Card = ({ title, children, icon, badge, variant }) => {
  return (
    <div className={`rounded-2xl border overflow-hidden ${
      variant === 'submit' 
        ? 'border-signal/20 bg-signal/15' 
        : 'border-border bg-[var(--t-surface-raised)]'
    }`}>
      <div className="px-5 py-4 border-b border-border bg-white/[0.03] flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</span>
        </div>
        {badge && (
          <span className="text-xs px-2 py-1 bg-signal/10 text-signal rounded-lg">{badge}</span>
        )}
      </div>
      <div className="p-5">
        {children}
      </div>
    </div>
  );
};

const StatusBadge = ({ status }) => {
  const config = {
    assigned: { label: 'New', color: 'bg-muted text-white border-border' },
    in_progress: { label: 'In Progress', color: 'bg-signal/10 text-signal border-signal/20' },
    submitted: { label: 'Submitted', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    validation: { label: 'Validating', color: 'bg-signal/10 text-signal border-signal/20' },
    revision: { label: 'Fix Required', color: 'bg-red-500/10 text-red-400 border-red-500/20' },
    completed: { label: 'Completed', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  }[status] || { label: status, color: 'bg-muted text-white border-border' };

  return (
    <span className={`inline-flex px-4 py-2 rounded-xl text-sm font-medium border ${config.color}`}>
      {config.label}
    </span>
  );
};

export default DeveloperWorkPage;
