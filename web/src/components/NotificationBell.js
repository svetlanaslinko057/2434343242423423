import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth, API } from '@/App';
import axios from 'axios';
import {
  Bell, Check, CheckCheck, DollarSign, TrendingUp, UserPlus,
  Target, Award, Zap, Star, Crown, Shield, X
} from 'lucide-react';

const ICON_MAP = {
  referral_earned: DollarSign,
  tier_up: TrendingUp,
  dev_joined: UserPlus,
  task_assigned: Target,
  achievement_unlocked: Award,
  payment_received: DollarSign,
  deliverable_ready: Zap,
};

const COLOR_MAP = {
  referral_earned: 'text-emerald-400 bg-emerald-500/10',
  tier_up: 'text-amber-400 bg-amber-500/10',
  dev_joined: 'text-signal bg-signal/10',
  task_assigned: 'text-signal bg-signal/10',
  achievement_unlocked: 'text-signal bg-signal/10',
  payment_received: 'text-emerald-400 bg-emerald-500/10',
  deliverable_ready: 'text-orange-400 bg-orange-500/10',
};

const NotificationBell = () => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef(null);

  const fetchUnreadCount = useCallback(async () => {
    if (!user) return;
    try {
      const res = await axios.get(`${API}/notifications/unread-count`, { withCredentials: true });
      setUnreadCount(res.data.count || 0);
    } catch (err) { /* ignore */ }
  }, [user]);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await axios.get(`${API}/notifications`, { withCredentials: true });
      setNotifications(res.data || []);
    } catch (err) { /* ignore */ }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 15000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  useEffect(() => {
    if (open) fetchNotifications();
  }, [open, fetchNotifications]);

  // Click outside to close
  useEffect(() => {
    const handleClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const markRead = async (id) => {
    await axios.post(`${API}/notifications/${id}/read`, {}, { withCredentials: true });
    setNotifications(prev => prev.map(n => n.notification_id === id ? { ...n, is_read: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const markAllRead = async () => {
    await axios.post(`${API}/notifications/read-all`, {}, { withCredentials: true });
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
  };

  const timeAgo = (dateStr) => {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };

  return (
    <div className="relative" ref={panelRef} data-testid="notification-bell-wrapper">
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-xl hover:bg-muted transition-colors text-muted-foreground hover:text-white"
        data-testid="notification-bell-btn"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 animate-pulse" data-testid="notification-badge">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[380px] max-h-[480px] rounded-2xl border border-border bg-[var(--t-surface)] shadow-2xl shadow-black/50 z-50 overflow-hidden" data-testid="notification-panel">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">Notifications</span>
              {unreadCount > 0 && <span className="px-1.5 py-0.5 text-[10px] font-bold bg-red-500/20 text-red-400 rounded-full">{unreadCount}</span>}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-muted-foreground hover:text-white hover:bg-muted transition-colors" data-testid="mark-all-read-btn">
                  <CheckCheck className="w-3.5 h-3.5" /> Read all
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1 rounded-lg text-muted-foreground hover:text-white hover:bg-muted">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="overflow-y-auto max-h-[400px]" data-testid="notification-list">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-5 h-5 border-2 border-border border-t-white/40 rounded-full animate-spin" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Bell className="w-8 h-8 mb-2 opacity-40" />
                <span className="text-sm">No notifications yet</span>
              </div>
            ) : (
              notifications.map((n) => {
                const Icon = ICON_MAP[n.type] || Bell;
                const colors = COLOR_MAP[n.type] || 'text-muted-foreground bg-muted';
                return (
                  <div
                    key={n.notification_id}
                    onClick={() => !n.is_read && markRead(n.notification_id)}
                    className={`flex items-start gap-3 px-4 py-3 border-b border-white/[0.03] cursor-pointer transition-all hover:bg-white/[0.03] ${!n.is_read ? 'bg-white/[0.02]' : ''}`}
                    data-testid={`notification-item-${n.notification_id}`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${colors}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium truncate ${!n.is_read ? 'text-white' : 'text-muted-foreground'}`}>{n.title}</span>
                        {!n.is_read && <div className="w-1.5 h-1.5 rounded-full bg-signal shrink-0" />}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0 mt-1">{timeAgo(n.created_at)}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
