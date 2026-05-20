import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import axios from 'axios';
import {
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronRight,
  Loader2,
  Shield
} from 'lucide-react';

const TesterHub = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [validationTasks, setValidationTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await axios.get(`${API}/tester/validation-tasks`, { withCredentials: true });
        setValidationTasks(res.data);
      } catch (error) {
        console.error('Error fetching validation tasks:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const pendingTasks = validationTasks.filter(t => t.status === 'pending');
  const inProgressTasks = validationTasks.filter(t => t.status === 'in_progress');
  const passedTasks = validationTasks.filter(t => t.status === 'passed');
  const failedTasks = validationTasks.filter(t => t.status === 'failed');

  // Next task priority: in_progress > pending
  const nextTask = inProgressTasks[0] || pendingTasks[0] || null;

  // Recent activity
  const recentActivity = validationTasks
    .filter(t => ['passed', 'failed'].includes(t.status))
    .slice(0, 5);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl" data-testid="tester-hub">
      {/* Header */}
      <h1 className="text-2xl font-semibold mb-6">Quality Control</h1>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <StatCard 
          title="Pending" 
          value={pendingTasks.length} 
          icon={Clock}
          color="text-amber-400"
          highlight={pendingTasks.length > 0}
        />
        <StatCard 
          title="In Progress" 
          value={inProgressTasks.length} 
          icon={Shield}
          color="text-signal"
        />
        <StatCard 
          title="Passed" 
          value={passedTasks.length} 
          icon={CheckCircle2}
          color="text-emerald-400"
        />
        <StatCard 
          title="Failed" 
          value={failedTasks.length} 
          icon={XCircle}
          color="text-red-400"
        />
      </div>

      {/* Next Task */}
      {nextTask ? (
        <div className="border border-zinc-800 rounded-xl p-5 mb-6 bg-[#111]">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
            Next Validation
          </div>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium">Validation #{nextTask.validation_id?.slice(-6)}</h3>
              <div className="flex items-center gap-2 mt-1 text-sm text-zinc-500">
                <span>Work Unit: {nextTask.unit_id?.slice(-8)}</span>
              </div>
            </div>
            <button
              onClick={() => navigate(`/tester/validation/${nextTask.validation_id}`)}
              className="px-4 py-2 bg-signal text-white rounded-xl text-sm font-medium hover:bg-signal transition-all"
              data-testid="open-next-validation"
            >
              Start Validation
            </button>
          </div>
        </div>
      ) : (
        <div className="border border-zinc-800 border-dashed rounded-xl p-8 mb-6 text-center">
          <CheckCircle2 className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
          <p className="text-zinc-500 text-sm">No pending validations</p>
        </div>
      )}

      {/* Activity */}
      <div>
        <h2 className="text-xs text-zinc-500 uppercase tracking-wider mb-3">
          Recent Activity
        </h2>
        {recentActivity.length === 0 ? (
          <p className="text-zinc-600 text-sm">No recent activity</p>
        ) : (
          <div className="space-y-2">
            {recentActivity.map((task) => (
              <div 
                key={task.validation_id}
                className="flex items-center gap-3 text-sm"
              >
                {task.status === 'passed' && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                )}
                {task.status === 'failed' && (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
                <span className="text-zinc-400">
                  {task.status === 'passed' ? 'Passed' : 'Failed'}: #{task.validation_id?.slice(-6)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const StatCard = ({ title, value, icon: Icon, color, highlight }) => (
  <div className={`border rounded-xl p-4 ${highlight ? 'border-amber-500/50 bg-amber-500/5' : 'border-zinc-800 bg-[#111]'}`}>
    <div className="flex items-center justify-between mb-2">
      <span className="text-xs text-zinc-500">{title}</span>
      <Icon className={`w-4 h-4 ${color}`} strokeWidth={1.5} />
    </div>
    <div className="text-2xl font-semibold">{value}</div>
  </div>
);

export default TesterHub;
