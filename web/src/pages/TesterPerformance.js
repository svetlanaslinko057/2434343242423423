import { useState, useEffect } from 'react';
import { useAuth, API } from '@/App';
import axios from 'axios';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Target,
  Loader2
} from 'lucide-react';

const TesterPerformance = () => {
  const { user } = useAuth();
  const [validationTasks, setValidationTasks] = useState([]);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [validationsRes, issuesRes] = await Promise.all([
          axios.get(`${API}/tester/validation-tasks`, { withCredentials: true }),
          axios.get(`${API}/tester/issues`, { withCredentials: true }).catch(() => ({ data: [] }))
        ]);
        setValidationTasks(validationsRes.data);
        setIssues(issuesRes.data);
      } catch (error) {
        console.error('Error:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const passedTasks = validationTasks.filter(t => t.status === 'passed');
  const failedTasks = validationTasks.filter(t => t.status === 'failed');
  const totalCompleted = passedTasks.length + failedTasks.length;
  
  // Metrics
  const totalValidations = totalCompleted;
  const accuracy = totalValidations > 0 
    ? Math.round((passedTasks.length / totalValidations) * 100)
    : 100;
  const issuesFound = issues.length;
  const highSeverityIssues = issues.filter(i => i.severity === 'high').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl" data-testid="tester-performance">
      <h1 className="text-2xl font-semibold mb-6">Performance</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="border border-zinc-800 rounded-xl p-6 bg-[#111]">
          <div className="flex items-center justify-between mb-4">
            <span className="text-zinc-500 text-sm">Validations</span>
            <Target className="w-5 h-5 text-signal" />
          </div>
          <div className="text-4xl font-bold">{totalValidations}</div>
        </div>

        <div className="border border-zinc-800 rounded-xl p-6 bg-[#111]">
          <div className="flex items-center justify-between mb-4">
            <span className="text-zinc-500 text-sm">Pass Rate</span>
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="text-4xl font-bold">{accuracy}%</div>
        </div>

        <div className="border border-zinc-800 rounded-xl p-6 bg-[#111]">
          <div className="flex items-center justify-between mb-4">
            <span className="text-zinc-500 text-sm">Issues Found</span>
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          </div>
          <div className="text-4xl font-bold">{issuesFound}</div>
        </div>

        <div className="border border-zinc-800 rounded-xl p-6 bg-[#111]">
          <div className="flex items-center justify-between mb-4">
            <span className="text-zinc-500 text-sm">Critical Issues</span>
            <XCircle className="w-5 h-5 text-red-400" />
          </div>
          <div className="text-4xl font-bold">{highSeverityIssues}</div>
        </div>
      </div>

      {/* Breakdown */}
      <div className="border border-zinc-800 rounded-xl p-6 bg-[#111] mb-8">
        <div className="text-zinc-500 text-sm mb-4">Validation Breakdown</div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <div>
              <div className="text-2xl font-bold">{passedTasks.length}</div>
              <div className="text-xs text-zinc-500">Passed</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <XCircle className="w-5 h-5 text-red-400" />
            <div>
              <div className="text-2xl font-bold">{failedTasks.length}</div>
              <div className="text-xs text-zinc-500">Failed</div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Validations */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Recent Validations</h2>
        {totalCompleted === 0 ? (
          <div className="border border-zinc-800 border-dashed rounded-xl p-8 text-center">
            <p className="text-zinc-500 text-sm">No completed validations yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {[...passedTasks, ...failedTasks].slice(0, 10).map((task) => (
              <div 
                key={task.validation_id}
                className="border border-zinc-800 rounded-xl p-4 flex items-center justify-between bg-[#111]"
              >
                <div className="flex items-center gap-3">
                  {task.status === 'passed' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-400" />
                  )}
                  <span>Validation #{task.validation_id?.slice(-6)}</span>
                </div>
                <span className={`px-2 py-1 text-xs rounded ${
                  task.status === 'passed' 
                    ? 'bg-emerald-500/20 text-emerald-400' 
                    : 'bg-red-500/20 text-red-400'
                }`}>
                  {task.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TesterPerformance;
