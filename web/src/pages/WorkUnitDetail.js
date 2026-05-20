import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import axios from 'axios';
import AssignmentPanel from '@/components/AssignmentPanel';
import {
  ArrowLeft,
  User,
  Clock,
  CheckCircle2,
  XCircle,
  Play,
  FileText,
  MessageSquare,
  Loader2
} from 'lucide-react';

const WorkUnitDetail = () => {
  const { unitId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [workUnit, setWorkUnit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAssignment, setShowAssignment] = useState(false);

  const fetchWorkUnit = async () => {
    try {
      const res = await axios.get(`${API}/admin/work-units`, { withCredentials: true });
      const found = res.data.find(u => u.unit_id === unitId);
      setWorkUnit(found);
    } catch (error) {
      console.error('Error fetching work unit:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkUnit();
  }, [unitId]);

  const getStatusBadge = (status) => {
    const styles = {
      pending: 'bg-muted text-muted-foreground border-border',
      assigned: 'bg-signal/10 text-signal border-signal/20',
      in_progress: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      submitted: 'bg-signal/10 text-signal border-signal/20',
      review: 'bg-signal/10 text-signal border-signal/20',
      validation: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
      completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    };
    return styles[status] || 'bg-muted text-muted-foreground border-border';
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
          <p className="text-muted-foreground mb-4">Work unit not found</p>
          <button onClick={() => navigate(-1)} className="text-white underline">Go Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--t-bg)] text-white" data-testid="work-unit-detail">
      {/* Header */}
      <header className="border-b border-border bg-black/60 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <button 
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-muted-foreground hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <span className="text-lg font-bold tracking-tight">Work Unit</span>
          <div className="w-16" />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Header */}
            <div className="border border-border p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h1 className="text-2xl font-bold">{workUnit.title}</h1>
                  <div className="flex items-center gap-3 mt-2">
                    <span className={`px-2 py-1 text-xs border ${getStatusBadge(workUnit.status)}`}>
                      {workUnit.status.replace('_', ' ')}
                    </span>
                    <span className="text-muted-foreground text-sm">{workUnit.unit_type}</span>
                  </div>
                </div>
              </div>
              
              {workUnit.description && (
                <p className="mt-4 text-muted-foreground">{workUnit.description}</p>
              )}
            </div>

            {/* Hours */}
            <div className="grid grid-cols-2 gap-4">
              <div className="border border-border p-5">
                <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                  <Clock className="w-4 h-4" />
                  Estimated
                </div>
                <div className="text-2xl font-bold">{workUnit.estimated_hours}h</div>
              </div>
              <div className="border border-border p-5">
                <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                  <Clock className="w-4 h-4" />
                  Actual
                </div>
                <div className="text-2xl font-bold">{workUnit.actual_hours}h</div>
              </div>
            </div>

            {/* Assignment */}
            {workUnit.assigned_to ? (
              <div className="border border-border p-5">
                <h3 className="font-semibold mb-3">Assigned To</h3>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
                    <User className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="font-medium">{workUnit.assigned_to}</div>
                    <div className="text-muted-foreground text-sm">Developer</div>
                  </div>
                </div>
                <button 
                  onClick={() => setShowAssignment(true)}
                  className="mt-4 w-full py-2 border border-border text-sm hover:bg-muted transition-all"
                >
                  Reassign
                </button>
              </div>
            ) : (
              <div>
                {showAssignment ? (
                  <AssignmentPanel 
                    workUnitId={workUnit.unit_id} 
                    onAssigned={() => {
                      setShowAssignment(false);
                      fetchWorkUnit();
                    }}
                  />
                ) : (
                  <div className="border border-amber-500/30 bg-amber-500/5 p-5">
                    <h3 className="font-semibold mb-2 text-amber-400">Not Assigned</h3>
                    <p className="text-muted-foreground text-sm mb-4">This work unit needs to be assigned to a developer</p>
                    <button 
                      onClick={() => setShowAssignment(true)}
                      className="bg-white text-black px-4 py-2 text-sm font-medium hover:bg-muted transition-all"
                    >
                      Assign Developer
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Info */}
            <div className="border border-border p-5">
              <h3 className="font-semibold mb-4">Info</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Unit ID</span>
                  <span className="font-mono text-xs">{workUnit.unit_id.slice(-8)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span className="capitalize">{workUnit.status.replace('_', ' ')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <span className="capitalize">{workUnit.unit_type}</span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="border border-border p-5">
              <h3 className="font-semibold mb-4">Actions</h3>
              <div className="space-y-2">
                {workUnit.status === 'submitted' && (
                  <>
                    <button className="w-full py-2 bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-all flex items-center justify-center gap-2">
                      <CheckCircle2 className="w-4 h-4" />
                      Approve
                    </button>
                    <button className="w-full py-2 bg-amber-500 text-black text-sm font-medium hover:bg-amber-600 transition-all flex items-center justify-center gap-2">
                      <XCircle className="w-4 h-4" />
                      Request Revision
                    </button>
                  </>
                )}
                {workUnit.status === 'review' && (
                  <button className="w-full py-2 bg-signal text-white text-sm font-medium hover:bg-signal transition-all flex items-center justify-center gap-2">
                    <FileText className="w-4 h-4" />
                    Send to Validation
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default WorkUnitDetail;
