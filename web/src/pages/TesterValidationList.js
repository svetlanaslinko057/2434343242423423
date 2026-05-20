import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import axios from 'axios';
import {
  Clock,
  Shield,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Loader2,
  User
} from 'lucide-react';

const TesterValidationList = () => {
  const navigate = useNavigate();
  const [validationTasks, setValidationTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('pending');

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

  const tabs = [
    { id: 'pending', label: 'Pending', filter: t => t.status === 'pending' },
    { id: 'in_progress', label: 'In Progress', filter: t => t.status === 'in_progress' },
    { id: 'failed', label: 'Failed', filter: t => t.status === 'failed' },
    { id: 'passed', label: 'Passed', filter: t => t.status === 'passed' },
  ];

  const currentTab = tabs.find(t => t.id === activeTab);
  const filteredTasks = validationTasks.filter(currentTab.filter);

  const pendingCount = validationTasks.filter(t => t.status === 'pending').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="p-6" data-testid="tester-validation-list">
      <h1 className="text-2xl font-semibold mb-6">Validation Queue</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-zinc-800">
        {tabs.map((tab) => {
          const count = validationTasks.filter(tab.filter).length;
          const isPending = tab.id === 'pending' && count > 0;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-all ${
                activeTab === tab.id
                  ? 'border-white text-white'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span className={`ml-2 px-1.5 py-0.5 text-xs rounded ${
                  isPending ? 'bg-amber-500 text-black' : 'bg-zinc-800 text-zinc-400'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* List */}
      {filteredTasks.length === 0 ? (
        <div className="border border-zinc-800 border-dashed rounded-xl p-12 text-center">
          <p className="text-zinc-500 text-sm">No validations in this category</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTasks.map((task) => (
            <ValidationCard 
              key={task.validation_id} 
              task={task} 
              onClick={() => navigate(`/tester/validation/${task.validation_id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const ValidationCard = ({ task, onClick }) => {
  const getStatusConfig = (status) => {
    switch (status) {
      case 'pending':
        return { icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/20', label: 'Pending' };
      case 'in_progress':
        return { icon: Shield, color: 'text-signal', bg: 'bg-signal/20', label: 'In Progress' };
      case 'passed':
        return { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/20', label: 'Passed' };
      case 'failed':
        return { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/20', label: 'Failed' };
      default:
        return { icon: Clock, color: 'text-zinc-400', bg: 'bg-zinc-800', label: status };
    }
  };

  const config = getStatusConfig(task.status);
  const Icon = config.icon;
  const isPending = task.status === 'pending';

  return (
    <button
      onClick={onClick}
      className={`w-full text-left border rounded-xl p-4 flex items-center justify-between transition-all group ${
        isPending 
          ? 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10' 
          : 'border-zinc-800 bg-[#111] hover:border-zinc-700'
      }`}
      data-testid={`validation-${task.validation_id}`}
    >
      <div className="flex items-center gap-4">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${config.bg}`}>
          <Icon className={`w-5 h-5 ${config.color}`} />
        </div>
        <div>
          <div className="font-medium">Validation #{task.validation_id?.slice(-6)}</div>
          <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-2">
            <span>Unit: {task.unit_id?.slice(-8)}</span>
            {task.developer_name && (
              <>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  {task.developer_name}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        <span className={`px-2 py-1 text-xs rounded-lg ${config.bg} ${config.color}`}>
          {config.label}
        </span>
        <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
      </div>
    </button>
  );
};

export default TesterValidationList;
