import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import {
  FolderKanban,
  Package,
  Plus,
  ChevronRight,
  Clock,
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
  Sparkles,
  LifeBuoy,
  TrendingUp
} from 'lucide-react';

const ClientDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [requests, setRequests] = useState([]);
  const [deliverables, setDeliverables] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [projectsRes, requestsRes, ticketsRes] = await Promise.all([
          runtime.get(`/api/projects/mine`),
          runtime.get(`/api/requests`),
          runtime.get(`/api/client/support-tickets`).catch(() => ({ data: [] }))
        ]);
        setProjects(projectsRes.data);
        setRequests(requestsRes.data);
        setTickets(ticketsRes.data);
        
        const allDeliverables = [];
        for (const project of projectsRes.data) {
          try {
            const dlvRes = await runtime.get(`/api/projects/${project.project_id}/deliverables`);
            allDeliverables.push(...dlvRes.data.map(d => ({ ...d, project_name: project.name })));
          } catch (e) {}
        }
        setDeliverables(allDeliverables);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const activeProjects = projects.filter(p => p.status === 'active').length;
  const pendingDeliverables = deliverables.filter(d => d.status === 'pending').length;
  const openTickets = tickets.filter(t => t.status === 'open').length;
  const completedProjects = projects.filter(p => p.status === 'completed').length;

  const getStageProgress = (stage) => {
    const stages = ['discovery', 'scope', 'design', 'development', 'qa', 'delivery', 'support'];
    const index = stages.indexOf(stage);
    return Math.round(((index + 1) / stages.length) * 100);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-border border-t-signal rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8" data-testid="client-dashboard">
      {/* Header */}
      <div className="relative mb-10">
        <h1 className="text-3xl font-semibold tracking-tight text-white relative">
          Welcome back, <span className="text-signal">{user?.name?.split(' ')[0] || 'Client'}</span>
        </h1>
        <p className="text-muted-foreground mt-2">Here's what needs your attention</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard 
          label="ACTIVE PROJECTS" 
          value={activeProjects} 
          icon={<FolderKanban className="w-5 h-5" />}
          color="blue"
        />
        <StatCard 
          label="PENDING" 
          value={pendingDeliverables} 
          icon={<Package className="w-5 h-5" />}
          color="amber"
          highlight={pendingDeliverables > 0}
        />
        <StatCard 
          label="OPEN TICKETS" 
          value={openTickets} 
          icon={<LifeBuoy className="w-5 h-5" />}
          color="white"
        />
        <StatCard 
          label="COMPLETED" 
          value={completedProjects} 
          icon={<CheckCircle2 className="w-5 h-5" />}
          color="emerald"
        />
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Main Content - Projects */}
        <div className="col-span-8 space-y-6">
          {/* Pending Deliverables Alert */}
          {pendingDeliverables > 0 && (
            <div className="p-5 rounded-2xl border border-amber-500/20 bg-signal/15">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-amber-400">Deliveries Awaiting Approval</h3>
                  <p className="text-sm text-muted-foreground">{pendingDeliverables} items ready for your review</p>
                </div>
              </div>
              <div className="space-y-2">
                {deliverables.filter(d => d.status === 'pending').slice(0, 3).map(dlv => (
                  <button
                    key={dlv.deliverable_id}
                    onClick={() => navigate(`/client/deliverable/${dlv.deliverable_id}`)}
                    className="w-full flex items-center justify-between p-4 rounded-xl bg-white/[0.03] border border-border hover:border-amber-500/30 hover:bg-white/[0.05] transition-all group"
                  >
                    <div className="flex items-center gap-3">
                      <Package className="w-4 h-4 text-amber-400" />
                      <span className="font-medium">{dlv.title}</span>
                      <span className="text-xs px-2 py-0.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        {dlv.version}
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-amber-400 transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Active Projects */}
          <div className="rounded-2xl border border-border bg-[var(--t-surface-raised)] overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FolderKanban className="w-5 h-5 text-signal" />
                <h2 className="font-semibold">Active Projects</h2>
              </div>
              <button 
                onClick={() => navigate('/client/projects')}
                className="text-sm text-muted-foreground hover:text-white flex items-center gap-1 transition-colors"
              >
                View all <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            
            <div className="p-4">
              {projects.length === 0 && requests.length === 0 ? (
                <div className="py-16 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-muted mx-auto mb-4 flex items-center justify-center">
                    <FolderKanban className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <h3 className="font-medium text-muted-foreground mb-2">No active projects</h3>
                  <p className="text-sm text-muted-foreground mb-6">Start your first project request</p>
                  <button
                    onClick={() => navigate('/client/request/new')}
                    className="inline-flex items-center gap-2 bg-signal hover:bg-signal/90 text-substrate font-medium px-6 py-3 rounded-xl transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    New Project
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {projects.slice(0, 5).map((project) => (
                    <ProjectCard 
                      key={project.project_id} 
                      project={project} 
                      onClick={() => navigate(`/client/project/${project.project_id}`)}
                      progress={getStageProgress(project.current_stage)}
                    />
                  ))}
                  
                  {requests.filter(r => r.status === 'pending').map((request) => (
                    <div
                      key={request.request_id}
                      className="p-4 rounded-xl border border-dashed border-border bg-white/[0.02]"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Clock className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium text-muted-foreground">{request.title}</span>
                        </div>
                        <span className="text-xs px-2 py-1 rounded-lg bg-muted text-muted-foreground">
                          Processing
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="col-span-4 space-y-6">
          {/* Support */}
          <div className="rounded-2xl border border-border bg-[var(--t-surface-raised)] overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center gap-3">
              <LifeBuoy className="w-5 h-5 text-muted-foreground" />
              <h2 className="font-semibold">Support</h2>
            </div>
            <div className="p-5">
              {tickets.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No tickets</p>
              ) : (
                <div className="space-y-2">
                  {tickets.slice(0, 3).map(ticket => (
                    <div key={ticket.ticket_id} className="p-3 rounded-xl bg-white/[0.03] text-sm">
                      <p className="text-muted-foreground truncate">{ticket.subject}</p>
                      <p className="text-xs text-muted-foreground mt-1">{ticket.status}</p>
                    </div>
                  ))}
                </div>
              )}
              <button 
                onClick={() => navigate('/client/support')}
                className="w-full mt-4 py-3 rounded-xl border border-border text-sm text-muted-foreground hover:text-white hover:border-border hover:bg-muted transition-all"
              >
                View All Tickets
              </button>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="rounded-2xl border border-border bg-[var(--t-surface-raised)] overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="font-semibold">Quick Actions</h2>
            </div>
            <div className="p-4 space-y-2">
              <QuickAction 
                icon={<Plus className="w-4 h-4" />}
                label="New Project"
                onClick={() => navigate('/client/request/new')}
              />
              <QuickAction 
                icon={<LifeBuoy className="w-4 h-4" />}
                label="Get Support"
                onClick={() => navigate('/client/support/new')}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Stat Card Component
const StatCard = ({ label, value, icon, color, highlight }) => {
  const colors = {
    blue: 'text-signal',
    amber: 'text-amber-400',
    emerald: 'text-emerald-400',
    white: 'text-muted-foreground'
  };
  
  return (
    <div className={`p-5 rounded-2xl border bg-[var(--t-surface-raised)] transition-all ${
      highlight 
        ? 'border-amber-500/30 bg-signal/15' 
        : 'border-border'
    }`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-muted-foreground tracking-wide">{label}</span>
        <span className={colors[color]}>{icon}</span>
      </div>
      <div className="text-3xl font-semibold text-white">{value}</div>
    </div>
  );
};

// Project Card Component
const ProjectCard = ({ project, onClick, progress }) => (
  <button
    onClick={onClick}
    className="w-full p-4 rounded-xl border border-border bg-white/[0.02] hover:border-signal/30 hover:bg-white/[0.04] transition-all group text-left"
  >
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-3">
        <h3 className="font-medium">{project.name}</h3>
        <span className={`text-xs px-2 py-0.5 rounded-lg border ${
          project.status === 'active' 
            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
            : 'bg-muted text-muted-foreground border-border'
        }`}>
          {project.status}
        </span>
      </div>
      <ArrowUpRight className="w-4 h-4 text-muted-foreground group-hover:text-signal transition-colors" />
    </div>
    <div className="flex items-center gap-3">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div 
          className="h-full bg-signal rounded-full transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground">{progress}%</span>
    </div>
  </button>
);

// Quick Action Component
const QuickAction = ({ icon, label, onClick }) => (
  <button
    onClick={onClick}
    className="w-full flex items-center gap-3 p-4 rounded-xl text-left text-muted-foreground hover:text-white hover:bg-muted transition-all group"
  >
    <span className="text-muted-foreground group-hover:text-signal transition-colors">{icon}</span>
    <span className="text-sm font-medium">{label}</span>
  </button>
);

export default ClientDashboard;
