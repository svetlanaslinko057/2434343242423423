import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import axios from 'axios';
import {
  FileCheck,
  CheckCircle2,
  XCircle,
  ExternalLink,
  User,
  Clock,
  ArrowRight,
  Loader2,
  MessageSquare,
  AlertTriangle
} from 'lucide-react';

const AdminReviewQueue = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [submissions, setSubmissions] = useState([]);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState('');

  const fetchSubmissions = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/admin/submissions`, { withCredentials: true });
      setSubmissions(res.data);
    } catch (error) {
      console.error('Error fetching submissions:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSubmissions();
    // Polling every 10 seconds
    const interval = setInterval(fetchSubmissions, 10000);
    return () => clearInterval(interval);
  }, [fetchSubmissions]);

  const handleApprove = async (submissionId) => {
    setActionLoading(true);
    try {
      await axios.post(`${API}/admin/review`, {
        submission_id: submissionId,
        result: 'approved',
        feedback: feedback || 'Approved'
      }, { withCredentials: true });
      
      setSelectedSubmission(null);
      setFeedback('');
      await fetchSubmissions();
    } catch (error) {
      console.error('Error approving:', error);
      alert('Failed to approve');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRequestRevision = async (submissionId) => {
    if (!feedback.trim()) {
      alert('Please provide feedback for revision');
      return;
    }
    
    setActionLoading(true);
    try {
      await axios.post(`${API}/admin/review`, {
        submission_id: submissionId,
        result: 'revision_needed',
        feedback: feedback.trim()
      }, { withCredentials: true });
      
      setSelectedSubmission(null);
      setFeedback('');
      await fetchSubmissions();
    } catch (error) {
      console.error('Error requesting revision:', error);
      alert('Failed to request revision');
    } finally {
      setActionLoading(false);
    }
  };

  const pendingSubmissions = submissions.filter(s => s.status === 'pending');

  return (
    <div className="space-y-6" data-testid="review-queue">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Review Queue</h2>
          <p className="text-muted-foreground text-sm">{pendingSubmissions.length} submissions pending review</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : pendingSubmissions.length === 0 ? (
        <div className="border border-border border-dashed rounded-2xl p-12 text-center">
          <FileCheck className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No pending submissions</h3>
          <p className="text-muted-foreground text-sm">New submissions will appear here</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Submissions List */}
          <div className="space-y-3">
            {pendingSubmissions.map((submission) => (
              <button
                key={submission.submission_id}
                onClick={() => setSelectedSubmission(submission)}
                className={`w-full text-left border rounded-2xl p-5 transition-all ${
                  selectedSubmission?.submission_id === submission.submission_id
                    ? 'border-white bg-muted'
                    : 'border-border hover:border-border'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-medium">{submission.work_unit_title || `Submission #${submission.submission_id.slice(-6)}`}</h3>
                    <div className="flex items-center gap-2 mt-1 text-muted-foreground text-sm">
                      <User className="w-3 h-3" />
                      <span>{submission.developer_name || submission.developer_id}</span>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                </div>
                <p className="text-muted-foreground text-sm line-clamp-2">{submission.summary}</p>
                <div className="flex items-center gap-2 mt-3 text-muted-foreground text-xs">
                  <Clock className="w-3 h-3" />
                  <span>{new Date(submission.created_at).toLocaleString()}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Submission Detail */}
          {selectedSubmission && (
            <div className="border border-border rounded-2xl p-6 bg-white/[0.02] sticky top-20">
              <h3 className="text-lg font-semibold mb-4">
                {selectedSubmission.work_unit_title || `Submission #${selectedSubmission.submission_id.slice(-6)}`}
              </h3>

              {/* Developer Info */}
              <div className="flex items-center gap-3 p-3 bg-muted rounded-xl mb-4">
                <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
                  <User className="w-5 h-5 text-muted-foreground" />
                </div>
                <div>
                  <div className="font-medium">{selectedSubmission.developer_name || 'Developer'}</div>
                  <div className="text-muted-foreground text-sm">{selectedSubmission.developer_id}</div>
                </div>
              </div>

              {/* Summary */}
              <div className="mb-4">
                <h4 className="text-sm text-muted-foreground mb-2">Summary</h4>
                <p className="text-muted-foreground">{selectedSubmission.summary}</p>
              </div>

              {/* Links */}
              {selectedSubmission.links?.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm text-muted-foreground mb-2">Links</h4>
                  <div className="space-y-2">
                    {selectedSubmission.links.map((link, i) => (
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
                </div>
              )}

              {/* Feedback */}
              <div className="mb-4">
                <h4 className="text-sm text-muted-foreground mb-2">Feedback (required for revision)</h4>
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Add feedback for the developer..."
                  className="w-full bg-muted border border-border rounded-xl p-3 text-white h-24 resize-none"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => handleApprove(selectedSubmission.submission_id)}
                  disabled={actionLoading}
                  className="flex-1 bg-emerald-500 text-white rounded-xl p-3 font-medium flex items-center justify-center gap-2 hover:bg-emerald-600 disabled:opacity-50 transition-all"
                >
                  {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><CheckCircle2 className="w-5 h-5" /> Approve</>}
                </button>
                <button
                  onClick={() => handleRequestRevision(selectedSubmission.submission_id)}
                  disabled={actionLoading}
                  className="flex-1 bg-amber-500 text-black rounded-xl p-3 font-medium flex items-center justify-center gap-2 hover:bg-amber-600 disabled:opacity-50 transition-all"
                >
                  {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><AlertTriangle className="w-5 h-5" /> Request Revision</>}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminReviewQueue;
