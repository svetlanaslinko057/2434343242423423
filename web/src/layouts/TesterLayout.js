import { useState, useCallback } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/App';
import { TesterRealtimeBridge } from '@/components/RealtimeBridge';
import { ConnectionStatusBadge } from '@/components/ConnectionStatus';
import NotificationBell from '@/components/NotificationBell';
import ThemeToggle from '@/components/ThemeToggle';
import Logo from '@/components/Logo';
import {
  LayoutDashboard,
  Shield,
  AlertTriangle,
  BarChart3,
  LogOut,
  ShieldAlert,
} from 'lucide-react';

/**
 * Tester Layout — token-migrated (Phase 2).
 * Mirrors ClientLayout / DeveloperLayout grammar: bg-background shell,
 * bg-card sidebar, signal-active nav, ThemeToggle in user dock.
 */
const TesterLayout = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [refreshKey, setRefreshKey] = useState(0);

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const handleRefresh = useCallback(() => {
    setRefreshKey(k => k + 1);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground flex" data-testid="tester-layout">
      {user?.user_id && (
        <TesterRealtimeBridge userId={user.user_id} onRefresh={handleRefresh} />
      )}

      {/* Sidebar */}
      <aside className="w-[240px] border-r border-border flex flex-col sticky top-0 h-screen bg-card">
        {/* Logo Section */}
        <div className="px-4 pt-6 pb-4">
          <div className="flex items-center">
            <Logo height={32} className="h-8 w-auto max-w-full" />
          </div>
          <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">Quality Assurance</p>
          <div className="mt-2 flex items-center gap-2">
            <ConnectionStatusBadge />
            <NotificationBell />
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1">
          <NavItem to="/tester/dashboard"   icon={<LayoutDashboard className="w-[18px] h-[18px]" />} label="Dashboard" />
          <NavItem to="/tester/validation"  icon={<Shield className="w-[18px] h-[18px]" />} label="Validation" />
          <NavItem to="/tester/issues"      icon={<AlertTriangle className="w-[18px] h-[18px]" />} label="Issues" />
          <NavItem to="/tester/performance" icon={<BarChart3 className="w-[18px] h-[18px]" />} label="Performance" />
          <NavItem to="/account/2fa/recovery" icon={<ShieldAlert className="w-[18px] h-[18px]" />} label="Security" />
        </nav>

        {/* User */}
        <div className="p-3 border-t border-border">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Theme</span>
            <ThemeToggle />
          </div>
          <div className="flex items-center gap-3 p-3 rounded-xl bg-muted border border-border">
            <div className="w-9 h-9 rounded-lg bg-signal/15 flex items-center justify-center font-semibold text-sm border border-border">
              {user?.name?.[0]?.toUpperCase() || 'T'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.name || 'Tester'}</p>
              <p className="text-[11px] text-muted-foreground truncate">{user?.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-foreground"
              data-testid="logout-btn"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-h-screen overflow-auto bg-background px-12 py-8">
        <Outlet />
      </main>
    </div>
  );
};

const NavItem = ({ to, icon, label, badge }) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
        isActive
          ? 'bg-signal/10 text-foreground border border-signal/30'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      }`
    }
    data-testid={`nav-${label.toLowerCase()}`}
  >
    {icon}
    <span className="flex-1">{label}</span>
    {badge && (
      <span className="px-2 py-0.5 text-xs bg-signal/15 text-signal rounded-full">{badge}</span>
    )}
  </NavLink>
);

export default TesterLayout;
