import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '@/App';
import axios from 'axios';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Play,
  Clock,
  AlertCircle,
  CheckCircle2,
  Search,
  Loader2,
  X,
  Send,
  Timer,
  ChevronRight
} from 'lucide-react';

const ALLOWED_TRANSITIONS = {
  assigned: ['in_progress'],
  in_progress: ['review'],
  revision: ['in_progress'],
  review: [],
  submitted: [],
  validation: [],
  done: [],
  completed: [],
};

const COLUMNS = [
  { id: 'assigned', title: 'Assigned', color: 'blue' },
  { id: 'in_progress', title: 'In Progress', color: 'amber' },
  { id: 'review', title: 'Review', color: 'cyan' },
  { id: 'revision', title: 'Revision', color: 'red' },
  { id: 'completed', title: 'Done', color: 'emerald' },
];

const STATUS_MAP = {
  assigned: 'assigned',
  in_progress: 'in_progress',
  submitted: 'review',
  review: 'review',
  validation: 'review',
  revision: 'revision',
  completed: 'completed',
  done: 'completed',
};

const ExecutorBoard = () => {
  const navigate = useNavigate();
  const [workUnits, setWorkUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [submissionModal, setSubmissionModal] = useState({ open: false, unitId: null });
  const [submissionData, setSubmissionData] = useState({ summary: '', links: '' });
  const [submitting, setSubmitting] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const fetchWorkUnits = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/developer/work-units`, { withCredentials: true });
      setWorkUnits(res.data);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkUnits();
  }, [fetchWorkUnits]);

  const getColumnUnits = (columnId) => {
    return workUnits.filter(unit => {
      const mappedStatus = STATUS_MAP[unit.status] || unit.status;
      if (mappedStatus !== columnId) return false;
      if (searchQuery && !unit.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  };

  const stats = {
    assigned: workUnits.filter(u => u.status === 'assigned').length,
    in_progress: workUnits.filter(u => u.status === 'in_progress').length,
    review: workUnits.filter(u => ['submitted', 'review', 'validation'].includes(u.status)).length,
    revision: workUnits.filter(u => u.status === 'revision').length,
  };

  const handleDragStart = (event) => setActiveId(event.active.id);

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const unit = workUnits.find(u => u.unit_id === active.id);
    if (!unit) return;

    const currentColumn = STATUS_MAP[unit.status] || unit.status;
    const targetColumn = over.id;
    if (currentColumn === targetColumn) return;

    const allowedTargets = ALLOWED_TRANSITIONS[unit.status] || [];
    let targetStatus = targetColumn;
    if (targetColumn === 'review') targetStatus = 'submitted';
    if (targetColumn === 'completed') return;

    if (!allowedTargets.includes(targetStatus)) return;

    if (unit.status === 'in_progress' && targetStatus === 'submitted') {
      setSubmissionModal({ open: true, unitId: unit.unit_id });
      return;
    }

    await executeTransition(unit.unit_id, targetStatus);
  };

  const executeTransition = async (unitId, newStatus) => {
    try {
      if (newStatus === 'in_progress') {
        await axios.post(`${API}/developer/work-units/${unitId}/start`, {}, { withCredentials: true });
      } else {
        await axios.patch(`${API}/work-units/${unitId}/status`, { status: newStatus }, { withCredentials: true });
      }
      await fetchWorkUnits();
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const handleSubmit = async () => {
    if (!submissionData.summary.trim()) return;
    setSubmitting(true);
    try {
      const links = submissionData.links.split('\n').map(l => l.trim()).filter(l => l);
      await axios.post(`${API}/work-units/${submissionModal.unitId}/submit`, 
        { summary: submissionData.summary, links, attachments: [] },
        { withCredentials: true }
      );
      setSubmissionModal({ open: false, unitId: null });
      setSubmissionData({ summary: '', links: '' });
      await fetchWorkUnits();
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const activeUnit = activeId ? workUnits.find(u => u.unit_id === activeId) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-border border-t-signal rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" data-testid="executor-board">
      {/* Background */}
      
      {/* Header */}
      <div className="p-8 border-b border-border">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Work Board</h1>
            <p className="text-muted-foreground mt-2">Drag tasks to update status</p>
          </div>
          
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tasks..."
              className="w-72 bg-muted border border-border rounded-xl pl-11 pr-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-signal/50 transition-all"
              data-testid="search-input"
            />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Assigned" value={stats.assigned} color="blue" />
          <StatCard label="In Progress" value={stats.in_progress} color="amber" />
          <StatCard label="Review" value={stats.review} color="cyan" />
          <StatCard label="Revision" value={stats.revision} color="red" highlight={stats.revision > 0} />
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-x-auto p-8">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 min-w-max h-full">
            {COLUMNS.map(column => (
              <BoardColumn
                key={column.id}
                column={column}
                units={getColumnUnits(column.id)}
                onOpenUnit={(unitId) => navigate(`/developer/work/${unitId}`)}
                onStartWork={(unitId) => executeTransition(unitId, 'in_progress')}
              />
            ))}
          </div>
          
          <DragOverlay>
            {activeUnit && <TaskCard unit={activeUnit} isDragging />}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Submission Modal */}
      {submissionModal.open && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-surface border border-border rounded-2xl" data-testid="submission-modal">
            <div className="p-6 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Submit for Review</h2>
                <p className="text-sm text-muted-foreground">Describe completed work</p>
              </div>
              <button
                onClick={() => {
                  setSubmissionModal({ open: false, unitId: null });
                  setSubmissionData({ summary: '', links: '' });
                }}
                className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-2">Summary *</label>
                <textarea
                  value={submissionData.summary}
                  onChange={(e) => setSubmissionData({ ...submissionData, summary: e.target.value })}
                  placeholder="What was completed..."
                  rows={4}
                  className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-signal/50 resize-none transition-all"
                  data-testid="submission-summary"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-2">Links (one per line)</label>
                <textarea
                  value={submissionData.links}
                  onChange={(e) => setSubmissionData({ ...submissionData, links: e.target.value })}
                  placeholder="https://..."
                  rows={3}
                  className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-signal/50 resize-none font-mono text-sm transition-all"
                  data-testid="submission-links"
                />
              </div>
            </div>

            <div className="p-6 border-t border-border flex gap-3">
              <button
                onClick={() => {
                  setSubmissionModal({ open: false, unitId: null });
                  setSubmissionData({ summary: '', links: '' });
                }}
                className="flex-1 py-3 border border-border rounded-xl text-muted-foreground hover:text-foreground hover:border-border transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!submissionData.summary.trim() || submitting}
                className="flex-1 py-3 bg-signal hover:bg-signal text-signal-ink rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-2 transition-all shadow-lg shadow-signal/20"
                data-testid="submit-btn"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard = ({ label, value, color, highlight }) => {
  const colors = {
    blue: 'text-signal',
    amber: 'text-warning',
    cyan: 'text-signal',
    red: 'text-danger',
    emerald: 'text-success'
  };
  
  return (
    <div className={`p-5 rounded-2xl border bg-[var(--t-surface-raised)] transition-all ${
      highlight ? 'border-danger/30 bg-signal/15' : 'border-border'
    }`}>
      <div className="text-3xl font-semibold text-foreground mb-1">{value}</div>
      <div className={`text-sm ${colors[color]}`}>{label}</div>
    </div>
  );
};

const BoardColumn = ({ column, units, onOpenUnit, onStartWork }) => {
  const { setNodeRef } = useSortable({ id: column.id, data: { type: 'column' } });
  
  const colors = {
    blue: 'border-signal/20',
    amber: 'border-warning/20',
    cyan: 'border-signal/20',
    red: 'border-danger/20',
    emerald: 'border-success/20'
  };

  return (
    <div
      ref={setNodeRef}
      className={`w-[300px] rounded-2xl border bg-[var(--t-surface-raised)] flex flex-col ${colors[column.color]}`}
      data-testid={`column-${column.id}`}
    >
      <div className="p-4 border-b border-border flex items-center justify-between">
        <span className="font-medium">{column.title}</span>
        <span className="text-xs px-2 py-1 bg-muted rounded-lg text-muted-foreground">{units.length}</span>
      </div>

      <div className="flex-1 p-3 space-y-3 overflow-y-auto min-h-[400px]">
        <SortableContext items={units.map(u => u.unit_id)} strategy={verticalListSortingStrategy}>
          {units.map(unit => (
            <SortableCard
              key={unit.unit_id}
              unit={unit}
              onOpen={() => onOpenUnit(unit.unit_id)}
              onStart={() => onStartWork(unit.unit_id)}
            />
          ))}
        </SortableContext>
        
        {units.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">No tasks</div>
        )}
      </div>
    </div>
  );
};

const SortableCard = ({ unit, onOpen, onStart }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: unit.unit_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard unit={unit} onOpen={onOpen} onStart={onStart} />
    </div>
  );
};

const TaskCard = ({ unit, onOpen, onStart, isDragging }) => {
  const isRevision = unit.status === 'revision';
  
  return (
    <div
      className={`p-4 rounded-xl border bg-surface transition-all cursor-grab active:cursor-grabbing ${
        isDragging ? 'border-signal/30 shadow-xl' : 
        isRevision ? 'border-danger/30' : 
        'border-border hover:border-signal/30'
      }`}
      data-testid={`task-${unit.unit_id}`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <h4 className="font-medium text-sm">{unit.title}</h4>
        <StatusIcon status={unit.status} />
      </div>

      <p className="text-xs text-muted-foreground mb-3">{unit.project_name || 'Project'}</p>

      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
        <span className="flex items-center gap-1">
          <Timer className="w-3 h-3" />
          {unit.estimated_hours || 0}h est
        </span>
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {unit.actual_hours || 0}h logged
        </span>
      </div>

      {isRevision && (
        <div className="p-3 rounded-lg border border-danger/20 bg-danger/10 text-xs text-danger mb-4 flex items-center gap-2">
          <AlertCircle className="w-3 h-3" />
          Revision required
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); onOpen?.(); }}
          className="flex-1 py-2.5 bg-signal hover:bg-signal text-signal-ink text-sm rounded-lg font-medium transition-all"
          data-testid={`open-${unit.unit_id}`}
        >
          Open
        </button>
        {unit.status === 'assigned' && (
          <button
            onClick={(e) => { e.stopPropagation(); onStart?.(); }}
            className="py-2.5 px-4 border border-border hover:border-border text-muted-foreground hover:text-foreground text-sm rounded-lg transition-all"
            data-testid={`start-${unit.unit_id}`}
          >
            Start
          </button>
        )}
      </div>
    </div>
  );
};

const StatusIcon = ({ status }) => {
  const configs = {
    assigned: { icon: Play, bg: 'bg-signal/10', color: 'text-signal' },
    in_progress: { icon: Play, bg: 'bg-warning/10', color: 'text-warning' },
    submitted: { icon: Clock, bg: 'bg-signal/10', color: 'text-signal' },
    review: { icon: Clock, bg: 'bg-signal/10', color: 'text-signal' },
    revision: { icon: AlertCircle, bg: 'bg-danger/10', color: 'text-danger' },
    completed: { icon: CheckCircle2, bg: 'bg-success/10', color: 'text-success' },
  };
  
  const config = configs[status] || configs.assigned;
  const Icon = config.icon;
  
  return (
    <div className={`w-7 h-7 rounded-lg ${config.bg} flex items-center justify-center`}>
      <Icon className={`w-3.5 h-3.5 ${config.color}`} />
    </div>
  );
};

export default ExecutorBoard;
