import { useState, useEffect } from 'react';
import { useAuth, API } from '@/App';
import axios from 'axios';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2
} from 'lucide-react';

const TesterIssues = () => {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await axios.get(`${API}/tester/issues`, { withCredentials: true });
        setIssues(res.data);
      } catch (error) {
        console.error('Error fetching issues:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const getSeverityConfig = (severity) => {
    switch (severity) {
      case 'high':
        return { color: 'text-red-400', bg: 'bg-red-500/20', label: 'High' };
      case 'medium':
        return { color: 'text-amber-400', bg: 'bg-amber-500/20', label: 'Medium' };
      case 'low':
        return { color: 'text-zinc-400', bg: 'bg-zinc-700', label: 'Low' };
      default:
        return { color: 'text-zinc-400', bg: 'bg-zinc-700', label: severity };
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  const highCount = issues.filter(i => i.severity === 'high').length;
  const mediumCount = issues.filter(i => i.severity === 'medium').length;
  const lowCount = issues.filter(i => i.severity === 'low').length;

  return (
    <div className="p-6 max-w-4xl" data-testid="tester-issues">
      <h1 className="text-2xl font-semibold mb-6">Issues Reported</h1>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="border border-red-500/30 rounded-xl p-4 bg-red-500/5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-500">High</span>
            <AlertTriangle className="w-4 h-4 text-red-400" />
          </div>
          <div className="text-2xl font-semibold text-red-400">{highCount}</div>
        </div>
        <div className="border border-amber-500/30 rounded-xl p-4 bg-amber-500/5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-500">Medium</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-semibold text-amber-400">{mediumCount}</div>
        </div>
        <div className="border border-zinc-800 rounded-xl p-4 bg-[#111]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-500">Low</span>
            <AlertTriangle className="w-4 h-4 text-zinc-400" />
          </div>
          <div className="text-2xl font-semibold">{lowCount}</div>
        </div>
      </div>

      {/* Issues List */}
      {issues.length === 0 ? (
        <div className="border border-zinc-800 border-dashed rounded-xl p-12 text-center">
          <CheckCircle2 className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
          <p className="text-zinc-500 text-sm">No issues reported yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {issues.map((issue) => {
            const config = getSeverityConfig(issue.severity);
            return (
              <div 
                key={issue.issue_id}
                className="border border-zinc-800 rounded-xl p-4 bg-[#111]"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className={`w-4 h-4 mt-1 ${config.color}`} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{issue.title}</span>
                        <span className={`px-1.5 py-0.5 text-xs rounded ${config.bg} ${config.color}`}>
                          {config.label}
                        </span>
                      </div>
                      {issue.description && (
                        <p className="text-sm text-zinc-400 mt-1">{issue.description}</p>
                      )}
                      <p className="text-xs text-zinc-600 mt-2">
                        Validation: #{issue.validation_id?.slice(-6)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TesterIssues;
