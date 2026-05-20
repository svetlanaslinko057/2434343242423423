import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import axios from 'axios';
import {
  ArrowLeft,
  TestTube,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ExternalLink,
  Plus,
  Loader2,
  Bug,
  Clock
} from 'lucide-react';

const TesterValidation = () => {
  const { validationId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [validation, setValidation] = useState(null);
  const [workUnit, setWorkUnit] = useState(null);
  const [submission, setSubmission] = useState(null);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  
  // Issue form
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [issueTitle, setIssueTitle] = useState('');
  const [issueDescription, setIssueDescription] = useState('');
  const [issueSeverity, setIssueSeverity] = useState('medium');

  const fetchData = useCallback(async () => {
    try {
      const [tasksRes] = await Promise.all([
        axios.get(`${API}/tester/validation-tasks`, { withCredentials: true })
      ]);
      
      const found = tasksRes.data.find(t => t.validation_id === validationId);
      setValidation(found);
      
      // Get linked work unit and submission info
      if (found) {
        try {
          const [unitRes, issuesRes] = await Promise.all([
            axios.get(`${API}/tester/validation/${validationId}/details`, { withCredentials: true }).catch(() => null),
            axios.get(`${API}/tester/validation/${validationId}/issues`, { withCredentials: true }).catch(() => ({ data: [] }))
          ]);
          if (unitRes) {
            setWorkUnit(unitRes.data.work_unit);
            setSubmission(unitRes.data.submission);
          }
          setIssues(issuesRes.data || []);
        } catch (e) {
          console.log('Details fetch error:', e);
        }
      }
    } catch (error) {
      console.error('Error fetching validation:', error);
    } finally {
      setLoading(false);
    }
  }, [validationId]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handlePass = async () => {
    setActionLoading(true);
    try {
      await axios.post(`${API}/validation/${validationId}/pass`, {}, { withCredentials: true });
      navigate('/tester/dashboard');
    } catch (error) {
      console.error('Error passing validation:', error);
      alert('Failed to pass validation');
    } finally {
      setActionLoading(false);
    }
  };

  const handleFail = async () => {
    if (issues.length === 0) {
      alert('Please report at least one issue before failing validation');
      return;
    }
    
    setActionLoading(true);
    try {
      await axios.post(`${API}/validation/${validationId}/fail`, {}, { withCredentials: true });
      navigate('/tester/dashboard');
    } catch (error) {
      console.error('Error failing validation:', error);
      alert('Failed to fail validation');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddIssue = async (e) => {
    e.preventDefault();
    if (!issueTitle.trim()) return;
    
    setActionLoading(true);
    try {
      await axios.post(`${API}/validation/${validationId}/issue`, {
        title: issueTitle.trim(),
        description: issueDescription.trim(),
        severity: issueSeverity
      }, { withCredentials: true });
      
      setIssueTitle('');
      setIssueDescription('');
      setIssueSeverity('medium');
      setShowIssueForm(false);
      await fetchData();
    } catch (error) {
      console.error('Error adding issue:', error);
      alert('Failed to add issue');
    } finally {
      setActionLoading(false);
    }
  };

  const getSeverityBadge = (severity) => {
    const styles = {
      low: 'bg-signal/10 text-signal border-signal/20',
      medium: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      high: 'bg-red-500/10 text-red-400 border-red-500/20',
      critical: 'bg-red-600/20 text-red-300 border-red-500/30',
    };
    return styles[severity] || styles.medium;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--t-bg)] text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (!validation) {
    return (
      <div className="min-h-screen bg-[var(--t-bg)] text-white flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground mb-4">Validation task not found</p>
          <button onClick={() => navigate('/tester/dashboard')} className="text-white underline">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const canAct = ['pending', 'in_progress'].includes(validation.status);

  return (
    <div className="min-h-screen bg-[var(--t-bg)] text-white" data-testid="tester-validation">
      {/* Header */}
      <header className="border-b border-border bg-black/60 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <button 
            onClick={() => navigate('/tester/dashboard')}
            className="flex items-center gap-2 text-muted-foreground hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="flex items-center gap-2">
            <TestTube className="w-5 h-5 text-signal" />
            <span className="font-medium">Validation</span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Work Unit Info */}
            <div className="border border-border p-6">
              <h1 className="text-2xl font-bold mb-2">{workUnit?.title || `Task #${validation.unit_id?.slice(-6)}`}</h1>
              {workUnit?.description && (
                <p className="text-muted-foreground mb-4">{workUnit.description}</p>
              )}
              
              {/* Submission Info */}
              {submission && (
                <div className="mt-4 p-4 bg-white/[0.02] border border-border">
                  <h3 className="text-sm text-muted-foreground mb-2">Developer Submission</h3>
                  <p className="text-muted-foreground mb-3">{submission.summary}</p>
                  
                  {submission.links?.length > 0 && (
                    <div className="space-y-2">
                      {submission.links.map((link, i) => (
                        <a
                          key={i}
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-signal hover:text-signal text-sm"
                        >
                          <ExternalLink className="w-4 h-4" />
                          {link}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Issues */}
            <div className="border border-border p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Bug className="w-5 h-5 text-red-400" />
                  Issues ({issues.length})
                </h2>
                {canAct && (
                  <button
                    onClick={() => setShowIssueForm(!showIssueForm)}
                    className="text-muted-foreground hover:text-white text-sm flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" />
                    Report Issue
                  </button>
                )}
              </div>

              {/* Issue Form */}
              {showIssueForm && (
                <form onSubmit={handleAddIssue} className="mb-6 p-4 bg-red-500/5 border border-red-500/20">
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={issueTitle}
                      onChange={(e) => setIssueTitle(e.target.value)}
                      placeholder="Issue title..."
                      className="w-full bg-muted border border-border p-3 text-white"
                    />
                    <textarea
                      value={issueDescription}
                      onChange={(e) => setIssueDescription(e.target.value)}
                      placeholder="Describe the issue..."
                      className="w-full bg-muted border border-border p-3 text-white h-20 resize-none"
                    />
                    <div className="flex items-center gap-4">
                      <select
                        value={issueSeverity}
                        onChange={(e) => setIssueSeverity(e.target.value)}
                        className="bg-muted border border-border p-2 text-white"
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </select>
                      <button
                        type="submit"
                        disabled={actionLoading || !issueTitle.trim()}
                        className="bg-red-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
                      >
                        Add Issue
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {issues.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No issues reported</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {issues.map((issue) => (
                    <div key={issue.issue_id} className="p-4 border border-border bg-white/[0.02]">
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-medium">{issue.title}</h4>
                          {issue.description && (
                            <p className="text-muted-foreground text-sm mt-1">{issue.description}</p>
                          )}
                        </div>
                        <span className={`px-2 py-0.5 text-xs border ${getSeverityBadge(issue.severity)}`}>
                          {issue.severity}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Sidebar - Actions */}
          <div className="space-y-6">
            {canAct && (
              <div className="border border-border p-6">
                <h3 className="font-semibold mb-4">Validation Result</h3>
                <div className="space-y-3">
                  <button
                    onClick={handlePass}
                    disabled={actionLoading}
                    className="w-full bg-emerald-500 text-white p-3 font-medium flex items-center justify-center gap-2 hover:bg-emerald-600 disabled:opacity-50 transition-all"
                  >
                    {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><CheckCircle2 className="w-5 h-5" /> Pass</>}
                  </button>
                  <button
                    onClick={handleFail}
                    disabled={actionLoading || issues.length === 0}
                    className="w-full bg-red-500 text-white p-3 font-medium flex items-center justify-center gap-2 hover:bg-red-600 disabled:opacity-50 transition-all"
                  >
                    {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><XCircle className="w-5 h-5" /> Fail</>}
                  </button>
                  {issues.length === 0 && (
                    <p className="text-muted-foreground text-xs text-center">Report at least one issue to fail</p>
                  )}
                </div>
              </div>
            )}

            {/* Info */}
            <div className="border border-border p-6">
              <h3 className="font-semibold mb-4">Info</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span className="capitalize">{validation.status.replace('_', ' ')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Issues</span>
                  <span>{issues.length}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default TesterValidation;
