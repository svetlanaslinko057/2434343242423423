import { useState, useEffect } from 'react';
import { API } from '@/App';
import axios from 'axios';
import { Loader2, User, Star, Clock, CheckCircle2, Zap } from 'lucide-react';

const AssignmentPanel = ({ workUnitId, onAssigned }) => {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(null);

  useEffect(() => {
    const fetchCandidates = async () => {
      try {
        const res = await axios.get(`${API}/admin/assignment-engine/${workUnitId}/candidates`, {
          withCredentials: true
        });
        setCandidates(res.data);
      } catch (error) {
        console.error('Error fetching candidates:', error);
      } finally {
        setLoading(false);
      }
    };
    
    if (workUnitId) {
      fetchCandidates();
    }
  }, [workUnitId]);

  const handleAssign = async (developerId) => {
    setAssigning(developerId);
    try {
      await axios.post(`${API}/admin/assignment-engine/${workUnitId}/assign`, {
        developer_id: developerId
      }, { withCredentials: true });
      
      if (onAssigned) onAssigned();
    } catch (error) {
      console.error('Error assigning:', error);
      alert('Failed to assign developer');
    } finally {
      setAssigning(null);
    }
  };

  const handleAssignBest = async () => {
    if (candidates.length === 0) return;
    
    setAssigning('best');
    try {
      await axios.post(`${API}/admin/assignment-engine/${workUnitId}/assign-best`, {}, {
        withCredentials: true
      });
      
      if (onAssigned) onAssigned();
    } catch (error) {
      console.error('Error assigning:', error);
      alert('Failed to assign developer');
    } finally {
      setAssigning(null);
    }
  };

  if (loading) {
    return (
      <div className="border border-border p-5 bg-white/[0.02]">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="border border-border p-5 bg-white/[0.02]" data-testid="assignment-panel">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Assignment</h3>
        {candidates.length > 0 && (
          <button
            onClick={handleAssignBest}
            disabled={assigning === 'best'}
            className="bg-white text-black px-4 py-2 text-sm font-medium flex items-center gap-2 hover:bg-muted disabled:opacity-50 transition-all"
          >
            {assigning === 'best' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Zap className="w-4 h-4" />
                Assign Best Match
              </>
            )}
          </button>
        )}
      </div>

      {candidates.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground">
          <User className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No available developers found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {candidates.map((candidate, index) => (
            <div
              key={candidate.developer.user_id}
              className={`border p-4 transition-all ${
                index === 0 
                  ? 'border-emerald-500/30 bg-emerald-500/5' 
                  : 'border-border hover:border-border'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
                    {candidate.developer.name?.[0] || candidate.developer.email?.[0]}
                  </div>
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {candidate.developer.name || candidate.developer.email}
                      {index === 0 && (
                        <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5">
                          Best Match
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                      <span className="capitalize">{candidate.developer.level}</span>
                      <span className="flex items-center gap-1">
                        <Star className="w-3 h-3" />
                        {candidate.developer.rating?.toFixed(1) || '5.0'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-lg font-bold text-muted-foreground">
                    {(candidate.score * 100).toFixed(0)}%
                  </div>
                  <div className="text-xs text-muted-foreground">match</div>
                </div>
              </div>

              {/* Skills */}
              {candidate.developer.skills?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {candidate.developer.skills.slice(0, 5).map((skill) => (
                    <span
                      key={skill}
                      className="text-xs px-2 py-1 bg-muted border border-border text-muted-foreground"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              )}

              {/* Reasons */}
              {candidate.reasons?.length > 0 && (
                <div className="mt-3 space-y-1">
                  {candidate.reasons.map((reason, i) => (
                    <div key={i} className="text-xs text-muted-foreground flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      {reason}
                    </div>
                  ))}
                </div>
              )}

              {/* Stats */}
              <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {candidate.developer.active_load || 0}h active load
                </span>
                <span>
                  {candidate.developer.completed_tasks || 0} tasks completed
                </span>
              </div>

              {/* Assign Button */}
              <button
                onClick={() => handleAssign(candidate.developer.user_id)}
                disabled={assigning === candidate.developer.user_id}
                className="mt-3 w-full py-2 border border-border text-sm hover:bg-muted disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              >
                {assigning === candidate.developer.user_id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Assign'
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AssignmentPanel;
