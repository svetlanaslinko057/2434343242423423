import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import axios from 'axios';
import {
  MapPin,
  Clock,
  DollarSign,
  Zap,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Wifi,
  WifiOff,
  TrendingUp,
  TrendingDown,
  Flame,
  Star,
  Timer,
  RefreshCw,
  Navigation,
  Phone
} from 'lucide-react';

const ProviderInbox = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  
  const [profile, setProfile] = useState(null);
  const [inbox, setInbox] = useState([]);
  const [pressure, setPressure] = useState(null);
  const [missed, setMissed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const [profileRes, inboxRes, pressureRes, missedRes] = await Promise.all([
        axios.get(`${API}/provider/profile`, { withCredentials: true }),
        axios.get(`${API}/provider/inbox`, { withCredentials: true }),
        axios.get(`${API}/provider/pressure`, { withCredentials: true }),
        axios.get(`${API}/provider/missed`, { withCredentials: true })
      ]);
      
      setProfile(profileRes.data);
      setInbox(inboxRes.data.requests || []);
      setPressure(pressureRes.data);
      setMissed(missedRes.data.missed || []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Poll every 5 seconds for new requests
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Timer countdown effect
  useEffect(() => {
    const timer = setInterval(() => {
      setInbox(prev => prev.map(req => ({
        ...req,
        expires_in: Math.max(0, req.expires_in - 1)
      })).filter(req => req.expires_in > 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const toggleStatus = async () => {
    const newStatus = profile?.status === 'online' ? 'offline' : 'online';
    try {
      await axios.post(`${API}/provider/status`, { status: newStatus }, { withCredentials: true });
      setProfile(prev => ({ ...prev, status: newStatus }));
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  const toggleQuickMode = async () => {
    if (!pressure?.quick_mode_available) {
      alert('Quick Mode требует рейтинг > 70');
      return;
    }
    try {
      await axios.post(`${API}/provider/quick-mode`, !profile?.quick_mode, { 
        withCredentials: true,
        headers: { 'Content-Type': 'application/json' }
      });
      setProfile(prev => ({ ...prev, quick_mode: !prev.quick_mode }));
    } catch (error) {
      console.error('Error toggling quick mode:', error);
    }
  };

  const acceptRequest = async (requestId) => {
    setAccepting(requestId);
    try {
      const res = await axios.post(`${API}/provider/requests/${requestId}/accept`, {}, { withCredentials: true });
      if (res.data.success) {
        // Remove from inbox
        setInbox(prev => prev.filter(r => r.request_id !== requestId));
        // Navigate to job view
        navigate(`/provider/job/${res.data.booking_id}`);
      } else if (res.data.message === 'already_taken') {
        alert('Заявку уже взяли 😔');
        fetchData();
      }
    } catch (error) {
      console.error('Error accepting:', error);
    } finally {
      setAccepting(null);
    }
  };

  const rejectRequest = async (requestId) => {
    try {
      await axios.post(`${API}/provider/requests/${requestId}/reject`, {}, { withCredentials: true });
      setInbox(prev => prev.filter(r => r.request_id !== requestId));
      fetchData();
    } catch (error) {
      console.error('Error rejecting:', error);
    }
  };

  const getTierColor = (tier) => {
    switch (tier) {
      case 'Platinum': return 'text-signal bg-signal/10 border-signal/30';
      case 'Gold': return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      case 'Silver': return 'text-zinc-300 bg-zinc-500/10 border-zinc-500/30';
      default: return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
    }
  };

  const getTimerColor = (seconds) => {
    if (seconds > 15) return 'text-white';
    if (seconds > 10) return 'text-amber-400';
    if (seconds > 5) return 'text-orange-400';
    return 'text-red-400 animate-pulse';
  };

  const getUrgencyBadge = (urgency) => {
    switch (urgency) {
      case 'emergency': return 'bg-red-500 text-white';
      case 'urgent': return 'bg-orange-500 text-white';
      default: return 'bg-zinc-700 text-white';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--t-bg)] flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--t-bg)] text-white pb-24" data-testid="provider-inbox">
      {/* TOP: STATUS + PRESSURE */}
      <div className="sticky top-0 z-50 bg-[var(--t-bg)] border-b border-border">
        <div className="px-4 py-4">
          {/* Status Row */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${profile?.status === 'online' ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
              <span className="font-medium">
                {profile?.status === 'online' ? 'Онлайн' : 'Оффлайн'}
              </span>
              {profile?.status === 'online' && (
                <span className="text-muted-foreground text-sm">• Принимаешь заявки</span>
              )}
            </div>
            <div className={`px-2.5 py-1 rounded-lg border text-xs font-medium ${getTierColor(pressure?.tier)}`}>
              {pressure?.tier}
            </div>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            <div className="bg-muted rounded-xl p-3 text-center">
              <div className="text-lg font-bold">{pressure?.stats?.nearby_requests || 0}</div>
              <div className="text-xs text-muted-foreground">Рядом</div>
            </div>
            <div className="bg-emerald-500/10 rounded-xl p-3 text-center">
              <div className="text-lg font-bold text-emerald-400">{pressure?.stats?.today_accepted || 0}</div>
              <div className="text-xs text-muted-foreground">Принял</div>
            </div>
            <div className="bg-red-500/10 rounded-xl p-3 text-center">
              <div className="text-lg font-bold text-red-400">{pressure?.stats?.today_missed || 0}</div>
              <div className="text-xs text-muted-foreground">Пропустил</div>
            </div>
            <div className="bg-amber-500/10 rounded-xl p-3 text-center">
              <div className="text-lg font-bold text-amber-400">~{pressure?.stats?.lost_revenue || 0}₴</div>
              <div className="text-xs text-muted-foreground">Потеряно</div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={toggleStatus}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium transition-all ${
                profile?.status === 'online'
                  ? 'bg-muted border border-border text-white'
                  : 'bg-emerald-500 text-white'
              }`}
              data-testid="toggle-status"
            >
              {profile?.status === 'online' ? (
                <>
                  <WifiOff className="w-4 h-4" />
                  Выключить
                </>
              ) : (
                <>
                  <Wifi className="w-4 h-4" />
                  Включить
                </>
              )}
            </button>
            <button
              onClick={toggleQuickMode}
              disabled={!pressure?.quick_mode_available}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium transition-all ${
                profile?.quick_mode
                  ? 'bg-signal text-white'
                  : pressure?.quick_mode_available
                  ? 'bg-muted border border-border text-white'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              }`}
              data-testid="toggle-quick-mode"
            >
              <Zap className="w-4 h-4" />
              Quick Mode {profile?.quick_mode ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      </div>

      {/* Tips/Warnings */}
      {pressure?.tips?.length > 0 && (
        <div className="px-4 py-3 bg-amber-500/10 border-b border-amber-500/20">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-300">
              {pressure.tips[0]}
            </div>
          </div>
        </div>
      )}

      {/* MIDDLE: LIVE REQUESTS */}
      <div className="px-4 py-4">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Flame className="w-5 h-5 text-orange-400" />
          Живые заявки
          {inbox.length > 0 && (
            <span className="px-2 py-0.5 bg-orange-500 text-white text-xs rounded-full">
              {inbox.length}
            </span>
          )}
        </h2>

        {profile?.status === 'offline' ? (
          <div className="border border-border border-dashed rounded-2xl p-8 text-center">
            <WifiOff className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">Ты оффлайн</h3>
            <p className="text-muted-foreground text-sm mb-4">Включи онлайн, чтобы получать заявки</p>
            <button
              onClick={toggleStatus}
              className="px-6 py-3 bg-emerald-500 text-white rounded-xl font-medium"
            >
              Выйти онлайн
            </button>
          </div>
        ) : inbox.length === 0 ? (
          <div className="border border-border border-dashed rounded-2xl p-8 text-center">
            <MapPin className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">Нет заявок рядом</h3>
            <p className="text-muted-foreground text-sm">Жди — скоро появятся</p>
          </div>
        ) : (
          <div className="space-y-4">
            {inbox.map((request, index) => (
              <RequestCard
                key={request.request_id}
                request={request}
                index={index}
                onAccept={() => acceptRequest(request.request_id)}
                onReject={() => rejectRequest(request.request_id)}
                accepting={accepting === request.request_id}
                getTimerColor={getTimerColor}
                getUrgencyBadge={getUrgencyBadge}
              />
            ))}
          </div>
        )}
      </div>

      {/* BOTTOM: MISSED / ANALYTICS */}
      {missed.length > 0 && (
        <div className="px-4 py-4 border-t border-border">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <TrendingDown className="w-5 h-5 text-red-400" />
            Пропущенные
          </h2>
          <div className="space-y-2">
            {missed.slice(0, 5).map((m) => (
              <div
                key={m.request_id}
                className="flex items-center justify-between p-3 bg-red-500/5 border border-red-500/10 rounded-xl"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-red-500/10 rounded-lg flex items-center justify-center">
                    <XCircle className="w-4 h-4 text-red-400" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">{m.service_type || 'Услуга'}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.location?.address?.slice(0, 30) || 'Адрес'}...
                    </div>
                  </div>
                </div>
                <div className="text-sm text-red-400 font-medium">
                  ~{m.lost_revenue || m.estimated_price || 0}₴
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 p-4 bg-red-500/10 rounded-xl text-center">
            <div className="text-2xl font-bold text-red-400">
              ~{pressure?.stats?.lost_revenue || 0}₴
            </div>
            <div className="text-sm text-muted-foreground">Потеряно сегодня</div>
          </div>
        </div>
      )}

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-background border-t border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="text-center flex-1">
            <div className="text-2xl font-bold">{pressure?.score || 50}</div>
            <div className="text-xs text-muted-foreground">Рейтинг</div>
          </div>
          <div className="h-8 w-px bg-muted" />
          <button
            onClick={() => navigate('/provider/stats')}
            className="text-center flex-1"
          >
            <TrendingUp className="w-6 h-6 mx-auto text-muted-foreground" />
            <div className="text-xs text-muted-foreground">Статистика</div>
          </button>
          <div className="h-8 w-px bg-muted" />
          <button
            onClick={() => navigate('/provider/profile')}
            className="text-center flex-1"
          >
            <Star className="w-6 h-6 mx-auto text-muted-foreground" />
            <div className="text-xs text-muted-foreground">Профиль</div>
          </button>
        </div>
      </div>
    </div>
  );
};


// Request Card Component
const RequestCard = ({ request, index, onAccept, onReject, accepting, getTimerColor, getUrgencyBadge }) => {
  const isUrgent = request.urgency === 'urgent' || request.urgency === 'emergency';
  
  return (
    <div
      className={`relative rounded-2xl border p-5 transition-all ${
        isUrgent
          ? 'border-orange-500/50 bg-orange-500/5'
          : 'border-border bg-white/[0.02]'
      } ${index === 0 ? 'ring-2 ring-border' : ''}`}
      data-testid={`request-card-${request.request_id}`}
    >
      {/* Urgency Badge */}
      {isUrgent && (
        <div className={`absolute -top-2 left-4 px-2 py-0.5 text-xs font-medium rounded ${getUrgencyBadge(request.urgency)}`}>
          {request.urgency === 'emergency' ? '🔴 Срочно' : '⚡ Быстро'}
        </div>
      )}

      {/* Timer */}
      <div className="absolute top-4 right-4 flex items-center gap-1.5">
        <Timer className={`w-4 h-4 ${getTimerColor(request.expires_in)}`} />
        <span className={`font-mono text-sm font-bold ${getTimerColor(request.expires_in)}`}>
          00:{request.expires_in.toString().padStart(2, '0')}
        </span>
      </div>

      {/* Service Info */}
      <div className="mb-4">
        <h3 className="text-lg font-semibold pr-16">{request.service_type}</h3>
        {request.description && (
          <p className="text-muted-foreground text-sm mt-1">{request.description}</p>
        )}
      </div>

      {/* Location & Price */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <MapPin className="w-4 h-4" />
          <span className="text-sm">{request.distance_km} км</span>
          <span className="text-muted-foreground">•</span>
          <span className="text-sm">{request.eta_minutes} мин</span>
        </div>
        <div className="flex items-center gap-2 text-emerald-400 font-semibold">
          <DollarSign className="w-4 h-4" />
          <span>~{request.estimated_price}₴</span>
        </div>
      </div>

      {/* Matching Reasons */}
      {request.reasons?.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-muted-foreground mb-2">Подходит вам:</div>
          <div className="flex flex-wrap gap-2">
            {request.reasons.map((reason, i) => (
              <span key={i} className="px-2 py-1 bg-muted rounded-lg text-xs">
                • {reason}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Address */}
      <div className="text-sm text-muted-foreground mb-4">
        <MapPin className="w-3 h-3 inline mr-1" />
        {request.address || request.location?.address || 'Адрес не указан'}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={onReject}
          className="flex-1 py-3 border border-border rounded-xl text-muted-foreground hover:bg-muted transition-all"
        >
          Пропустить
        </button>
        <button
          onClick={onAccept}
          disabled={accepting}
          className="flex-1 py-3 bg-emerald-500 text-white rounded-xl font-medium hover:bg-emerald-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {accepting ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4" />
              Принять
            </>
          )}
        </button>
      </div>
    </div>
  );
};


export default ProviderInbox;
