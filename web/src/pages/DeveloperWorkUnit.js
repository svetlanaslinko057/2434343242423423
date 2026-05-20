import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import axios from 'axios';
import {
  ArrowLeft,
  Clock,
  Play,
  Send,
  Plus,
  Link,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Timer,
  ExternalLink
} from 'lucide-react';

const DeveloperWorkUnit = () => {
  const { unitId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [workUnit, setWorkUnit] = useState(null);
  const [workLogs, setWorkLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  
  // Log form
  const [logHours, setLogHours] = useState('');
  const [logDescription, setLogDescription] = useState('');
  
  // Submit form
  const [submitSummary, setSubmitSummary] = useState('');
  const [submitLinks, setSubmitLinks] = useState(['']);

  const fetchData = useCallback(async () => {
    try {
      const [unitRes, logsRes] = await Promise.all([
        axios.get(`${API}/developer/work-units`, { withCredentials: true }),
        axios.get(`${API}/developer/work-logs/${unitId}`, { withCredentials: true }).catch(() => ({ data: [] }))
      ]);
      
      const found = unitRes.data.find(u => u.unit_id === unitId);
      setWorkUnit(found);
      setWorkLogs(logsRes.data || []);
    } catch (error) {
      console.error('Error fetching work unit:', error);
    } finally {
      setLoading(false);
    }
  }, [unitId]);

  useEffect(() => {
    fetchData();
    // Polling every 15 seconds
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleStartWork = async () => {
    setSubmitting(true);
    try {
      await axios.post(`${API}/developer/work-units/${unitId}/start`, {}, { withCredentials: true });
      await fetchData();
    } catch (error) {
      console.error('Error starting work:', error);
      alert('Failed to start work');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogWork = async (e) => {
    e.preventDefault();
    if (!logHours || !logDescription.trim()) return;
    
    setSubmitting(true);
    try {
      await axios.post(`${API}/work-units/${unitId}/log`, {
        hours: parseFloat(logHours),
        description: logDescription.trim()
      }, { withCredentials: true });
      
      setLogHours('');
      setLogDescription('');
      await fetchData();
    } catch (error) {
      console.error('Error logging work:', error);
      alert('Failed to log work');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!submitSummary.trim()) return;
    
    setSubmitting(true);
    try {
      await axios.post(`${API}/work-units/${unitId}/submit`, {
        summary: submitSummary.trim(),
        links: submitLinks.filter(l => l.trim())
      }, { withCredentials: true });
      
      await fetchData();
      alert('Work submitted for review!');
    } catch (error) {
      console.error('Error submitting work:', error);
      alert('Failed to submit work');
    } finally {
      setSubmitting(false);
    }
  };

  const addLink = () => setSubmitLinks([...submitLinks, '']);
  const updateLink = (index, value) => {
    const updated = [...submitLinks];
    updated[index] = value;
    setSubmitLinks(updated);
  };

  const getStatusBadge = (status) => {
    const styles = {
      pending: 'bg-muted text-muted-foreground border-border',
      assigned: 'bg-signal/10 text-signal border-signal/20',
      in_progress: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      submitted: 'bg-signal/10 text-signal border-signal/20',
      review: 'bg-signal/10 text-signal border-signal/20',
      revision: 'bg-red-500/10 text-red-400 border-red-500/20',
      validation: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
      completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    };
    return styles[status] || styles.pending;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--t-bg)] text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (!workUnit) {
    return (
      <div className="min-h-screen bg-[var(--t-bg)] text-white flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground mb-4">Work unit not found or not assigned to you</p>
          <button onClick={() => navigate('/developer/dashboard')} className="text-white underline">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const totalLogged = workLogs.reduce((sum, log) => sum + (log.hours || 0), 0);
  const canStart = workUnit.status === 'assigned';
  const canLog = ['in_progress', 'revision'].includes(workUnit.status);
  const canSubmit = ['in_progress', 'revision'].includes(workUnit.status) && totalLogged > 0;
  const isSubmitted = ['submitted', 'review', 'validation', 'completed'].includes(workUnit.status);

  return (
    <div className="min-h-screen bg-[var(--t-bg)] text-white" data-testid="developer-work-unit">
      {/* Header */}
      <header className="border-b border-border bg-black/60 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <button 
            onClick={() => navigate('/developer/dashboard')}
            className="flex items-center gap-2 text-muted-foreground hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <span className={`px-3 py-1 text-sm border ${getStatusBadge(workUnit.status)}`}>
            {workUnit.status.replace('_', ' ')}
          </span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="space-y-8">
          {/* Header */}
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{workUnit.title}</h1>
            <div className="flex items-center gap-4 mt-3 text-muted-foreground">
              <span className="capitalize">{workUnit.unit_type}</span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {workUnit.estimated_hours}h estimated
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Timer className="w-4 h-4" />
                {totalLogged}h logged
              </span>
            </div>
          </div>

          {/* Description */}
          {workUnit.description && (
            <div className="border border-border rounded-2xl p-5 bg-white/[0.02]">
              <h2 className="text-sm text-muted-foreground mb-2">Description</h2>
              <p className="text-muted-foreground">{workUnit.description}</p>
            </div>
          )}

          {/* Revision Notice */}
          {workUnit.status === 'revision' && (
            <div className="border border-red-500/30 rounded-2xl bg-red-500/10 p-5">
              <div className="flex items-center gap-2 text-red-400 mb-2">
                <AlertCircle className="w-5 h-5" />
                <span className="font-semibold">Revision Required</span>
              </div>
              <p className="text-muted-foreground text-sm">Your submission needs changes. Please review the feedback and resubmit.</p>
            </div>
          )}

          {/* Start Work Button */}
          {canStart && (
            <button
              onClick={handleStartWork}
              disabled={submitting}
              className="w-full bg-white text-black rounded-2xl p-4 font-semibold flex items-center justify-center gap-2 hover:bg-muted disabled:opacity-50 transition-all"
              data-testid="start-work-btn"
            >
              {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Play className="w-5 h-5" /> Start Working</>}
            </button>
          )}

          {/* Work Logs */}
          <div className="border border-border rounded-2xl p-5">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-muted-foreground" />
              Work Log
            </h2>

            {canLog && (
              <form onSubmit={handleLogWork} className="mb-6 p-4 bg-white/[0.02] border border-border rounded-xl">
                <div className="grid grid-cols-4 gap-4 mb-4">
                  <div>
                    <label className="block text-sm text-muted-foreground mb-2">Hours *</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      value={logHours}
                      onChange={(e) => setLogHours(e.target.value)}
                      placeholder="2"
                      className="w-full bg-muted border border-border rounded-xl p-3 text-white"
                      data-testid="log-hours-input"
                    />
                  </div>
                  <div className="col-span-3">
                    <label className="block text-sm text-muted-foreground mb-2">What did you do? *</label>
                    <input
                      type="text"
                      value={logDescription}
                      onChange={(e) => setLogDescription(e.target.value)}
                      placeholder="Implemented login endpoint..."
                      className="w-full bg-muted border border-border rounded-xl p-3 text-white"
                      data-testid="log-description-input"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={submitting || !logHours || !logDescription.trim()}
                  className="bg-muted text-white px-4 py-2 text-sm font-medium rounded-xl hover:bg-muted disabled:opacity-50 transition-all flex items-center gap-2"
                  data-testid="log-work-btn"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4" /> Log Work</>}
                </button>
              </form>
            )}

            {workLogs.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No work logged yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {workLogs.map((log, i) => (
                  <div key={log.log_id || i} className="flex items-start gap-4 p-3 bg-white/[0.02] rounded-xl">
                    <div className="w-12 h-12 bg-muted rounded-xl flex items-center justify-center text-lg font-bold">
                      {log.hours}h
                    </div>
                    <div className="flex-1">
                      <p className="text-muted-foreground">{log.description}</p>
                      <p className="text-muted-foreground text-xs mt-1">
                        {new Date(log.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Submit Work */}
          {canSubmit && (
            <div className="border border-emerald-500/30 rounded-2xl bg-emerald-500/5 p-5">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-emerald-400">
                <Send className="w-5 h-5" />
                Submit Work
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm text-muted-foreground mb-2">Summary *</label>
                  <textarea
                    value={submitSummary}
                    onChange={(e) => setSubmitSummary(e.target.value)}
                    placeholder="Describe what you've completed..."
                    className="w-full bg-muted border border-border rounded-xl p-3 text-white h-24 resize-none"
                    data-testid="submit-summary-input"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm text-muted-foreground">Links (GitHub, Preview, etc.)</label>
                    <button type="button" onClick={addLink} className="text-muted-foreground hover:text-white text-sm flex items-center gap-1">
                      <Plus className="w-4 h-4" /> Add Link
                    </button>
                  </div>
                  <div className="space-y-2">
                    {submitLinks.map((link, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Link className="w-4 h-4 text-muted-foreground" />
                        <input
                          type="url"
                          value={link}
                          onChange={(e) => updateLink(i, e.target.value)}
                          placeholder="https://github.com/..."
                          className="flex-1 bg-muted border border-border rounded-xl p-2 text-white text-sm"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting || !submitSummary.trim()}
                  className="w-full bg-emerald-500 text-white rounded-xl p-3 font-semibold flex items-center justify-center gap-2 hover:bg-emerald-600 disabled:opacity-50 transition-all"
                  data-testid="submit-work-btn"
                >
                  {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Send className="w-5 h-5" /> Submit for Review</>}
                </button>
              </form>
            </div>
          )}

          {/* Submitted State */}
          {isSubmitted && (
            <div className="border border-signal/30 rounded-2xl bg-signal/5 p-5 text-center">
              <CheckCircle2 className="w-12 h-12 text-signal mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-signal">Work Submitted</h3>
              <p className="text-muted-foreground text-sm mt-1">
                {workUnit.status === 'completed' 
                  ? 'This work unit is complete!' 
                  : 'Waiting for review and validation'}
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default DeveloperWorkUnit;
