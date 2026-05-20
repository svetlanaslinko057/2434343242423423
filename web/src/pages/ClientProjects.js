import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import {
  Search,
  ChevronRight,
  Trash2,
  Clock,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  FileText,
  Zap,
  MoreHorizontal
} from 'lucide-react';

const ClientProjects = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [deleteModal, setDeleteModal] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [projectsRes, requestsRes] = await Promise.all([
        runtime.get(`/api/projects/mine`).catch(() => ({ data: [] })),
        runtime.get(`/api/requests/mine`).catch(() => ({ data: [] }))
      ]);
      setProjects(projectsRes.data || []);
      setRequests(requestsRes.data || []);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (item, type) => {
    setDeleting(true);
    try {
      if (type === 'request') {
        await runtime.delete(`/api/requests/${item.request_id}`);
      } else {
        await runtime.delete(`/api/projects/${item.project_id}`);
      }
      setDeleteModal(null);
      fetchData();
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  // Combine projects and requests
  const allItems = [
    ...requests.map(r => ({ ...r, type: 'request', id: r.request_id, status: r.status || 'idea_submitted' })),
    ...projects.map(p => ({ ...p, type: 'project', id: p.project_id, status: mapProjectStatus(p) }))
  ];
  
  // Sort
  const sortedItems = [...allItems].sort((a, b) => {
    if (sortBy === 'newest') return new Date(b.created_at) - new Date(a.created_at);
    if (sortBy === 'oldest') return new Date(a.created_at) - new Date(b.created_at);
    if (sortBy === 'name') return (a.title || a.name || '').localeCompare(b.title || b.name || '');
    return 0;
  });

  // Filter
  const filteredItems = sortedItems.filter(item => {
    const matchesSearch = item.title?.toLowerCase().includes(search.toLowerCase()) ||
                         item.name?.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === 'all' || 
                         (filter === 'active' && ['active', 'development', 'design'].includes(item.status)) ||
                         (filter === 'pending' && ['idea_submitted', 'reviewing', 'proposal_ready', 'awaiting_approval', 'pending'].includes(item.status)) ||
                         (filter === 'completed' && item.status === 'completed');
    return matchesSearch && matchesFilter;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-border border-t-signal rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8 max-w-5xl mx-auto" data-testid="client-projects">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight mb-2">Your Projects</h1>
        <p className="text-muted-foreground">{allItems.length} total projects</p>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="w-full bg-[var(--t-surface-raised)] border border-border rounded-xl pl-12 pr-4 py-3 text-white placeholder:text-muted-foreground focus:outline-none focus:border-signal/50"
          />
        </div>
        
        {/* Filter Tabs */}
        <div className="flex bg-[var(--t-surface-raised)] border border-border rounded-xl p-1">
          {['all', 'pending', 'active', 'completed'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize ${
                filter === f ? 'bg-signal text-white' : 'text-muted-foreground hover:text-white'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        
        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="bg-[var(--t-surface-raised)] border border-border rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-signal/50 cursor-pointer"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">By name</option>
        </select>
      </div>

      {/* Projects List */}
      {filteredItems.length === 0 ? (
        <div className="rounded-2xl bg-[var(--t-surface-raised)] border border-border p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-muted mx-auto mb-4 flex items-center justify-center">
            <FileText className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No projects found</h3>
          <p className="text-muted-foreground mb-6">Start building your first product</p>
          <button
            onClick={() => navigate('/client/dashboard')}
            className="px-6 py-3 bg-signal hover:bg-signal text-white rounded-xl font-medium transition-all"
          >
            Create Project
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map(item => (
            <ProjectCard
              key={item.id}
              item={item}
              onOpen={() => navigate(`/client/project/${item.id}`)}
              onDelete={() => setDeleteModal(item)}
            />
          ))}
        </div>
      )}

      {/* Delete Modal */}
      {deleteModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[var(--t-surface-raised)] border border-border rounded-2xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-xl bg-red-500/20 flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Delete Project?</h3>
                <p className="text-sm text-muted-foreground">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-muted-foreground mb-6">
              Are you sure you want to delete "<span className="text-white font-medium">{deleteModal.title || deleteModal.name}</span>"?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteModal(null)}
                className="flex-1 py-3 border border-border rounded-xl text-muted-foreground hover:text-white hover:border-border transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteModal, deleteModal.type)}
                disabled={deleting}
                className="flex-1 py-3 bg-red-500 hover:bg-red-400 text-white rounded-xl font-medium transition-all disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const mapProjectStatus = (project) => {
  const stage = project.current_stage || project.status;
  const mapping = {
    'pending': 'idea_submitted',
    'discovery': 'reviewing',
    'scope': 'proposal_ready',
    'design': 'active',
    'development': 'active',
    'qa': 'delivery',
    'delivery': 'delivery',
    'completed': 'completed',
    'active': 'active'
  };
  return mapping[stage] || stage;
};

const ProjectCard = ({ item, onOpen, onDelete }) => {
  const status = item.status;
  
  const statusConfig = {
    idea_submitted: { 
      label: 'Submitted', 
      color: 'text-amber-400 bg-amber-500/10',
      icon: Clock,
      message: 'Your idea is being reviewed'
    },
    pending: { 
      label: 'Submitted', 
      color: 'text-amber-400 bg-amber-500/10',
      icon: Clock,
      message: 'Your idea is being reviewed'
    },
    reviewing: { 
      label: 'Reviewing', 
      color: 'text-signal bg-signal/10',
      icon: Sparkles,
      message: 'We are analyzing your request'
    },
    proposal_ready: { 
      label: 'Proposal Ready', 
      color: 'text-signal bg-signal/10',
      icon: FileText,
      message: 'Your project plan is ready'
    },
    awaiting_approval: { 
      label: 'Awaiting Approval', 
      color: 'text-signal bg-signal/10',
      icon: Clock,
      message: 'Waiting for your approval to start'
    },
    active: { 
      label: 'Active', 
      color: 'text-emerald-400 bg-emerald-500/10',
      icon: Zap,
      message: 'Development in progress'
    },
    delivery: { 
      label: 'Delivery', 
      color: 'text-signal bg-signal/10',
      icon: FileText,
      message: 'Deliverables ready for review'
    },
    completed: { 
      label: 'Completed', 
      color: 'text-emerald-400 bg-emerald-500/10',
      icon: CheckCircle2,
      message: 'Project completed'
    },
  }[status] || { 
    label: status, 
    color: 'text-zinc-400 bg-zinc-500/10',
    icon: Clock,
    message: 'Processing'
  };

  const StatusIcon = statusConfig.icon;
  const canDelete = !['active', 'delivery'].includes(status);

  return (
    <div 
      className="group rounded-2xl bg-[var(--t-surface-raised)] border border-border p-5 hover:border-border transition-all"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onOpen}>
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-lg font-semibold truncate group-hover:text-signal transition-colors">
              {item.title || item.name}
            </h3>
          </div>
          <p className="text-muted-foreground text-sm mb-3 line-clamp-1">
            {item.description || item.business_idea}
          </p>
          <div className="flex items-center gap-2 text-sm">
            <StatusIcon className="w-4 h-4 text-muted-foreground" />
            <span className="text-muted-foreground">{statusConfig.message}</span>
          </div>
        </div>

        {/* Unified Action Buttons */}
        <div className="flex items-center gap-2 shrink-0 ml-4">
          <span className={`px-3 py-1.5 text-xs font-medium rounded-lg ${statusConfig.color}`} data-testid={`status-badge-${item.id}`}>
            {statusConfig.label}
          </span>
          <button
            onClick={onOpen}
            className="px-4 py-1.5 bg-muted hover:bg-muted text-white text-xs font-medium rounded-lg border border-border hover:border-border transition-all"
            data-testid={`open-btn-${item.id}`}
          >
            Open
          </button>
          {canDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded-lg border border-border hover:border-red-500/20 transition-all"
              data-testid={`delete-btn-${item.id}`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClientProjects;
