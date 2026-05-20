import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import axios from 'axios';
import Logo from '@/components/Logo';
import {
  TestTube,
  ClipboardCheck,
  AlertTriangle,
  CheckCircle2,
  LogOut,
  Bell,
  Clock,
  XCircle,
  Target
} from 'lucide-react';

const TesterDashboard = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [validationTasks, setValidationTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await axios.get(`${API}/tester/validation-tasks`, { withCredentials: true });
        setValidationTasks(res.data);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const getStatusBadge = (status) => {
    const styles = {
      pending: 'bg-muted text-muted-foreground border-border',
      in_progress: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      passed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      failed: 'bg-red-500/10 text-red-400 border-red-500/20',
    };
    return styles[status] || 'bg-muted text-muted-foreground border-border';
  };

  const pendingTasks = validationTasks.filter(t => ['pending', 'in_progress'].includes(t.status));
  const passedTasks = validationTasks.filter(t => t.status === 'passed');
  const failedTasks = validationTasks.filter(t => t.status === 'failed');

  return (
    <div className="min-h-screen bg-[var(--t-bg)] text-white" data-testid="tester-dashboard">
      {/* Header */}
      <header className="border-b border-border bg-black/60 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Logo height={48} className="h-12" />
            <div className="px-2 py-1 bg-signal/10 text-signal text-xs border border-signal/20">
              Tester
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <button className="w-9 h-9 flex items-center justify-center text-muted-foreground hover:text-white transition-colors">
              <Bell className="w-5 h-5" strokeWidth={1.5} />
            </button>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">{user?.name}</span>
              <button 
                onClick={handleLogout}
                className="text-muted-foreground hover:text-white transition-colors"
                data-testid="logout-btn"
              >
                <LogOut className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Welcome */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">Tester Hub</h1>
          <p className="text-muted-foreground mt-1">Validation tasks and quality control</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-2 border-border border-t-white rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-8">
            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="p-6 border border-border rounded-2xl bg-white/[0.02]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-muted-foreground text-sm">Pending</span>
                  <Clock className="w-4 h-4 text-amber-400" strokeWidth={1.5} />
                </div>
                <div className="text-3xl font-bold">{pendingTasks.length}</div>
              </div>

              <div className="p-6 border border-border rounded-2xl bg-white/[0.02]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-muted-foreground text-sm">Passed</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" strokeWidth={1.5} />
                </div>
                <div className="text-3xl font-bold">{passedTasks.length}</div>
              </div>

              <div className="p-6 border border-border rounded-2xl bg-white/[0.02]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-muted-foreground text-sm">Failed</span>
                  <XCircle className="w-4 h-4 text-red-400" strokeWidth={1.5} />
                </div>
                <div className="text-3xl font-bold">{failedTasks.length}</div>
              </div>

              <div className="p-6 border border-border rounded-2xl bg-white/[0.02]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-muted-foreground text-sm">Accuracy</span>
                  <Target className="w-4 h-4 text-signal" strokeWidth={1.5} />
                </div>
                <div className="text-3xl font-bold">
                  {validationTasks.length > 0 
                    ? Math.round((passedTasks.length / validationTasks.length) * 100) 
                    : 100}%
                </div>
              </div>
            </div>

            {/* Validation Tasks */}
            <div>
              <h2 className="text-lg font-semibold mb-4">Validation Tasks</h2>
              
              {pendingTasks.length === 0 ? (
                <div className="border border-border border-dashed rounded-2xl p-12 text-center">
                  <div className="w-16 h-16 bg-muted rounded-2xl mx-auto mb-4 flex items-center justify-center">
                    <TestTube className="w-8 h-8 text-muted-foreground" strokeWidth={1.5} />
                  </div>
                  <h3 className="text-lg font-medium mb-2">No pending validations</h3>
                  <p className="text-muted-foreground text-sm">New tasks will appear here when assigned</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingTasks.map((task) => (
                    <div
                      key={task.validation_id}
                      className="group border border-border rounded-2xl p-5 hover:border-border hover:bg-white/[0.02] transition-all"
                      data-testid={`validation-${task.validation_id}`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-3">
                            <h3 className="font-medium">Validation #{task.validation_id.slice(-6)}</h3>
                            <span className={`px-2 py-0.5 text-xs rounded-lg border ${getStatusBadge(task.status)}`}>
                              {task.status.replace('_', ' ')}
                            </span>
                          </div>
                          <p className="text-muted-foreground text-sm mt-1">Work Unit: {task.unit_id}</p>
                        </div>
                      </div>
                      
                      <div className="mt-4 flex items-center gap-3">
                        <button className="px-4 py-2 bg-emerald-500 text-white text-sm font-medium rounded-xl hover:bg-emerald-600 transition-all flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4" />
                          Pass
                        </button>
                        <button className="px-4 py-2 bg-red-500 text-white text-sm font-medium rounded-xl hover:bg-red-600 transition-all flex items-center gap-2">
                          <XCircle className="w-4 h-4" />
                          Fail
                        </button>
                        <button className="px-4 py-2 border border-border rounded-xl text-sm hover:bg-muted transition-all flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4" />
                          Report Issue
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* History */}
            <div>
              <h2 className="text-lg font-semibold mb-4">History</h2>
              {(passedTasks.length + failedTasks.length) === 0 ? (
                <div className="border border-border rounded-2xl p-6 text-center text-muted-foreground">
                  <p className="text-sm">No completed validations yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {[...passedTasks, ...failedTasks].slice(0, 10).map((task) => (
                    <div
                      key={task.validation_id}
                      className="border border-border rounded-xl p-4 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        {task.status === 'passed' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-400" />
                        )}
                        <span className="text-sm">Validation #{task.validation_id.slice(-6)}</span>
                      </div>
                      <span className={`px-2 py-0.5 text-xs rounded-lg border ${getStatusBadge(task.status)}`}>
                        {task.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default TesterDashboard;
