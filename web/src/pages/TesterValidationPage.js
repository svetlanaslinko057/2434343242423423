import { useState, useEffect } from 'react';
import { useAuth, API } from '@/App';
import axios from 'axios';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Play,
  Eye,
  Send,
  Plus,
  Trash2,
  Loader2,
  Bug,
  Shield,
  FileCode
} from 'lucide-react';

const TesterValidationPage = () => {
  const { user } = useAuth();
  const [validations, setValidations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedValidation, setSelectedValidation] = useState(null);
  const [issues, setIssues] = useState([]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchValidations();
  }, []);

  const fetchValidations = async () => {
    try {
      const res = await axios.get(`${API}/tester/validations`, { withCredentials: true });
      setValidations(res.data || []);
    } catch (error) {
      console.error('Error fetching validations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStartValidation = async (validationId) => {
    try {
      await axios.post(`${API}/validation/${validationId}/start`, {}, { withCredentials: true });
      fetchValidations();
    } catch (error) {
      alert('Failed to start validation');
    }
  };

  const handlePass = async () => {
    if (!selectedValidation) return;
    setSubmitting(true);
    try {
      await axios.post(
        `${API}/validation/${selectedValidation.validation_id}/pass?notes=${encodeURIComponent(notes)}`,
        {},
        { withCredentials: true }
      );
      setSelectedValidation(null);
      setNotes('');
      fetchValidations();
    } catch (error) {
      alert('Failed to pass validation');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFail = async () => {
    if (!selectedValidation || issues.length === 0) {
      alert('Add at least one issue');
      return;
    }
    setSubmitting(true);
    try {
      await axios.post(
        `${API}/validation/${selectedValidation.validation_id}/fail`,
        { issues, notes },
        { withCredentials: true }
      );
      setSelectedValidation(null);
      setIssues([]);
      setNotes('');
      fetchValidations();
    } catch (error) {
      alert('Failed to submit validation');
    } finally {
      setSubmitting(false);
    }
  };

  const addIssue = () => {
    setIssues([...issues, { title: '', description: '', severity: 'medium' }]);
  };

  const updateIssue = (index, field, value) => {
    const updated = [...issues];
    updated[index][field] = value;
    setIssues(updated);
  };

  const removeIssue = (index) => {
    setIssues(issues.filter((_, i) => i !== index));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const pendingValidations = validations.filter(v => v.status === 'pending');
  const inProgressValidations = validations.filter(v => v.status === 'in_progress');

  return (
    <div className="space-y-6" data-testid="tester-validation-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-3">
            <Shield className="w-7 h-7 text-signal" />
            QA Validation
          </h1>
          <p className="text-muted-foreground mt-1">Review and validate completed work units</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="px-4 py-2 bg-amber-500/10 text-amber-400 rounded-xl text-sm">
            {pendingValidations.length} Pending
          </div>
          <div className="px-4 py-2 bg-signal/10 text-signal rounded-xl text-sm">
            {inProgressValidations.length} In Progress
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Validation List */}
        <div className="space-y-4">
          <h2 className="text-lg font-medium text-muted-foreground">Validation Queue</h2>
          
          {validations.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground border border-border rounded-xl">
              <Shield className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No validations pending</p>
            </div>
          ) : (
            <div className="space-y-3">
              {validations.map(validation => (
                <div
                  key={validation.validation_id}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    selectedValidation?.validation_id === validation.validation_id
                      ? 'border-signal bg-signal/10'
                      : validation.status === 'pending'
                      ? 'border-amber-500/30 bg-amber-500/5 hover:border-amber-500/50'
                      : validation.status === 'in_progress'
                      ? 'border-signal/30 bg-signal/5 hover:border-signal/50'
                      : validation.status === 'passed'
                      ? 'border-emerald-500/30 bg-emerald-500/5'
                      : 'border-red-500/30 bg-red-500/5'
                  }`}
                  onClick={() => setSelectedValidation(validation)}
                  data-testid={`validation-item-${validation.validation_id}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        validation.status === 'pending' ? 'bg-amber-500/20' :
                        validation.status === 'in_progress' ? 'bg-signal/20' :
                        validation.status === 'passed' ? 'bg-emerald-500/20' :
                        'bg-red-500/20'
                      }`}>
                        {validation.status === 'pending' ? <Clock className="w-5 h-5 text-amber-400" /> :
                         validation.status === 'in_progress' ? <Eye className="w-5 h-5 text-signal" /> :
                         validation.status === 'passed' ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> :
                         <XCircle className="w-5 h-5 text-red-400" />}
                      </div>
                      <div>
                        <h3 className="font-medium text-white">
                          {validation.work_unit?.title || 'Work Unit'}
                        </h3>
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {validation.work_unit?.description || 'No description'}
                        </p>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      validation.status === 'pending' ? 'bg-amber-500/20 text-amber-400' :
                      validation.status === 'in_progress' ? 'bg-signal/20 text-signal' :
                      validation.status === 'passed' ? 'bg-emerald-500/20 text-emerald-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>
                      {validation.status}
                    </span>
                  </div>

                  {validation.status === 'pending' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleStartValidation(validation.validation_id); }}
                      className="mt-3 w-full py-2 bg-signal/20 hover:bg-signal/30 text-signal rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
                    >
                      <Play className="w-4 h-4" />
                      Start Validation
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Validation Form */}
        <div className="space-y-4">
          {selectedValidation && selectedValidation.status === 'in_progress' ? (
            <div className="p-6 rounded-xl border border-border bg-[var(--t-surface-raised)]">
              <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
                <FileCode className="w-5 h-5 text-signal" />
                Validate: {selectedValidation.work_unit?.title}
              </h2>

              {/* Notes */}
              <div className="mb-6">
                <label className="block text-sm text-muted-foreground mb-2">Tester Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add any notes about this validation..."
                  className="w-full h-24 bg-black/30 border border-border rounded-xl p-3 text-white text-sm placeholder:text-muted-foreground focus:outline-none focus:border-signal/50"
                />
              </div>

              {/* Issues */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm text-muted-foreground">Issues Found</label>
                  <button
                    onClick={addIssue}
                    className="text-sm text-signal hover:text-signal flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" />
                    Add Issue
                  </button>
                </div>

                {issues.length === 0 ? (
                  <div className="p-4 text-center text-muted-foreground border border-dashed border-border rounded-xl text-sm">
                    No issues found = Ready to pass
                  </div>
                ) : (
                  <div className="space-y-3">
                    {issues.map((issue, index) => (
                      <div key={index} className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                        <div className="flex items-start justify-between mb-3">
                          <input
                            value={issue.title}
                            onChange={(e) => updateIssue(index, 'title', e.target.value)}
                            placeholder="Issue title"
                            className="flex-1 bg-transparent text-white font-medium focus:outline-none"
                          />
                          <button onClick={() => removeIssue(index)} className="text-red-400 hover:text-red-300">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <textarea
                          value={issue.description}
                          onChange={(e) => updateIssue(index, 'description', e.target.value)}
                          placeholder="Describe the issue..."
                          className="w-full bg-transparent text-sm text-muted-foreground focus:outline-none resize-none"
                          rows={2}
                        />
                        <div className="flex gap-2 mt-2">
                          {['low', 'medium', 'high', 'critical'].map(sev => (
                            <button
                              key={sev}
                              onClick={() => updateIssue(index, 'severity', sev)}
                              className={`px-2 py-1 text-xs rounded ${
                                issue.severity === sev
                                  ? sev === 'critical' ? 'bg-red-500 text-white' :
                                    sev === 'high' ? 'bg-orange-500 text-white' :
                                    sev === 'medium' ? 'bg-amber-500 text-black' :
                                    'bg-signal text-white'
                                  : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {sev}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={handlePass}
                  disabled={submitting || issues.length > 0}
                  className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
                  data-testid="pass-validation-btn"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Pass
                </button>
                <button
                  onClick={handleFail}
                  disabled={submitting || issues.length === 0}
                  className="flex-1 py-3 bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
                  data-testid="fail-validation-btn"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                  Fail ({issues.length} issues)
                </button>
              </div>
            </div>
          ) : selectedValidation ? (
            <div className="p-6 rounded-xl border border-border bg-[var(--t-surface-raised)] text-center">
              <p className="text-muted-foreground">
                {selectedValidation.status === 'pending' 
                  ? 'Click "Start Validation" to begin'
                  : `Validation ${selectedValidation.status}`}
              </p>
            </div>
          ) : (
            <div className="p-12 rounded-xl border border-border bg-[var(--t-surface-raised)] text-center text-muted-foreground">
              <Bug className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Select a validation to review</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TesterValidationPage;
