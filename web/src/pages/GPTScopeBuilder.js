import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import axios from 'axios';
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  Clock,
  Code,
  Database,
  Layout,
  TestTube,
  FileText,
  Server,
  Plug,
  Settings,
  ArrowRight,
  Plus,
  Trash2,
  Edit3,
  Save,
  AlertTriangle,
  Zap,
  Brain,
  Target
} from 'lucide-react';

const GPTScopeBuilder = () => {
  const { requestId, projectId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [idea, setIdea] = useState('');
  const [context, setContext] = useState('');
  const [request, setRequest] = useState(null);
  const [generatedTasks, setGeneratedTasks] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [converting, setConverting] = useState(false);
  const [editingTask, setEditingTask] = useState(null);

  useEffect(() => {
    if (requestId) {
      fetchRequest();
    }
  }, [requestId]);

  const fetchRequest = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/requests/${requestId}`, { withCredentials: true });
      setRequest(res.data);
      setIdea(res.data?.title + '\n\n' + (res.data?.business_idea || res.data?.description || ''));
    } catch (error) {
      console.error('Error fetching request:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!idea.trim()) return;
    setGenerating(true);
    try {
      const res = await axios.post(`${API}/ai/generate-scope`, {
        idea,
        context: context || null,
      }, { withCredentials: true });
      
      setGeneratedTasks(res.data.tasks || []);
      setSummary(res.data.summary || null);
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to generate scope');
    } finally {
      setGenerating(false);
    }
  };

  const handleConvertToUnits = async () => {
    if (generatedTasks.length === 0) return;
    setConverting(true);
    try {
      // First create scope if needed
      let scopeId = request?.scope_id;
      let targetProjectId = projectId || request?.project_id;
      
      if (!scopeId && requestId) {
        // Create scope
        const scopeRes = await axios.post(`${API}/admin/scopes`, {
          request_id: requestId,
        }, { withCredentials: true });
        scopeId = scopeRes.data.scope_id;
        targetProjectId = scopeRes.data.project_id;
      }
      
      if (!scopeId) {
        alert('No scope available. Please create a project first.');
        return;
      }
      
      // Convert tasks to work units
      await axios.post(`${API}/ai/scope-to-units`, {
        scope_id: scopeId,
        project_id: targetProjectId,
        tasks: generatedTasks,
      }, { withCredentials: true });
      
      alert('Scope converted to work units successfully!');
      navigate(`/admin/project/${targetProjectId}/scope`);
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to convert scope');
    } finally {
      setConverting(false);
    }
  };

  const updateTask = (index, field, value) => {
    const updated = [...generatedTasks];
    updated[index] = { ...updated[index], [field]: value };
    setGeneratedTasks(updated);
    
    // Recalculate summary
    const totalHours = updated.reduce((sum, t) => sum + (t.estimated_hours || 0), 0);
    setSummary(prev => ({
      ...prev,
      total_hours: totalHours,
      estimated_weeks: Math.max(1, Math.ceil(totalHours / 40)),
    }));
  };

  const removeTask = (index) => {
    const updated = generatedTasks.filter((_, i) => i !== index);
    setGeneratedTasks(updated);
    
    const totalHours = updated.reduce((sum, t) => sum + (t.estimated_hours || 0), 0);
    setSummary(prev => ({
      ...prev,
      total_tasks: updated.length,
      total_hours: totalHours,
    }));
  };

  const addTask = () => {
    setGeneratedTasks([...generatedTasks, {
      task_id: `task_new_${Date.now()}`,
      title: 'New Task',
      description: '',
      task_type: 'backend',
      priority: 'medium',
      estimated_hours: 8,
      dependencies: [],
      order: generatedTasks.length + 1,
    }]);
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'backend': return <Server className="w-4 h-4" />;
      case 'frontend': return <Layout className="w-4 h-4" />;
      case 'database': return <Database className="w-4 h-4" />;
      case 'integration': return <Plug className="w-4 h-4" />;
      case 'testing': return <TestTube className="w-4 h-4" />;
      case 'design': return <Target className="w-4 h-4" />;
      case 'devops': return <Settings className="w-4 h-4" />;
      case 'documentation': return <FileText className="w-4 h-4" />;
      default: return <Code className="w-4 h-4" />;
    }
  };

  const getTypeColor = (type) => {
    switch (type) {
      case 'backend': return 'bg-signal/20 text-signal border-signal/30';
      case 'frontend': return 'bg-signal/20 text-signal border-signal/30';
      case 'database': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'integration': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'testing': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'design': return 'bg-signal/20 text-signal border-signal/30';
      case 'devops': return 'bg-signal/20 text-signal border-signal/30';
      default: return 'bg-muted text-muted-foreground border-border';
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'critical': return 'bg-red-500 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-amber-500 text-black';
      case 'low': return 'bg-signal text-white';
      default: return 'bg-muted text-white';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="gpt-scope-builder">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-3">
            <Brain className="w-7 h-7 text-signal" />
            AI Scope Builder
          </h1>
          <p className="text-muted-foreground mt-1">Generate project tasks with GPT</p>
        </div>
        {generatedTasks.length > 0 && (
          <button
            onClick={handleConvertToUnits}
            disabled={converting}
            className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-medium rounded-xl transition-colors flex items-center gap-2"
            data-testid="convert-to-units-btn"
          >
            {converting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            Create Work Units
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Input Section */}
        <div className="lg:col-span-1 space-y-4">
          <div className="rounded-2xl border border-border bg-[var(--t-surface-raised)] p-6">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-signal" />
              Project Idea
            </h2>
            
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="Describe the project in detail: what it does, key features, target users, technical requirements..."
              className="w-full h-40 bg-black/30 border border-border rounded-xl p-4 text-white placeholder:text-muted-foreground focus:outline-none focus:border-signal/50 resize-none mb-4"
              data-testid="idea-input"
            />
            
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Additional context (optional): tech stack preferences, constraints, timeline..."
              className="w-full h-24 bg-black/30 border border-border rounded-xl p-4 text-white placeholder:text-muted-foreground focus:outline-none focus:border-signal/50 resize-none mb-4"
              data-testid="context-input"
            />
            
            <button
              onClick={handleGenerate}
              disabled={generating || !idea.trim()}
              className="w-full py-4 bg-signal/15 disabled:opacity-50 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2"
              data-testid="generate-scope-btn"
            >
              {generating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5" />
                  Generate Scope with AI
                </>
              )}
            </button>
          </div>

          {/* Summary */}
          {summary && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6">
              <h3 className="font-semibold mb-4 text-emerald-400">Summary</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tasks</span>
                  <span className="font-semibold">{summary.total_tasks}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Hours</span>
                  <span className="font-semibold">{summary.total_hours}h</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Timeline</span>
                  <span className="font-semibold">~{summary.estimated_weeks} weeks</span>
                </div>
                <div className="border-t border-border pt-3 flex justify-between">
                  <span className="text-muted-foreground">Estimated Cost</span>
                  <span className="font-bold text-emerald-400">
                    ${summary.pricing?.final_price?.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Generated Tasks */}
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-border bg-[var(--t-surface-raised)] overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <Target className="w-5 h-5 text-signal" />
                Generated Tasks
                {generatedTasks.length > 0 && (
                  <span className="text-muted-foreground text-sm ml-2">({generatedTasks.length})</span>
                )}
              </h2>
              {generatedTasks.length > 0 && (
                <button
                  onClick={addTask}
                  className="text-sm text-signal hover:text-signal flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  Add Task
                </button>
              )}
            </div>

            {generatedTasks.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <Brain className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg mb-2">No tasks generated yet</p>
                <p className="text-sm">Enter your project idea and click "Generate Scope"</p>
              </div>
            ) : (
              <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
                {generatedTasks.map((task, index) => (
                  <div key={task.task_id} className="p-4 hover:bg-muted transition-colors">
                    <div className="flex items-start gap-4">
                      {/* Order */}
                      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground text-sm font-mono flex-shrink-0">
                        {index + 1}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        {editingTask === task.task_id ? (
                          <div className="space-y-3">
                            <input
                              value={task.title}
                              onChange={(e) => updateTask(index, 'title', e.target.value)}
                              className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-white"
                            />
                            <textarea
                              value={task.description}
                              onChange={(e) => updateTask(index, 'description', e.target.value)}
                              className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-white text-sm"
                              rows={2}
                            />
                            <div className="flex gap-2">
                              <select
                                value={task.task_type}
                                onChange={(e) => updateTask(index, 'task_type', e.target.value)}
                                className="bg-black/30 border border-border rounded-lg px-3 py-2 text-white text-sm"
                              >
                                {['backend', 'frontend', 'database', 'integration', 'testing', 'design', 'devops', 'documentation'].map(t => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </select>
                              <select
                                value={task.priority}
                                onChange={(e) => updateTask(index, 'priority', e.target.value)}
                                className="bg-black/30 border border-border rounded-lg px-3 py-2 text-white text-sm"
                              >
                                {['critical', 'high', 'medium', 'low'].map(p => (
                                  <option key={p} value={p}>{p}</option>
                                ))}
                              </select>
                              <input
                                type="number"
                                value={task.estimated_hours}
                                onChange={(e) => updateTask(index, 'estimated_hours', parseInt(e.target.value) || 0)}
                                className="w-20 bg-black/30 border border-border rounded-lg px-3 py-2 text-white text-sm"
                              />
                              <span className="text-muted-foreground self-center">hours</span>
                            </div>
                            <button
                              onClick={() => setEditingTask(null)}
                              className="text-sm text-emerald-400 flex items-center gap-1"
                            >
                              <Save className="w-4 h-4" />
                              Done
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-medium text-white">{task.title}</h3>
                              <span className={`px-2 py-0.5 text-xs rounded border ${getTypeColor(task.task_type)} flex items-center gap-1`}>
                                {getTypeIcon(task.task_type)}
                                {task.task_type}
                              </span>
                              <span className={`px-2 py-0.5 text-xs rounded ${getPriorityColor(task.priority)}`}>
                                {task.priority}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground mb-2">{task.description}</p>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Clock className="w-4 h-4" />
                                {task.estimated_hours}h
                              </span>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => setEditingTask(editingTask === task.task_id ? null : task.task_id)}
                          className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-white transition-colors"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => removeTask(index)}
                          className="p-2 hover:bg-red-500/20 rounded-lg text-muted-foreground hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GPTScopeBuilder;
