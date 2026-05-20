import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/App';
import { ConnectionStatusBadge } from '@/components/ConnectionStatus';
import NotificationBell from '@/components/NotificationBell';
import ThemeToggle from '@/components/ThemeToggle';
import Logo from '@/components/Logo';
import {
  LayoutDashboard,
  GitBranch,
  ShieldCheck,
  DollarSign,
  Users,
  Settings,
  User,
  LogOut,
  Brain,
  Map,
  ShieldAlert,
  Inbox,
} from 'lucide-react';

/**
 * Admin Layout v1 stable — 7 zones. Themed via design tokens (dark / light).
 *
 *   Dashboard · Workflow · QA · Finance · Team · System · Profile
 */
const AdminLayout = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-app text-token-primary flex" data-testid="admin-layout">
      <aside
        className="w-[240px] flex flex-col sticky top-0 h-screen bg-app-surface"
        style={{ borderRight: '1px solid var(--token-border)' }}
      >
        <div className="px-4 pt-6 pb-4">
          <div className="flex items-center">
            <Logo height={32} className="h-8 w-auto max-w-full" />
          </div>
          <p className="text-[11px] text-token-muted mt-3 leading-relaxed">Command Center · v1</p>
          <div className="mt-2 flex items-center gap-2">
            <ConnectionStatusBadge />
            <NotificationBell />
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto" data-testid="admin-sidebar-nav">
          <div className="px-3 py-2 text-token-kicker">Operations</div>
          <NavItem to="/admin/dashboard" icon={<LayoutDashboard className="w-[18px] h-[18px]" />} label="Dashboard" testid="nav-dashboard" />
          <NavItem to="/admin/leads"     icon={<Inbox className="w-[18px] h-[18px]" />}         label="Leads"     testid="nav-leads" />
          <NavItem to="/admin/execution-intelligence" icon={<Brain className="w-[18px] h-[18px]" />} label="Cognition" testid="nav-cognition" />
          <NavItem to="/admin/pressure-topology"      icon={<Map className="w-[18px] h-[18px]" />}   label="Topology"  testid="nav-topology" />
          <NavItem to="/admin/workflow"  icon={<GitBranch className="w-[18px] h-[18px]" />} label="Workflow"  testid="nav-workflow" />
          <NavItem to="/admin/qa"        icon={<ShieldCheck className="w-[18px] h-[18px]" />} label="QA"        testid="nav-qa" />

          <div className="px-3 py-2 mt-4 text-token-kicker">Resources</div>
          <NavItem to="/admin/finance"   icon={<DollarSign className="w-[18px] h-[18px]" />} label="Finance"   testid="nav-finance" />
          <NavItem to="/admin/team"      icon={<Users className="w-[18px] h-[18px]" />} label="Team"      testid="nav-team" />

          <div className="px-3 py-2 mt-4 text-token-kicker">System</div>
          <NavItem to="/admin/system"    icon={<Settings className="w-[18px] h-[18px]" />} label="System"    testid="nav-system" />
          <NavItem to="/account/2fa/recovery" icon={<ShieldAlert className="w-[18px] h-[18px]" />} label="Security"  testid="nav-security" />
          <NavItem to="/admin/profile"   icon={<User className="w-[18px] h-[18px]" />} label="Profile"   testid="nav-profile" />
        </nav>

        <div className="p-3" style={{ borderTop: '1px solid var(--token-border)' }}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider text-token-muted font-semibold">Theme</span>
            <ThemeToggle />
          </div>
          <div
            className="flex items-center gap-3 p-3 rounded-xl"
            style={{
              background: 'var(--token-surface-elevated)',
              border: '1px solid var(--token-border)',
            }}
          >
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center font-semibold text-sm"
              style={{
                background: 'var(--token-success-tint)',
                color: 'var(--token-primary)',
                border: '1px solid var(--token-success-border)',
              }}
            >
              {user?.name?.[0]?.toUpperCase() || 'A'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate text-token-primary">{user?.name || 'Admin'}</p>
              <p className="text-[11px] text-token-muted capitalize">{user?.active_role || user?.role || 'admin'}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg transition-colors text-token-muted hover:text-token-primary"
              style={{ background: 'transparent' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--token-border)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              data-testid="admin-logout-btn"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-h-screen overflow-auto bg-app px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
};

const NavItem = ({ to, icon, label, badge, testid }) => (
  <NavLink
    to={to}
    data-testid={testid}
    className={({ isActive }) =>
      `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
        isActive ? 'nav-item-active' : 'nav-item-idle'
      }`
    }
  >
    {icon}
    <span className="flex-1">{label}</span>
    {badge && <span className="status-badge badge-danger">{badge}</span>}
  </NavLink>
);

export default AdminLayout;
