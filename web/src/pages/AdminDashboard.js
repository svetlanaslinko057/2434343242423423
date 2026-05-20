import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import axios from 'axios';
import {
  LayoutDashboard,
  Users,
  FolderKanban,
  ClipboardList,
  FileCheck,
  TestTube,
  Package,
  LogOut,
  Bell,
  ChevronRight,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Plus,
  Settings,
  Activity,
  Shield,
  FileText,
  Trash2,
  Copy,
  DollarSign,
  Tag,
  Loader2,
  FolderOpen,
  TrendingUp
} from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useRealtimeEvents } from '@/hooks/useRealtime';
import { Zap } from 'lucide-react';

const AdminDashboard = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Map URL to tab
  const getTabFromPath = () => {
    const path = location.pathname;
    if (path.includes('/requests')) return 'requests';
    if (path.includes('/projects')) return 'projects';
    if (path.includes('/review')) return 'review-queue';
    if (path.includes('/validation')) return 'validation';
    if (path.includes('/users')) return 'users';
    if (path.includes('/templates')) return 'scope-templates';
    if (path.includes('/settings')) return 'settings';
    return 'work-board';
  };
  
  const [activeTab, setActiveTab] = useState(getTabFromPath());
  const [data, setData] = useState({
    users: [],
    requests: [],
    projects: [],
    workUnits: [],
    submissions: [],
    supportTickets: [],
    scopeTemplates: []
  });
  const [loading, setLoading] = useState(true);
  // Live system adjustments feed (auto-rebalancer). Kept neutral, capped at 5.
  const [rebalances, setRebalances] = useState([]);

  useRealtimeEvents({
    'admin.auto_rebalanced': (payload) => {
      setRebalances((prev) => [{
        module_id: payload?.module_id,
        module_title: payload?.module_title,
        at: payload?.at || payload?.timestamp,
      }, ...prev].slice(0, 5));
    },
  });
  
  // Scope Templates state
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [newTemplate, setNewTemplate] = useState({
    name: '',
    category: 'web_app',
    description: '',
    tasks: [],
    tags: []
  });
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    task_type: 'task',
    priority: 'medium',
    estimated_hours: 4
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [usersRes, requestsRes, projectsRes, workUnitsRes, submissionsRes, ticketsRes, templatesRes] = await Promise.all([
          axios.get(`${API}/admin/users`, { withCredentials: true }),
          axios.get(`${API}/admin/requests`, { withCredentials: true }),
          axios.get(`${API}/admin/projects`, { withCredentials: true }),
          axios.get(`${API}/admin/work-units`, { withCredentials: true }),
          axios.get(`${API}/admin/submissions`, { withCredentials: true }),
          axios.get(`${API}/admin/support-tickets`, { withCredentials: true }),
          axios.get(`${API}/admin/scope-templates`, { withCredentials: true }).catch(() => ({ data: [] }))
        ]);
        setData({
          users: usersRes.data,
          requests: requestsRes.data,
          projects: projectsRes.data,
          workUnits: workUnitsRes.data,
          submissions: submissionsRes.data,
          supportTickets: ticketsRes.data,
          scopeTemplates: templatesRes.data || []
        });
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

  const navItems = [
    { id: 'master-admin', label: 'Master Admin', icon: Shield, route: '/admin/master' },
    { id: 'control-center', label: 'Control Center', icon: Activity, route: '/admin/control-center' },
    { id: 'work-board', label: 'Work Board', icon: LayoutDashboard },
    { id: 'requests', label: 'Requests', icon: ClipboardList },
    { id: 'projects', label: 'Projects', icon: FolderKanban },
    { id: 'review-queue', label: 'Review Queue', icon: FileCheck },
    { id: 'validation', label: 'Validation', icon: TestTube },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'scope-templates', label: 'Scope Templates', icon: FileText },
  ];

  const getStatusBadge = (status) => {
    const styles = {
      pending: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      approved: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      completed: 'bg-signal/10 text-signal border-signal/20',
      rejected: 'bg-red-500/10 text-red-400 border-red-500/20',
      in_progress: 'bg-signal/10 text-signal border-signal/20',
      submitted: 'bg-signal/10 text-signal border-signal/20',
    };
    return styles[status] || 'bg-muted text-muted-foreground border-border';
  };

  const pendingRequests = data.requests.filter(r => r.status === 'pending');
  const pendingSubmissions = data.submissions.filter(s => s.status === 'pending');
  const activeProjects = data.projects.filter(p => p.status === 'active');

  // Get page title based on active tab
  const getPageTitle = () => {
    const titles = {
      'work-board': 'Work Board',
      'requests': 'Requests',
      'projects': 'Projects',
      'review-queue': 'Review Queue',
      'validation': 'Validation',
      'users': 'Users',
      'scope-templates': 'Scope Templates',
      'settings': 'Settings'
    };
    return titles[activeTab] || 'Dashboard';
  };

  return (
    <div className="min-h-screen bg-background" data-testid="admin-dashboard">
      {/* Header */}
      <header className="border-b border-border px-6 py-4 sticky top-0 bg-background/95 backdrop-blur-sm z-10">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">{getPageTitle()}</h1>
          <button className="w-9 h-9 flex items-center justify-center text-muted-foreground hover:text-foreground">
            <Bell className="w-5 h-5" strokeWidth={1.5} />
          </button>
        </div>
      </header>

      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-2 border-border border-t-white rounded-full animate-spin" />
          </div>
        ) : (
          <>
              {/* Work Board */}
              {activeTab === 'work-board' && (
                <div className="space-y-6">
                  {/* Overview Stats */}
                  <div className="grid grid-cols-4 gap-4">
                    <div className="border border-border rounded-2xl p-4">
                      <div className="text-muted-foreground text-sm mb-1">Pending Requests</div>
                      <div className="text-2xl font-bold">{pendingRequests.length}</div>
                    </div>
                    <div className="border border-border rounded-2xl p-4">
                      <div className="text-muted-foreground text-sm mb-1">Active Projects</div>
                      <div className="text-2xl font-bold">{activeProjects.length}</div>
                    </div>
                    <div className="border border-border rounded-2xl p-4">
                      <div className="text-muted-foreground text-sm mb-1">Work Units</div>
                      <div className="text-2xl font-bold">{data.workUnits.length}</div>
                    </div>
                    <div className="border border-border rounded-2xl p-4">
                      <div className="text-muted-foreground text-sm mb-1">Pending Reviews</div>
                      <div className="text-2xl font-bold">{pendingSubmissions.length}</div>
                    </div>
                  </div>

                  {/* Live system adjustments — auto-balancer events */}
                  {rebalances.length > 0 && (
                    <div
                      className="border border-border rounded-2xl p-4"
                      data-testid="system-adjustments"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="w-4 h-4 text-amber-400" />
                        <span className="text-sm font-semibold tracking-wide">
                          System adjustments
                        </span>
                        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      </div>
                      <ul className="space-y-1">
                        {rebalances.map((r, i) => (
                          <li
                            key={`${r.module_id}-${i}`}
                            className="text-sm text-muted-foreground"
                          >
                            • Module reassigned to keep progress stable
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Quick Actions */}
                  <div className="grid grid-cols-3 gap-4">
                    {pendingRequests.length > 0 && (
                      <div className="border border-amber-500/30 bg-amber-500/5 p-4">
                        <div className="flex items-center gap-2 text-amber-400 mb-2">
                          <AlertTriangle className="w-4 h-4" />
                          <span className="text-sm font-medium">Action Required</span>
                        </div>
                        <p className="text-sm text-muted-foreground">{pendingRequests.length} requests need processing</p>
                        <button 
                          onClick={() => setActiveTab('requests')}
                          className="mt-3 text-sm text-amber-400 flex items-center gap-1"
                        >
                          View Requests <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                    {pendingSubmissions.length > 0 && (
                      <div className="border border-signal/30 bg-signal/5 p-4">
                        <div className="flex items-center gap-2 text-signal mb-2">
                          <FileCheck className="w-4 h-4" />
                          <span className="text-sm font-medium">Reviews Pending</span>
                        </div>
                        <p className="text-sm text-muted-foreground">{pendingSubmissions.length} submissions to review</p>
                        <button 
                          onClick={() => setActiveTab('review-queue')}
                          className="mt-3 text-sm text-signal flex items-center gap-1"
                        >
                          View Queue <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Recent Activity */}
                  <div>
                    <h2 className="text-lg font-semibold mb-4">Active Projects</h2>
                    {activeProjects.length === 0 ? (
                      <div className="border border-border rounded-2xl p-8 text-center text-muted-foreground">
                        No active projects
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {activeProjects.slice(0, 5).map((project) => (
                          <div key={project.project_id} className="border border-border rounded-xl p-4 flex items-center justify-between">
                            <div>
                              <h3 className="font-medium">{project.name}</h3>
                              <span className="text-muted-foreground text-sm capitalize">{project.current_stage}</span>
                            </div>
                            <span className={`px-2 py-0.5 text-xs rounded-lg border ${getStatusBadge(project.status)}`}>
                              {project.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Requests */}
              {activeTab === 'requests' && (
                <div className="space-y-4">
                  {data.requests.length === 0 ? (
                    <div className="border border-border rounded-2xl p-12 text-center text-muted-foreground">
                      No requests yet
                    </div>
                  ) : (
                    data.requests.map((request) => (
                      <RequestCard 
                        key={request.request_id} 
                        request={request} 
                        onRefresh={fetchData}
                        navigate={navigate}
                      />
                    ))
                  )}
                </div>
              )}

              {/* Projects */}
              {activeTab === 'projects' && (
                <div className="space-y-4">
                  {data.projects.length === 0 ? (
                    <div className="border border-border rounded-2xl p-12 text-center text-muted-foreground">
                      No projects yet
                    </div>
                  ) : (
                    data.projects.map((project) => (
                      <div key={project.project_id} className="border border-border rounded-2xl p-5">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="font-medium">{project.name}</h3>
                            <div className="flex items-center gap-3 mt-2">
                              <span className={`px-2 py-0.5 text-xs rounded-lg border ${getStatusBadge(project.status)}`}>
                                {project.status}
                              </span>
                              <span className="text-muted-foreground text-sm capitalize">{project.current_stage}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => navigate(`/admin/deliverable-builder/${project.project_id}`)}
                              className="px-4 py-2 bg-emerald-500 text-foreground text-sm font-medium rounded-xl"
                            >
                              Create Deliverable
                            </button>
                            <button className="px-4 py-2 border border-border rounded-xl text-sm">
                              Manage
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Review Queue */}
              {activeTab === 'review-queue' && (
                <div className="space-y-4">
                  {pendingSubmissions.length === 0 ? (
                    <div className="border border-border rounded-2xl p-12 text-center text-muted-foreground">
                      No pending submissions
                    </div>
                  ) : (
                    pendingSubmissions.map((submission) => (
                      <div key={submission.submission_id} className="border border-border rounded-2xl p-5">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h3 className="font-medium">Submission #{submission.submission_id.slice(-6)}</h3>
                            <p className="text-muted-foreground text-sm mt-1">{submission.summary}</p>
                          </div>
                          <span className={`px-2 py-0.5 text-xs rounded-lg border ${getStatusBadge(submission.status)}`}>
                            {submission.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-4">
                          <button className="px-4 py-2 bg-emerald-500 text-foreground text-sm font-medium rounded-xl">
                            Approve
                          </button>
                          <button className="px-4 py-2 bg-amber-500 text-black text-sm font-medium rounded-xl">
                            Request Revision
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Validation */}
              {activeTab === 'validation' && (
                <div className="border border-border rounded-2xl p-12 text-center text-muted-foreground">
                  <TestTube className="w-8 h-8 mx-auto mb-3 opacity-50" />
                  <p>No validation tasks pending</p>
                </div>
              )}

              {/* Users */}
              {activeTab === 'users' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-4 gap-4 mb-6">
                    <div className="border border-border rounded-2xl p-4">
                      <div className="text-muted-foreground text-sm mb-1">Total Users</div>
                      <div className="text-2xl font-bold">{data.users.length}</div>
                    </div>
                    <div className="border border-border rounded-2xl p-4">
                      <div className="text-muted-foreground text-sm mb-1">Clients</div>
                      <div className="text-2xl font-bold">{data.users.filter(u => u.role === 'client').length}</div>
                    </div>
                    <div className="border border-border rounded-2xl p-4">
                      <div className="text-muted-foreground text-sm mb-1">Developers</div>
                      <div className="text-2xl font-bold">{data.users.filter(u => u.role === 'developer').length}</div>
                    </div>
                    <div className="border border-border rounded-2xl p-4">
                      <div className="text-muted-foreground text-sm mb-1">Testers</div>
                      <div className="text-2xl font-bold">{data.users.filter(u => u.role === 'tester').length}</div>
                    </div>
                  </div>

                  {data.users.map((u) => (
                    <div key={u.user_id} className="border border-border rounded-xl p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
                          {u.name?.[0] || u.email?.[0]}
                        </div>
                        <div>
                          <div className="font-medium">{u.name || u.email}</div>
                          <div className="text-muted-foreground text-sm">{u.email}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-0.5 text-xs rounded-lg border capitalize ${
                          u.role === 'admin' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                          u.role === 'developer' ? 'bg-signal/10 text-signal border-signal/20' :
                          u.role === 'tester' ? 'bg-signal/10 text-signal border-signal/20' :
                          'bg-muted text-muted-foreground border-border'
                        }`}>
                          {u.role}
                        </span>
                        <button className="text-muted-foreground hover:text-foreground">
                          <Settings className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Scope Templates */}
              {activeTab === 'scope-templates' && (
                <ScopeTemplatesTab 
                  templates={data.scopeTemplates}
                  showCreateTemplate={showCreateTemplate}
                  setShowCreateTemplate={setShowCreateTemplate}
                  creatingTemplate={creatingTemplate}
                  setCreatingTemplate={setCreatingTemplate}
                  newTemplate={newTemplate}
                  setNewTemplate={setNewTemplate}
                  newTask={newTask}
                  setNewTask={setNewTask}
                  onRefresh={async () => {
                    const res = await axios.get(`${API}/admin/scope-templates`, { withCredentials: true });
                    setData(prev => ({ ...prev, scopeTemplates: res.data || [] }));
                  }}
                />
              )}
            </>
          )}
        </div>
    </div>
  );
};


// Scope Templates Tab Component
const CATEGORIES = [
  { value: 'marketplace', label: 'Marketplace', color: 'bg-signal' },
  { value: 'saas', label: 'SaaS', color: 'bg-signal' },
  { value: 'mobile', label: 'Mobile App', color: 'bg-green-500' },
  { value: 'web_app', label: 'Web App', color: 'bg-signal' },
  { value: 'telegram', label: 'Telegram Bot', color: 'bg-signal' },
  { value: 'dashboard', label: 'Dashboard', color: 'bg-amber-500' }
];

const ScopeTemplatesTab = ({ 
  templates, 
  showCreateTemplate, 
  setShowCreateTemplate, 
  creatingTemplate,
  setCreatingTemplate,
  newTemplate, 
  setNewTemplate,
  newTask,
  setNewTask,
  onRefresh 
}) => {
  const [selectedCategory, setSelectedCategory] = useState('all');
  
  const filteredTemplates = selectedCategory === 'all' 
    ? templates 
    : templates.filter(t => t.category === selectedCategory);

  const addTask = () => {
    if (!newTask.title) return;
    setNewTemplate(prev => ({
      ...prev,
      tasks: [...prev.tasks, { ...newTask }]
    }));
    setNewTask({
      title: '',
      description: '',
      task_type: 'task',
      priority: 'medium',
      estimated_hours: 4
    });
  };

  const removeTask = (index) => {
    setNewTemplate(prev => ({
      ...prev,
      tasks: prev.tasks.filter((_, i) => i !== index)
    }));
  };

  const createTemplate = async () => {
    if (!newTemplate.name || newTemplate.tasks.length === 0) return;
    setCreatingTemplate(true);
    try {
      await axios.post(`${API}/admin/scope-templates`, newTemplate, { withCredentials: true });
      setShowCreateTemplate(false);
      setNewTemplate({
        name: '',
        category: 'web_app',
        description: '',
        tasks: [],
        tags: []
      });
      onRefresh();
    } catch (error) {
      console.error('Error creating template:', error);
    } finally {
      setCreatingTemplate(false);
    }
  };

  const deleteTemplate = async (templateId) => {
    if (!window.confirm('Delete this template?')) return;
    try {
      await axios.delete(`${API}/admin/scope-templates/${templateId}`, { withCredentials: true });
      onRefresh();
    } catch (error) {
      console.error('Error deleting template:', error);
    }
  };

  const getCategoryInfo = (cat) => CATEGORIES.find(c => c.value === cat) || CATEGORIES[0];
  const totalHours = newTemplate.tasks.reduce((sum, t) => sum + (t.estimated_hours || 0), 0);

  return (
    <div className="space-y-6" data-testid="scope-templates-tab">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Scope Templates</h2>
          <p className="text-sm text-muted-foreground">Reusable project templates for faster scoping</p>
        </div>
        <button
          onClick={() => setShowCreateTemplate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-xl text-sm font-medium hover:bg-muted"
          data-testid="create-template-btn"
        >
          <Plus className="w-4 h-4" />
          New Template
        </button>
      </div>

      {/* Category Filter */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        <button
          onClick={() => setSelectedCategory('all')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${
            selectedCategory === 'all' ? 'bg-white text-black' : 'bg-muted text-muted-foreground hover:bg-muted'
          }`}
        >
          All
        </button>
        {CATEGORIES.map(cat => (
          <button
            key={cat.value}
            onClick={() => setSelectedCategory(cat.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${
              selectedCategory === cat.value ? 'bg-white text-black' : 'bg-muted text-muted-foreground hover:bg-muted'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Templates Grid */}
      {filteredTemplates.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTemplates.map(template => {
            const catInfo = getCategoryInfo(template.category);
            return (
              <div 
                key={template.template_id}
                className="border border-border rounded-2xl p-5 hover:border-border transition-colors"
                data-testid={`template-card-${template.template_id}`}
              >
                <div className="mb-4">
                  <span className={`px-2 py-1 rounded text-xs font-medium text-foreground ${catInfo.color}`}>
                    {catInfo.label}
                  </span>
                  <h3 className="font-semibold text-lg mt-2">{template.name}</h3>
                  {template.description && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{template.description}</p>
                  )}
                </div>
                
                <div className="grid grid-cols-3 gap-3 py-3 border-y border-border">
                  <div>
                    <div className="text-xs text-muted-foreground">Tasks</div>
                    <div className="font-semibold">{template.tasks?.length || 0}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Hours</div>
                    <div className="font-semibold flex items-center gap-1">
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      {template.avg_hours || 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Price</div>
                    <div className="font-semibold text-emerald-400 flex items-center gap-1">
                      <DollarSign className="w-3 h-3" />
                      {template.avg_price?.toLocaleString() || 0}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center justify-between pt-4">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <TrendingUp className="w-3 h-3" />
                    Used {template.usage_count || 0}x
                  </div>
                  <button
                    onClick={() => deleteTemplate(template.template_id)}
                    className="p-2 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded-lg"
                    data-testid={`delete-template-${template.template_id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="border border-border rounded-2xl p-12 text-center text-muted-foreground">
          <FolderOpen className="w-8 h-8 mx-auto mb-3 opacity-50" />
          <p>No templates yet</p>
          <p className="text-sm mt-1">Create your first scope template</p>
        </div>
      )}

      {/* Create Template Modal */}
      {showCreateTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-zinc-950 rounded-2xl border border-border m-4">
            <div className="sticky top-0 bg-zinc-950 border-b border-border p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Create Template</h2>
                <button onClick={() => setShowCreateTemplate(false)} className="p-2 hover:bg-muted rounded-lg">
                  <Plus className="w-5 h-5 rotate-45" />
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Template Name</label>
                  <input
                    type="text"
                    value={newTemplate.name}
                    onChange={e => setNewTemplate(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="E-commerce MVP"
                    className="w-full px-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:border-border"
                    data-testid="template-name-input"
                  />
                </div>
                
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Category</label>
                  <select
                    value={newTemplate.category}
                    onChange={e => setNewTemplate(prev => ({ ...prev, category: e.target.value }))}
                    className="w-full px-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:border-border"
                    data-testid="template-category-select"
                  >
                    {CATEGORIES.map(cat => (
                      <option key={cat.value} value={cat.value}>{cat.label}</option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Description</label>
                  <textarea
                    value={newTemplate.description}
                    onChange={e => setNewTemplate(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Standard template for..."
                    rows={2}
                    className="w-full px-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:border-border resize-none"
                  />
                </div>
              </div>
              
              <div>
                <div className="flex items-center justify-between mb-4">
                  <label className="text-sm text-muted-foreground">Tasks ({newTemplate.tasks.length})</label>
                  <span className="text-sm text-muted-foreground">Total: {totalHours}h</span>
                </div>
                
                {newTemplate.tasks.length > 0 && (
                  <div className="space-y-2 mb-4">
                    {newTemplate.tasks.map((task, i) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-background rounded-xl border border-border">
                        <div>
                          <div className="font-medium text-sm">{task.title}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-2">
                            <span>{task.task_type}</span>
                            <span>•</span>
                            <span>{task.estimated_hours}h</span>
                          </div>
                        </div>
                        <button onClick={() => removeTask(i)} className="p-2 text-muted-foreground hover:text-red-400">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                
                <div className="p-4 bg-background rounded-xl border border-border space-y-3">
                  <input
                    type="text"
                    value={newTask.title}
                    onChange={e => setNewTask(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Task title"
                    className="w-full px-3 py-2 bg-zinc-900 border border-border rounded-lg text-sm focus:outline-none"
                    data-testid="task-title-input"
                  />
                  
                  <div className="grid grid-cols-3 gap-2">
                    <select
                      value={newTask.task_type}
                      onChange={e => setNewTask(prev => ({ ...prev, task_type: e.target.value }))}
                      className="px-3 py-2 bg-zinc-900 border border-border rounded-lg text-sm"
                    >
                      <option value="task">Task</option>
                      <option value="frontend">Frontend</option>
                      <option value="backend">Backend</option>
                      <option value="design">Design</option>
                      <option value="qa">QA</option>
                    </select>
                    <select
                      value={newTask.priority}
                      onChange={e => setNewTask(prev => ({ ...prev, priority: e.target.value }))}
                      className="px-3 py-2 bg-zinc-900 border border-border rounded-lg text-sm"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                    <input
                      type="number"
                      value={newTask.estimated_hours}
                      onChange={e => setNewTask(prev => ({ ...prev, estimated_hours: parseInt(e.target.value) || 0 }))}
                      placeholder="Hours"
                      className="px-3 py-2 bg-zinc-900 border border-border rounded-lg text-sm"
                      data-testid="task-hours-input"
                    />
                  </div>
                  
                  <button
                    onClick={addTask}
                    disabled={!newTask.title}
                    className="w-full py-2 bg-muted text-foreground rounded-lg text-sm font-medium hover:bg-muted disabled:opacity-50"
                    data-testid="add-task-btn"
                  >
                    Add Task
                  </button>
                </div>
              </div>
            </div>
            
            <div className="sticky bottom-0 bg-zinc-950 border-t border-border p-6 flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                {newTemplate.tasks.length} tasks • {totalHours} hours
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => setShowCreateTemplate(false)} className="px-4 py-2 text-muted-foreground hover:text-foreground">
                  Cancel
                </button>
                <button
                  onClick={createTemplate}
                  disabled={creatingTemplate || !newTemplate.name || newTemplate.tasks.length === 0}
                  className="flex items-center gap-2 px-6 py-2 bg-white text-black rounded-xl font-medium hover:bg-muted disabled:opacity-50"
                  data-testid="save-template-btn"
                >
                  {creatingTemplate ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Save Template
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============ REQUEST CARD WITH ACTIONS ============
const RequestCard = ({ request, onRefresh, navigate }) => {
  const [loading, setLoading] = useState(false);
  const [showProposalForm, setShowProposalForm] = useState(false);
  const [proposal, setProposal] = useState({
    summary: '',
    features: [{ title: '', description: '' }],
    timeline_text: '',
    estimated_cost: '',
    notes: ''
  });

  const status = request.status || 'pending';
  const isIdeaSubmitted = status === 'idea_submitted' || status === 'pending';
  const isReviewing = status === 'reviewing';
  const isProposalReady = status === 'proposal_ready';

  const handleStartReview = async () => {
    setLoading(true);
    try {
      await axios.post(`${API}/admin/master/request/${request.request_id}/start-review`, {}, { withCredentials: true });
      onRefresh();
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to start review');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProposal = async () => {
    if (!proposal.summary.trim()) {
      alert('Please add a summary');
      return;
    }
    setLoading(true);
    try {
      await axios.post(`${API}/admin/master/request/${request.request_id}/proposal`, {
        summary: proposal.summary,
        features: proposal.features.filter(f => f.title.trim()),
        timeline_text: proposal.timeline_text || undefined,
        estimated_cost: proposal.estimated_cost ? parseFloat(proposal.estimated_cost) : undefined,
        notes: proposal.notes || undefined
      }, { withCredentials: true });
      setShowProposalForm(false);
      onRefresh();
    } catch (error) {
      alert(error.response?.data?.detail || 'Failed to create proposal');
    } finally {
      setLoading(false);
    }
  };

  const addFeature = () => {
    setProposal(p => ({
      ...p,
      features: [...p.features, { title: '', description: '' }]
    }));
  };

  const updateFeature = (index, field, value) => {
    setProposal(p => ({
      ...p,
      features: p.features.map((f, i) => i === index ? { ...f, [field]: value } : f)
    }));
  };

  const getStatusColor = (s) => {
    const colors = {
      'idea_submitted': 'border-signal/30 bg-signal/10 text-signal',
      'pending': 'border-signal/30 bg-signal/10 text-signal',
      'reviewing': 'border-amber-500/30 bg-amber-500/10 text-amber-400',
      'proposal_ready': 'border-signal/30 bg-signal/10 text-signal',
      'active': 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
      'rejected': 'border-red-500/30 bg-red-500/10 text-red-400'
    };
    return colors[s] || 'border-border bg-muted text-muted-foreground';
  };

  return (
    <div className="border border-border rounded-2xl p-5" data-testid={`request-card-${request.request_id}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h3 className="font-medium text-foreground">{request.title}</h3>
          <p className="text-muted-foreground text-sm mt-1 line-clamp-2">{request.business_idea || request.description}</p>
        </div>
        <span className={`px-3 py-1 text-xs font-medium rounded-full border ${getStatusColor(status)}`}>
          {status.replace('_', ' ')}
        </span>
      </div>

      {/* Progress indicator */}
      <div className="flex items-center gap-2 mb-4">
        <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden">
          <div 
            className="h-full bg-signal rounded-full transition-all"
            style={{ width: `${request.progress || 5}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground">{request.progress || 5}%</span>
      </div>

      {/* Actions based on status */}
      <div className="flex items-center gap-2">
        {isIdeaSubmitted && (
          <>
            <button 
              onClick={handleStartReview}
              disabled={loading}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-foreground text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
              data-testid="start-review-btn"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Start Review'}
            </button>
            <button 
              onClick={() => navigate(`/admin/scope-builder/${request.request_id}`)}
              className="px-4 py-2 border border-border hover:bg-muted rounded-xl text-sm transition-colors"
            >
              Open Scope Builder
            </button>
          </>
        )}

        {isReviewing && (
          <>
            <button 
              onClick={() => setShowProposalForm(true)}
              className="px-4 py-2 bg-signal hover:bg-signal text-foreground text-sm font-medium rounded-xl transition-colors"
              data-testid="create-proposal-btn"
            >
              Create Proposal
            </button>
            <button 
              onClick={() => navigate(`/admin/scope-builder/${request.request_id}`)}
              className="px-4 py-2 border border-border hover:bg-muted rounded-xl text-sm transition-colors"
            >
              Scope Builder
            </button>
          </>
        )}

        {isProposalReady && (
          <span className="text-sm text-signal flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Waiting for client approval
          </span>
        )}
      </div>

      {/* Proposal Form */}
      {showProposalForm && (
        <div className="mt-4 p-4 bg-muted rounded-xl border border-border space-y-4">
          <h4 className="font-medium text-foreground">Create Proposal</h4>
          
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Summary</label>
            <textarea
              value={proposal.summary}
              onChange={(e) => setProposal(p => ({ ...p, summary: e.target.value }))}
              placeholder="Brief overview of what will be built..."
              className="w-full h-20 bg-black/30 border border-border rounded-xl px-4 py-3 text-foreground text-sm placeholder:text-muted-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Timeline</label>
              <input
                type="text"
                value={proposal.timeline_text}
                onChange={(e) => setProposal(p => ({ ...p, timeline_text: e.target.value }))}
                placeholder="e.g., 4 weeks"
                className="w-full bg-black/30 border border-border rounded-xl px-4 py-2 text-foreground text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Estimated Cost ($)</label>
              <input
                type="number"
                value={proposal.estimated_cost}
                onChange={(e) => setProposal(p => ({ ...p, estimated_cost: e.target.value }))}
                placeholder="e.g., 5000"
                className="w-full bg-black/30 border border-border rounded-xl px-4 py-2 text-foreground text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Features</label>
            <div className="space-y-2">
              {proposal.features.map((feature, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    value={feature.title}
                    onChange={(e) => updateFeature(i, 'title', e.target.value)}
                    placeholder="Feature title"
                    className="flex-1 bg-black/30 border border-border rounded-xl px-4 py-2 text-foreground text-sm"
                  />
                  <input
                    type="text"
                    value={feature.description}
                    onChange={(e) => updateFeature(i, 'description', e.target.value)}
                    placeholder="Description (optional)"
                    className="flex-1 bg-black/30 border border-border rounded-xl px-4 py-2 text-foreground text-sm"
                  />
                </div>
              ))}
            </div>
            <button
              onClick={addFeature}
              className="mt-2 text-xs text-signal hover:text-signal"
            >
              + Add Feature
            </button>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Notes (optional)</label>
            <textarea
              value={proposal.notes}
              onChange={(e) => setProposal(p => ({ ...p, notes: e.target.value }))}
              placeholder="Additional notes..."
              className="w-full h-16 bg-black/30 border border-border rounded-xl px-4 py-3 text-foreground text-sm placeholder:text-muted-foreground"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleCreateProposal}
              disabled={loading}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-foreground text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
              data-testid="submit-proposal-btn"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Publish Proposal'}
            </button>
            <button
              onClick={() => setShowProposalForm(false)}
              className="px-4 py-2 border border-border hover:bg-muted rounded-xl text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
