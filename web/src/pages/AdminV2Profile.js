/**
 * Admin · Profile — admin identity + system snapshot + permissions + audit.
 *
 * Source: GET /api/admin/mobile/profile (role-agnostic admin data + snapshot + links)
 */
import { useEffect, useState, useCallback } from 'react';
import { API, useAuth } from '@/App';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { Shield, User, LogOut, Activity, ExternalLink } from 'lucide-react';

export default function AdminV2Profile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/admin/mobile/profile`, { withCredentials: true });
      setData(r.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleLogout = async () => {
    if (!window.confirm('Sign out of admin session?')) return;
    await logout();
    navigate('/');
  };

  const admin = data?.admin || {
    id: user?.user_id,
    name: user?.name || 'Admin',
    email: user?.email,
    role: 'admin',
  };

  return (
    <div className="p-6 max-w-4xl mx-auto" data-testid="admin-profile">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">Admin identity · permissions · audit</p>
      </div>

      {/* Identity */}
      <div className="bg-card border border-emerald-500/30 rounded-xl p-6 mb-6" data-testid="admin-identity">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-xl bg-signal/15 flex items-center justify-center border border-border">
            <Shield className="w-7 h-7 text-emerald-400" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-[10px] bg-emerald-500/20 text-emerald-400 rounded uppercase tracking-wider font-bold">
                {admin.role || 'admin'}
              </span>
            </div>
            <h2 className="text-2xl font-bold mt-1">{admin.name}</h2>
            <p className="text-sm text-muted-foreground">{admin.email}</p>
          </div>
        </div>
      </div>

      {/* Snapshot */}
      {data?.snapshot && (
        <div className="bg-card border border-border rounded-xl p-6 mb-6" data-testid="admin-snapshot">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-4">
            System snapshot
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <SnapItem label="Active developers" value={data.snapshot.active_devs} />
            <SnapItem label="Active modules" value={data.snapshot.active_modules} />
            <SnapItem
              label="QA pending"
              value={data.snapshot.qa_pending}
              highlight={data.snapshot.qa_pending > 0}
            />
          </div>
        </div>
      )}

      {/* Permissions (static for v1 — admin has full access) */}
      <div className="bg-card border border-border rounded-xl p-6 mb-6" data-testid="admin-permissions">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-4">
          Permissions
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {[
            'Module QA decisions',
            'Withdrawal approvals',
            'Payout batch dispatch',
            'Team management',
            'System settings',
            'Audit log access',
          ].map((p) => (
            <div key={p} className="flex items-center gap-2 text-sm">
              <Shield className="w-4 h-4 text-emerald-400" />
              <span>{p}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <button
          onClick={() => navigate('/admin/dashboard')}
          className="flex items-center gap-3 bg-card hover:bg-muted border border-border rounded-xl p-4 transition-colors"
          data-testid="nav-dashboard-btn"
        >
          <Activity className="w-5 h-5 text-emerald-400" />
          <div className="flex-1 text-left">
            <p className="font-bold">Dashboard</p>
            <p className="text-xs text-muted-foreground">Open live operations</p>
          </div>
          <ExternalLink className="w-4 h-4 text-muted-foreground" />
        </button>
        <button
          onClick={() => navigate('/admin/system')}
          className="flex items-center gap-3 bg-card hover:bg-muted border border-border rounded-xl p-4 transition-colors"
          data-testid="nav-system-btn"
        >
          <User className="w-5 h-5 text-emerald-400" />
          <div className="flex-1 text-left">
            <p className="font-bold">System & audit log</p>
            <p className="text-xs text-muted-foreground">Integrations · templates · actions</p>
          </div>
          <ExternalLink className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="w-full flex items-center justify-center gap-2 py-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 rounded-xl font-bold transition-colors"
        data-testid="admin-logout-btn"
      >
        <LogOut className="w-4 h-4" />
        Logout
      </button>

      {loading && <p className="text-center text-muted-foreground text-sm mt-6">Loading…</p>}
    </div>
  );
}

function SnapItem({ label, value, highlight }) {
  return (
    <div className="text-center">
      <p className={`text-3xl font-bold ${highlight ? 'text-amber-400' : 'text-foreground'}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}
