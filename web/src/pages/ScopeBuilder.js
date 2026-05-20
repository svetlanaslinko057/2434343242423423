import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import axios from 'axios';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock,
  Code,
  Eye,
  FileCode,
  Layers,
  Loader2,
  Paintbrush,
  Plus,
  RefreshCw,
  Send,
  Server,
  Shield,
  TestTube,
  Trash2,
  User,
  Users,
  X,
  Zap,
  AlertTriangle,
  Play
} from 'lucide-react';

const ScopeBuilder = () => {
  const { projectId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [project, setProject] = useState(null);
  const [scope, setScope] = useState(null);
  const [units, setUnits] = useState([]);
  const [developers, setDevelopers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  
  // Modal states
  const [showAddUnit, setShowAddUnit] = useState(false);
  const [showAssign, setShowAssign] = useState(null);
  const [showReview, setShowReview] = useState(null);
  
  // New unit form
  const [newUnit, setNewUnit] = useState({
    title: '',
    description: '',
    unit_type: 'task',
    priority: 'medium',
    estimated_hours: ''
  });

  const fetchData = useCallback(async () => {
    try {
      // Get project
      const projRes = await axios.get(`${API}/projects/${projectId}`, { withCredentials: true });
      setProject(projRes.data);
      
      // Get scope and units
      const scopeRes = await axios.get(`${API}/admin/projects/${projectId}/scope`, { withCredentials: true });
      setScope(scopeRes.data.scope);
      setUnits(scopeRes.data.units || []);
      
      // Get developers
      const devsRes = await axios.get(`${API}/admin/developers/available`, { withCredentials: true });
      setDevelopers(devsRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const createScope = async () => {
    setCreating(true);
    try {
      const res = await axios.post(`${API}/admin/projects/${projectId}/scope`, {}, { withCredentials: true });
      setScope(res.data.scope);
      
      // Auto-generate units from proposal if available
      if (project?.proposal?.features && res.data.scope) {
        await bulkCreateUnits(res.data.scope.scope_id, project.proposal.features);
      }
      fetchData();
    } catch (error) {
      console.error('Error creating scope:', error);
    } finally {
      setCreating(false);
    }
  };

  const bulkCreateUnits = async (scopeId, features) => {
    try {
      const unitsToCreate = features.map(f => ({
        title: f.title,
        description: f.description || '',
        unit_type: 'task',
        priority: 'medium',
        estimated_hours: f.hours || null
      }));
      
      await axios.post(`${API}/admin/scopes/${scopeId}/units/bulk`, 
        { units: unitsToCreate },
        { withCredentials: true }
      );
    } catch (error) {
      console.error('Error bulk creating units:', error);
    }
  };

  const addUnit = async () => {
    if (!newUnit.title.trim() || !scope) return;
    
    try {
      await axios.post(`${API}/admin/scopes/${scope.scope_id}/units`, {
        ...newUnit,
        estimated_hours: newUnit.estimated_hours ? parseInt(newUnit.estimated_hours) : null
      }, { withCredentials: true });
      
      setShowAddUnit(false);
      setNewUnit({ title: '', description: '', unit_type: 'task', priority: 'medium', estimated_hours: '' });
      fetchData();
    } catch (error) {
      console.error('Error adding unit:', error);
    }
  };

  const assignUnit = async (unitId, developerId) => {
    try {
      await axios.post(`${API}/admin/work-units/${unitId}/assign`, 
        { developer_id: developerId },
        { withCredentials: true }
      );
      setShowAssign(null);
      fetchData();
    } catch (error) {
      console.error('Error assigning unit:', error);
    }
  };

  const reviewUnit = async (unitId, approved, feedback) => {
    try {
      await axios.post(`${API}/admin/work-units/${unitId}/review`,
        { approved, feedback },
        { withCredentials: true }
      );
      setShowReview(null);
      fetchData();
    } catch (error) {
      console.error('Error reviewing unit:', error);
    }
  };

  // Group units by status for Kanban
  const columns = {
    pending: units.filter(u => u.status === 'pending'),
    assigned: units.filter(u => u.status === 'assigned'),
    in_progress: units.filter(u => u.status === 'in_progress'),
    review: units.filter(u => u.status === 'review'),
    revision: units.filter(u => u.status === 'revision'),
    done: units.filter(u => u.status === 'done'),
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-app flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app text-white" data-testid="scope-builder">
      {/* Header */}
      <header className="border-b border-border bg-[var(--t-surface)]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[1920px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => navigate('/admin/master')}
              className="p-2 rounded-xl hover:bg-muted transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-lg font-semibold">{project?.name || 'Project Scope'}</h1>
              <p className="text-xs text-zinc-500">Scope Builder · {units.length} tasks</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={fetchData}
              className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            
            <button
              onClick={() => setShowAddUnit(true)}
              disabled={!scope}
              className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-xl text-sm font-medium disabled:opacity-50"
              data-testid="add-task-btn"
            >
              <Plus className="w-4 h-4" />
              Add Task
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1920px] mx-auto p-6">
        {/* Scope not created yet */}
        {!scope && (
          <div className="max-w-xl mx-auto py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-signal/20 mx-auto mb-6 flex items-center justify-center">
              <Layers className="w-8 h-8 text-signal" />
            </div>
            <h2 className="text-2xl font-semibold mb-3">Create Project Scope</h2>
            <p className="text-zinc-400 mb-6">
              Break down the project into manageable tasks and assign them to developers.
              {project?.proposal?.features?.length > 0 && (
                <span className="block mt-2 text-signal">
                  {project.proposal.features.length} features from proposal will be auto-imported.
                </span>
              )}
            </p>
            <button
              onClick={createScope}
              disabled={creating}
              className="inline-flex items-center gap-2 px-6 py-3 bg-signal/15 rounded-xl font-medium"
              data-testid="create-scope-btn"
            >
              {creating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
              Create Scope
            </button>
          </div>
        )}

        {/* Scope exists - show Kanban */}
        {scope && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <StatCard title="Total Tasks" value={units.length} icon={Layers} color="blue" />
              <StatCard title="In Progress" value={columns.in_progress.length + columns.assigned.length} icon={Play} color="amber" />
              <StatCard title="In Review" value={columns.review.length} icon={Eye} color="violet" />
              <StatCard title="Completed" value={columns.done.length} icon={CheckCircle2} color="emerald" />
            </div>

            {/* Kanban Board */}
            <div className="flex gap-4 overflow-x-auto pb-4" data-testid="kanban-board">
              <KanbanColumn
                title="Pending"
                icon={Clock}
                items={columns.pending}
                color="zinc"
                onAssign={(id) => setShowAssign(id)}
              />
              <KanbanColumn
                title="Assigned"
                icon={User}
                items={columns.assigned}
                color="blue"
              />
              <KanbanColumn
                title="In Progress"
                icon={Play}
                items={columns.in_progress}
                color="amber"
              />
              <KanbanColumn
                title="Review"
                icon={Eye}
                items={columns.review}
                color="violet"
                onReview={(id) => setShowReview(id)}
              />
              <KanbanColumn
                title="Revision"
                icon={AlertTriangle}
                items={columns.revision}
                color="orange"
              />
              <KanbanColumn
                title="Done"
                icon={CheckCircle2}
                items={columns.done}
                color="emerald"
              />
            </div>
          </>
        )}
      </main>

      {/* Add Unit Modal */}
      {showAddUnit && (
        <Modal title="Add New Task" onClose={() => setShowAddUnit(false)}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Title *</label>
              <input
                value={newUnit.title}
                onChange={(e) => setNewUnit({ ...newUnit, title: e.target.value })}
                placeholder="e.g., Implement user authentication"
                className="w-full bg-background border border-border rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-signal"
                data-testid="unit-title-input"
              />
            </div>
            
            <div>
              <label className="block text-sm text-zinc-400 mb-2">Description</label>
              <textarea
                value={newUnit.description}
                onChange={(e) => setNewUnit({ ...newUnit, description: e.target.value })}
                placeholder="Detailed task description..."
                className="w-full h-24 bg-background border border-border rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-signal"
                data-testid="unit-desc-input"
              />
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Type</label>
                <select
                  value={newUnit.unit_type}
                  onChange={(e) => setNewUnit({ ...newUnit, unit_type: e.target.value })}
                  className="w-full bg-background border border-border rounded-xl px-4 py-3 text-white focus:outline-none focus:border-signal"
                >
                  <option value="task">Task</option>
                  <option value="frontend">Frontend</option>
                  <option value="backend">Backend</option>
                  <option value="design">Design</option>
                  <option value="integration">Integration</option>
                  <option value="bug">Bug Fix</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Priority</label>
                <select
                  value={newUnit.priority}
                  onChange={(e) => setNewUnit({ ...newUnit, priority: e.target.value })}
                  className="w-full bg-background border border-border rounded-xl px-4 py-3 text-white focus:outline-none focus:border-signal"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Hours</label>
                <input
                  type="number"
                  value={newUnit.estimated_hours}
                  onChange={(e) => setNewUnit({ ...newUnit, estimated_hours: e.target.value })}
                  placeholder="Est."
                  className="w-full bg-background border border-border rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-signal"
                />
              </div>
            </div>
            
            <button
              onClick={addUnit}
              disabled={!newUnit.title.trim()}
              className="w-full py-3 bg-white text-black rounded-xl font-medium disabled:opacity-50"
              data-testid="submit-unit-btn"
            >
              Add Task
            </button>
          </div>
        </Modal>
      )}

      {/* Assign Modal */}
      {showAssign && (
        <Modal title="Assign Developer" onClose={() => setShowAssign(null)}>
          <div className="space-y-3">
            {developers.length === 0 ? (
              <p className="text-zinc-400 text-center py-4">No developers available</p>
            ) : (
              developers.map((dev) => (
                <button
                  key={dev.user_id}
                  onClick={() => assignUnit(showAssign, dev.user_id)}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border border-border hover:border-border hover:bg-muted transition-all text-left"
                  data-testid={`assign-${dev.user_id}`}
                >
                  <div className="w-10 h-10 rounded-full bg-signal/15 flex items-center justify-center text-white font-medium">
                    {dev.name?.charAt(0) || 'D'}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium">{dev.name}</div>
                    <div className="text-sm text-zinc-500">{dev.email}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-zinc-400">{dev.active_load || 0} tasks</div>
                    <div className="text-xs text-zinc-500">⭐ {dev.rating?.toFixed(1) || '5.0'}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </Modal>
      )}

      {/* Review Modal */}
      {showReview && (
        <ReviewModal
          unitId={showReview}
          onClose={() => setShowReview(null)}
          onReview={reviewUnit}
        />
      )}
    </div>
  );
};


// ============ COMPONENTS ============

const StatCard = ({ title, value, icon: Icon, color }) => {
  const colors = {
    blue: 'border-signal/50 bg-signal/5',
    amber: 'border-amber-800/50 bg-amber-500/5',
    violet: 'border-signal/50 bg-signal/5',
    emerald: 'border-emerald-800/50 bg-emerald-500/5',
    zinc: 'border-zinc-800/50 bg-zinc-500/5',
  };
  
  const iconColors = {
    blue: 'text-signal',
    amber: 'text-amber-400',
    violet: 'text-signal',
    emerald: 'text-emerald-400',
    zinc: 'text-zinc-400',
  };

  return (
    <div className={`rounded-2xl border ${colors[color]} p-4`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-zinc-400">{title}</span>
        <Icon className={`w-4 h-4 ${iconColors[color]}`} />
      </div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
};

const KanbanColumn = ({ title, icon: Icon, items, color, onAssign, onReview }) => {
  const colors = {
    zinc: { border: 'border-zinc-800/30', badge: 'bg-zinc-500/20 text-zinc-400', icon: 'text-zinc-400' },
    blue: { border: 'border-signal/30', badge: 'bg-signal/20 text-signal', icon: 'text-signal' },
    amber: { border: 'border-amber-800/30', badge: 'bg-amber-500/20 text-amber-400', icon: 'text-amber-400' },
    violet: { border: 'border-signal/30', badge: 'bg-signal/20 text-signal', icon: 'text-signal' },
    orange: { border: 'border-orange-800/30', badge: 'bg-orange-500/20 text-orange-400', icon: 'text-orange-400' },
    emerald: { border: 'border-emerald-800/30', badge: 'bg-emerald-500/20 text-emerald-400', icon: 'text-emerald-400' },
  };
  
  const style = colors[color];

  return (
    <div className={`w-[280px] flex-shrink-0 rounded-2xl border ${style.border} bg-[var(--t-surface)] p-4 min-h-[400px]`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${style.icon}`} />
          <span className="font-medium text-sm">{title}</span>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-xs ${style.badge}`}>
          {items.length}
        </span>
      </div>
      
      <div className="space-y-3">
        {items.map((item) => (
          <TaskCard 
            key={item.unit_id} 
            item={item} 
            onAssign={onAssign}
            onReview={onReview}
          />
        ))}
        {items.length === 0 && (
          <div className="text-sm text-zinc-600 text-center py-6">No tasks</div>
        )}
      </div>
    </div>
  );
};

const TaskCard = ({ item, onAssign, onReview }) => {
  const typeIcons = {
    task: Layers,
    frontend: Code,
    backend: Server,
    design: Paintbrush,
    integration: Zap,
    bug: AlertTriangle,
  };
  
  const priorityColors = {
    low: 'text-zinc-500',
    medium: 'text-signal',
    high: 'text-amber-400',
    critical: 'text-red-400',
  };
  
  const TypeIcon = typeIcons[item.unit_type] || Layers;

  return (
    <div className="rounded-xl border border-border bg-black/50 p-4 hover:border-border transition-all">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <TypeIcon className="w-4 h-4 text-zinc-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{item.title}</div>
          {item.description && (
            <div className="text-xs text-zinc-500 mt-1 line-clamp-2">{item.description}</div>
          )}
        </div>
      </div>
      
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
        <div className="flex items-center gap-2 text-xs">
          <span className={priorityColors[item.priority]}>{item.priority}</span>
          {item.estimated_hours && (
            <span className="text-zinc-500">{item.estimated_hours}h</span>
          )}
        </div>
        
        {item.assigned_dev && (
          <div className="text-xs text-zinc-400 truncate max-w-[80px]">
            {item.assigned_dev.name}
          </div>
        )}
      </div>
      
      {/* Actions */}
      <div className="mt-3 flex gap-2">
        {item.status === 'pending' && onAssign && (
          <button
            onClick={() => onAssign(item.unit_id)}
            className="flex-1 py-1.5 bg-white text-black rounded-lg text-xs font-medium hover:bg-muted"
            data-testid={`assign-btn-${item.unit_id}`}
          >
            Assign
          </button>
        )}
        {item.status === 'review' && onReview && (
          <button
            onClick={() => onReview(item.unit_id)}
            className="flex-1 py-1.5 bg-signal text-white rounded-lg text-xs font-medium hover:bg-signal"
            data-testid={`review-btn-${item.unit_id}`}
          >
            Review
          </button>
        )}
      </div>
    </div>
  );
};

const Modal = ({ title, children, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
    <div className="w-full max-w-md bg-[var(--t-surface)] border border-border rounded-2xl">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h3 className="font-semibold">{title}</h3>
        <button onClick={onClose} className="p-2 rounded-xl hover:bg-muted">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>
);

const ReviewModal = ({ unitId, onClose, onReview }) => {
  const [unit, setUnit] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUnit = async () => {
      try {
        const res = await axios.get(`${API}/admin/work-units/${unitId}`, { withCredentials: true });
        setUnit(res.data);
      } catch (error) {
        console.error('Error fetching unit:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchUnit();
  }, [unitId]);

  if (loading) {
    return (
      <Modal title="Review Submission" onClose={onClose}>
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
        </div>
      </Modal>
    );
  }

  const latestSubmission = unit?.submissions?.[0];

  return (
    <Modal title="Review Submission" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <div className="text-lg font-medium">{unit?.title}</div>
          <div className="text-sm text-zinc-500 mt-1">{unit?.assigned_dev?.name}</div>
        </div>
        
        {latestSubmission && (
          <div className="p-4 rounded-xl bg-black/50 border border-border">
            <div className="text-sm font-medium text-zinc-400 mb-2">Submission</div>
            <p className="text-white text-sm">{latestSubmission.summary}</p>
            {latestSubmission.links?.length > 0 && (
              <div className="mt-3 space-y-1">
                {latestSubmission.links.map((link, i) => (
                  <a
                    key={i}
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs text-signal hover:text-signal truncate"
                  >
                    {link}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
        
        <div>
          <label className="block text-sm text-zinc-400 mb-2">Feedback</label>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Add feedback for the developer..."
            className="w-full h-24 bg-background border border-border rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-signal"
            data-testid="review-feedback"
          />
        </div>
        
        <div className="flex gap-3">
          <button
            onClick={() => onReview(unitId, false, feedback)}
            className="flex-1 py-3 border border-orange-600 text-orange-400 rounded-xl font-medium hover:bg-orange-600/10"
            data-testid="request-revision-btn"
          >
            Request Revision
          </button>
          <button
            onClick={() => onReview(unitId, true, feedback)}
            className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-500"
            data-testid="approve-btn"
          >
            Approve
          </button>
        </div>
      </div>
    </Modal>
  );
};


export default ScopeBuilder;
