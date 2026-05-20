import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import axios from 'axios';
import {
  Play,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Zap,
  ArrowRight,
  BarChart3,
  Target,
  TrendingUp
} from 'lucide-react';
import AIRecommendationsPanel from '@/components/AIRecommendationsPanel';

const DeveloperHub = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [workUnits, setWorkUnits] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await axios.get(`${API}/developer/work-units`, { withCredentials: true });
        setWorkUnits(res.data);
      } catch (error) {
        console.error('Error fetching work units:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const activeUnits = workUnits.filter(u => ['assigned', 'in_progress'].includes(u.status));
  const reviewUnits = workUnits.filter(u => ['submitted', 'validation'].includes(u.status));
  const revisionUnits = workUnits.filter(u => u.status === 'revision');
  const completedUnits = workUnits.filter(u => u.status === 'completed');
  const nextTask = revisionUnits[0] || activeUnits[0] || null;
  const totalHours = workUnits.reduce((sum, u) => sum + (u.actual_hours || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-border border-t-success rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8 max-w-5xl mx-auto" data-testid="developer-hub">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight mb-2">
          Welcome back, {user?.name?.split(' ')[0] || 'Developer'}
        </h1>
        <p className="text-muted-foreground">Here's what needs your attention today</p>
      </div>

      {/* AI Recommendations */}
      <div className="mb-8">
        <AIRecommendationsPanel compact />
      </div>

      {/* Revision Alert - Primary Action */}
      {revisionUnits.length > 0 && (
        <section className="mb-8">
          <div className="rounded-2xl bg-signal/15 border border-danger/30 p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-danger/20 rounded-xl flex items-center justify-center">
                  <AlertCircle className="w-6 h-6 text-danger" />
                </div>
                <div>
                  <h3 className="font-semibold text-danger">Revision Required</h3>
                  <p className="text-danger/70 text-sm">{revisionUnits.length} task{revisionUnits.length > 1 ? 's' : ''} need fixes</p>
                </div>
              </div>
              <button
                onClick={() => navigate(`/developer/work/${revisionUnits[0].unit_id}`)}
                className="px-6 py-3 bg-danger hover:bg-danger/90 text-danger-ink font-semibold rounded-xl transition-all shadow-lg flex items-center gap-2"
                data-testid="fix-now-btn"
              >
                Fix Now
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Next Task - Hero */}
      <section className="mb-8">
        {nextTask ? (
          <div className="rounded-2xl bg-card border border-border p-8 relative overflow-hidden">
            
            <div className="relative">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-5 h-5 text-success" />
                <span className="text-sm font-medium text-muted-foreground">
                  {nextTask.status === 'revision' ? 'Fix Required' : 'Next Task'}
                </span>
              </div>
              
              <h2 className="text-2xl font-semibold mb-2">{nextTask.title}</h2>
              <div className="flex items-center gap-4 text-sm text-muted-foreground mb-6">
                <span className="capitalize">{nextTask.unit_type || 'Task'}</span>
                <span className="w-1 h-1 rounded-full bg-muted" />
                <span>{nextTask.estimated_hours}h estimated</span>
                <span className="w-1 h-1 rounded-full bg-muted" />
                <span>{nextTask.project_name || 'Project'}</span>
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={() => navigate(`/developer/work/${nextTask.unit_id}`)}
                  className="px-6 py-3 bg-signal/15 text-foreground font-semibold rounded-xl transition-all shadow-lg flex items-center gap-2"
                  data-testid="open-task-btn"
                >
                  Open Task
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => navigate('/developer/board')}
                  className="px-6 py-3 border border-border text-muted-foreground hover:text-foreground hover:border-border rounded-xl transition-all"
                >
                  View Board
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl bg-[var(--t-surface-raised)] border border-border p-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-success/20 mx-auto mb-4 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-success" />
            </div>
            <h3 className="text-xl font-semibold mb-2">All caught up!</h3>
            <p className="text-muted-foreground mb-6">No active tasks at the moment</p>
            <button
              onClick={() => navigate('/developer/board')}
              className="px-6 py-3 border border-border rounded-xl text-muted-foreground hover:text-foreground hover:border-border transition-all"
            >
              View Work Board
            </button>
          </div>
        )}
      </section>

      {/* Stats */}
      <section className="grid grid-cols-4 gap-4 mb-8">
        <StatCard 
          label="Active" 
          value={activeUnits.length}
          icon={<Play className="w-5 h-5" />}
          color="emerald"
        />
        <StatCard 
          label="In Review" 
          value={reviewUnits.length}
          icon={<Clock className="w-5 h-5" />}
          color="amber"
        />
        <StatCard 
          label="Revision" 
          value={revisionUnits.length}
          icon={<AlertCircle className="w-5 h-5" />}
          color="red"
          highlight={revisionUnits.length > 0}
        />
        <StatCard 
          label="Completed" 
          value={completedUnits.length}
          icon={<CheckCircle2 className="w-5 h-5" />}
          color="blue"
        />
      </section>

      {/* Recent Activity */}
      {workUnits.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Recent Tasks</h2>
            <button 
              onClick={() => navigate('/developer/assignments')}
              className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              View all <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          
          <div className="space-y-2">
            {workUnits.slice(0, 5).map((unit) => (
              <TaskRow 
                key={unit.unit_id}
                task={unit}
                onClick={() => navigate(`/developer/work/${unit.unit_id}`)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

const StatCard = ({ label, value, icon, color, highlight }) => {
  const colors = {
    emerald: 'text-success',
    amber: 'text-warning',
    red: 'text-danger',
    blue: 'text-signal'
  };
  
  return (
    <div className={`p-5 rounded-2xl border bg-[var(--t-surface-raised)] transition-all ${
      highlight ? 'border-danger/30 bg-signal/15' : 'border-border'
    }`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        <span className={colors[color]}>{icon}</span>
      </div>
      <div className="text-3xl font-semibold">{value}</div>
    </div>
  );
};

const TaskRow = ({ task, onClick }) => {
  const statusConfig = {
    assigned: { color: 'bg-muted', label: 'New' },
    in_progress: { color: 'bg-success', label: 'Active' },
    submitted: { color: 'bg-warning', label: 'Review' },
    validation: { color: 'bg-signal', label: 'Validating' },
    revision: { color: 'bg-danger', label: 'Fix' },
    completed: { color: 'bg-signal', label: 'Done' },
  }[task.status] || { color: 'bg-muted', label: task.status };

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 p-4 rounded-xl bg-[var(--t-surface-raised)] border border-border hover:border-border hover:bg-signal-soft transition-all text-left group"
    >
      <div className={`w-2 h-2 rounded-full ${statusConfig.color}`} />
      <div className="flex-1 min-w-0">
        <h4 className="font-medium truncate group-hover:text-success transition-colors">{task.title}</h4>
        <p className="text-sm text-muted-foreground">{task.project_name || 'Project'}</p>
      </div>
      <span className="text-xs text-muted-foreground px-2 py-1 bg-muted rounded-lg">{statusConfig.label}</span>
      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-success transition-colors" />
    </button>
  );
};

export default DeveloperHub;
