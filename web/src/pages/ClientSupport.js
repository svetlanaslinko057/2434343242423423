import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import {
  LifeBuoy,
  Plus,
  Bug,
  Lightbulb,
  HelpCircle,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronRight,
  MessageSquare,
  X
} from 'lucide-react';

const ClientSupport = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  
  const [newTicket, setNewTicket] = useState({
    title: '',
    description: '',
    ticket_type: 'bug',
    priority: 'medium',
    project_id: ''
  });
  
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [ticketsRes, projectsRes] = await Promise.all([
        runtime.get(`/api/client/support-tickets`),
        runtime.get(`/api/projects/mine`)
      ]);
      setTickets(ticketsRes.data);
      setProjects(projectsRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newTicket.title.trim() || !newTicket.description.trim()) return;
    
    setCreating(true);
    try {
      await runtime.post(`/api/client/support-tickets`, newTicket);
      setShowCreate(false);
      setNewTicket({ title: '', description: '', ticket_type: 'bug', priority: 'medium', project_id: '' });
      fetchData();
    } catch (error) {
      console.error('Error creating ticket:', error);
    } finally {
      setCreating(false);
    }
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'bug': return Bug;
      case 'improvement': return Lightbulb;
      case 'question': return HelpCircle;
      default: return MessageSquare;
    }
  };

  const filteredTickets = activeTab === 'all' 
    ? tickets 
    : tickets.filter(t => t.status === activeTab);

  const openCount = tickets.filter(t => t.status === 'open').length;
  const inProgressCount = tickets.filter(t => t.status === 'in_progress').length;
  const resolvedCount = tickets.filter(t => t.status === 'resolved').length;

  return (
    <div className="min-h-screen p-8" data-testid="client-support">
      {/* Background */}
      
      {/* Header */}
      <div className="relative flex items-center justify-between mb-10">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Support</h1>
          <p className="text-muted-foreground mt-2">Get help with your projects</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-6 py-3 bg-signal hover:bg-signal text-white rounded-xl font-medium transition-all shadow-lg shadow-signal/20"
          data-testid="new-ticket-btn"
        >
          <Plus className="w-4 h-4" />
          New Ticket
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard label="Total" value={tickets.length} icon={<LifeBuoy className="w-5 h-5" />} color="white" />
        <StatCard label="Open" value={openCount} icon={<AlertCircle className="w-5 h-5" />} color="amber" highlight={openCount > 0} />
        <StatCard label="In Progress" value={inProgressCount} icon={<Clock className="w-5 h-5" />} color="blue" />
        <StatCard label="Resolved" value={resolvedCount} icon={<CheckCircle2 className="w-5 h-5" />} color="emerald" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1 bg-muted rounded-xl border border-border mb-8 w-fit">
        {['all', 'open', 'in_progress', 'resolved'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2.5 rounded-lg text-sm transition-all ${
              activeTab === tab
                ? 'bg-signal text-white font-medium shadow-lg shadow-signal/20'
                : 'text-muted-foreground hover:text-white'
            }`}
          >
            {tab === 'all' ? 'All' : tab === 'in_progress' ? 'In Progress' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Tickets List */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-border border-t-signal rounded-full animate-spin" />
        </div>
      ) : filteredTickets.length === 0 ? (
        <div className="rounded-2xl border border-border bg-[var(--t-surface-raised)] p-16 text-center">
          <div className="w-20 h-20 rounded-2xl bg-muted mx-auto mb-6 flex items-center justify-center">
            <LifeBuoy className="w-10 h-10 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-semibold mb-2">No tickets yet</h3>
          <p className="text-muted-foreground mb-8 max-w-md mx-auto">Create a support ticket if you need help with your projects</p>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-8 py-4 bg-signal hover:bg-signal text-white rounded-xl font-medium transition-all shadow-lg shadow-signal/20"
          >
            <Plus className="w-4 h-4" />
            Create Your First Ticket
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTickets.map((ticket) => {
            const TypeIcon = getTypeIcon(ticket.ticket_type);
            return (
              <TicketCard 
                key={ticket.ticket_id}
                ticket={ticket}
                TypeIcon={TypeIcon}
              />
            );
          })}
        </div>
      )}

      {/* Create Ticket Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-surface border border-border rounded-2xl">
            <div className="flex items-center justify-between p-6 border-b border-border">
              <h2 className="text-xl font-semibold">New Support Ticket</h2>
              <button onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-white transition-colors p-2 hover:bg-muted rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-5">
              {/* Type Selection */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Type</label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: 'bug', label: 'Bug', icon: Bug, color: 'red' },
                    { id: 'improvement', label: 'Improvement', icon: Lightbulb, color: 'blue' },
                    { id: 'question', label: 'Question', icon: HelpCircle, color: 'white' }
                  ].map((type) => (
                    <button
                      key={type.id}
                      onClick={() => setNewTicket(prev => ({ ...prev, ticket_type: type.id }))}
                      className={`p-4 rounded-xl border text-center transition-all ${
                        newTicket.ticket_type === type.id
                          ? type.color === 'red' ? 'border-red-500/30 bg-red-500/10' :
                            type.color === 'blue' ? 'border-signal/30 bg-signal/10' :
                            'border-border bg-muted'
                          : 'border-border hover:border-border bg-[var(--t-surface-raised)]'
                      }`}
                    >
                      <type.icon className={`w-6 h-6 mx-auto mb-2 ${
                        newTicket.ticket_type === type.id 
                          ? type.color === 'red' ? 'text-red-400' : type.color === 'blue' ? 'text-signal' : 'text-white'
                          : 'text-muted-foreground'
                      }`} />
                      <span className="text-sm">{type.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Project */}
              {projects.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Project (optional)</label>
                  <select
                    value={newTicket.project_id}
                    onChange={(e) => setNewTicket(prev => ({ ...prev, project_id: e.target.value }))}
                    className="w-full bg-muted border border-border rounded-xl px-4 py-3.5 text-white focus:outline-none focus:border-signal/50 transition-all"
                  >
                    <option value="">General</option>
                    {projects.map(p => (
                      <option key={p.project_id} value={p.project_id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Title */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Title</label>
                <input
                  type="text"
                  value={newTicket.title}
                  onChange={(e) => setNewTicket(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Brief summary of the issue..."
                  className="w-full bg-muted border border-border rounded-xl px-4 py-3.5 text-white placeholder:text-muted-foreground focus:outline-none focus:border-signal/50 transition-all"
                  data-testid="ticket-title-input"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Description</label>
                <textarea
                  value={newTicket.description}
                  onChange={(e) => setNewTicket(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Describe the issue in detail..."
                  rows={4}
                  className="w-full bg-muted border border-border rounded-xl px-4 py-3.5 text-white placeholder:text-muted-foreground focus:outline-none focus:border-signal/50 resize-none transition-all"
                  data-testid="ticket-description-input"
                />
              </div>

              {/* Priority */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Priority</label>
                <div className="flex gap-3">
                  {['low', 'medium', 'high'].map((p) => (
                    <button
                      key={p}
                      onClick={() => setNewTicket(prev => ({ ...prev, priority: p }))}
                      className={`flex-1 py-3 rounded-xl text-sm capitalize transition-all ${
                        newTicket.priority === p
                          ? p === 'high' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                            p === 'medium' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                            'bg-muted text-white border border-border'
                          : 'border border-border text-muted-foreground hover:border-border bg-[var(--t-surface-raised)]'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-border flex gap-3">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 py-3.5 border border-border rounded-xl text-muted-foreground hover:text-white hover:border-border transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newTicket.title.trim() || !newTicket.description.trim()}
                className="flex-1 py-3.5 bg-signal hover:bg-signal text-white rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-2 transition-all shadow-lg shadow-signal/20"
                data-testid="submit-ticket-btn"
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Ticket'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Stat Card
const StatCard = ({ label, value, icon, color, highlight }) => {
  const colors = {
    blue: 'text-signal',
    amber: 'text-amber-400',
    emerald: 'text-emerald-400',
    white: 'text-muted-foreground'
  };
  
  return (
    <div className={`p-5 rounded-2xl border bg-[var(--t-surface-raised)] transition-all ${
      highlight ? 'border-amber-500/30 bg-signal/15' : 'border-border'
    }`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-muted-foreground tracking-wide uppercase">{label}</span>
        <span className={colors[color]}>{icon}</span>
      </div>
      <div className="text-3xl font-semibold text-white">{value}</div>
    </div>
  );
};

// Ticket Card
const TicketCard = ({ ticket, TypeIcon }) => {
  const getStatusStyles = (status) => {
    switch (status) {
      case 'open': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'in_progress': return 'bg-signal/10 text-signal border-signal/20';
      case 'resolved': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      default: return 'bg-muted text-muted-foreground border-border';
    }
  };

  const getPriorityStyles = (priority) => {
    switch (priority) {
      case 'high': return 'bg-red-500/10 text-red-400';
      case 'medium': return 'bg-amber-500/10 text-amber-400';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div
      className="p-5 rounded-2xl border border-border bg-[var(--t-surface-raised)] hover:border-signal/30 hover:bg-signal-soft transition-all cursor-pointer group"
      data-testid={`ticket-${ticket.ticket_id}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
            ticket.ticket_type === 'bug' ? 'bg-red-500/10' :
            ticket.ticket_type === 'improvement' ? 'bg-signal/10' :
            'bg-muted'
          }`}>
            <TypeIcon className={`w-5 h-5 ${
              ticket.ticket_type === 'bug' ? 'text-red-400' :
              ticket.ticket_type === 'improvement' ? 'text-signal' :
              'text-muted-foreground'
            }`} />
          </div>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h3 className="font-semibold group-hover:text-signal transition-colors">{ticket.title}</h3>
              <span className={`px-2.5 py-1 text-xs rounded-lg border ${getStatusStyles(ticket.status)}`}>
                {ticket.status === 'in_progress' ? 'In Progress' : ticket.status}
              </span>
              <span className={`px-2 py-0.5 text-xs rounded-lg ${getPriorityStyles(ticket.priority)}`}>
                {ticket.priority}
              </span>
            </div>
            <p className="text-muted-foreground text-sm line-clamp-1">{ticket.description}</p>
            {ticket.project_name && (
              <span className="text-muted-foreground text-xs mt-2 block">Project: {ticket.project_name}</span>
            )}
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-signal transition-colors" />
      </div>
    </div>
  );
};

export default ClientSupport;
