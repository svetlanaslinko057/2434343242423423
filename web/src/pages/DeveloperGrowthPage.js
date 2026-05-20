import { useState, useEffect, useCallback } from 'react';
import { useAuth, API } from '@/App';
import axios from 'axios';
import { 
  Users, DollarSign, TrendingUp, Copy, Check, RefreshCw, 
  Award, Link2, UserPlus, Zap, Shield, Trophy, Crown, Medal,
  ArrowUp, Hash
} from 'lucide-react';

const DeveloperGrowthPage = () => {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [linkLoading, setLinkLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [recalcLoading, setRecalcLoading] = useState(false);
  const [leaderboard, setLeaderboard] = useState(null);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/developer/growth/dashboard`, { withCredentials: true });
      setData(res.data);
    } catch (err) {
      console.error('Growth dashboard error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/developer/growth/leaderboard`, { withCredentials: true });
      setLeaderboard(res.data);
    } catch (err) {
      console.error('Leaderboard error:', err);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
    fetchLeaderboard();
  }, [fetchDashboard, fetchLeaderboard]);

  const generateLink = async () => {
    setLinkLoading(true);
    try {
      await axios.get(`${API}/developer/growth/link`, { withCredentials: true });
      await fetchDashboard();
    } catch (err) {
      console.error('Generate link error:', err);
    } finally {
      setLinkLoading(false);
    }
  };

  const copyLink = () => {
    if (data?.invite_link) {
      const fullUrl = `${window.location.origin}${data.invite_link}`;
      navigator.clipboard.writeText(fullUrl).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const recalculateScore = async () => {
    setRecalcLoading(true);
    try {
      await axios.post(`${API}/developer/growth/recalculate-score`, {}, { withCredentials: true });
      await fetchDashboard();
      await fetchLeaderboard();
    } catch (err) {
      console.error('Recalculate error:', err);
    } finally {
      setRecalcLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" data-testid="growth-loading">
        <div className="w-8 h-8 border-2 border-border border-t-emerald-400 rounded-full animate-spin" />
      </div>
    );
  }

  const wallet = data?.wallet || {};
  const config = data?.config || {};

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6" data-testid="developer-growth-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white" data-testid="growth-page-title">Developer Network</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Invite strong developers. Earn {(config.commission_rate || 0.03) * 100}% from their earnings for {config.expiry_days || 90} days.
          </p>
        </div>
        <button
          onClick={recalculateScore}
          disabled={recalcLoading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-muted border border-border text-muted-foreground hover:text-white hover:bg-muted transition-all text-sm"
          data-testid="recalculate-score-btn"
        >
          <RefreshCw className={`w-4 h-4 ${recalcLoading ? 'animate-spin' : ''}`} />
          Recalculate Score
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4" data-testid="growth-stats-grid">
        <StatCard icon={<DollarSign className="w-5 h-5" />} label="Available" value={`$${(wallet.available_balance || 0).toFixed(2)}`} color="emerald" testId="stat-available" />
        <StatCard icon={<TrendingUp className="w-5 h-5" />} label="Pending" value={`$${(wallet.pending_balance || 0).toFixed(2)}`} color="amber" testId="stat-pending" />
        <StatCard icon={<DollarSign className="w-5 h-5" />} label="Lifetime Earned" value={`$${(wallet.lifetime_earned || 0).toFixed(2)}`} color="cyan" testId="stat-lifetime" />
        <StatCard icon={<Award className="w-5 h-5" />} label="Growth Score" value={data?.growth_score || 0} color="violet" testId="stat-growth-score" />
      </div>

      {/* Tier Card */}
      {data?.tier && (
        <div className="rounded-2xl border border-border bg-[var(--t-surface)] p-5" data-testid="dev-tier-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-bold border ${
                data.tier.tier === 'syndicate' ? 'bg-amber-500/20 border-amber-500/30 text-amber-400' :
                data.tier.tier === 'architect' ? 'bg-signal/20 border-signal/30 text-signal' :
                data.tier.tier === 'connector' ? 'bg-signal/20 border-signal/30 text-signal' :
                data.tier.tier === 'builder' ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' :
                'bg-muted border-border text-muted-foreground'
              }`}>
                {data.tier.tier === 'syndicate' ? <Crown className="w-6 h-6" /> :
                 data.tier.tier === 'architect' ? <Award className="w-6 h-6" /> :
                 data.tier.tier === 'connector' ? <Zap className="w-6 h-6" /> :
                 data.tier.tier === 'builder' ? <Shield className="w-6 h-6" /> :
                 <Users className="w-6 h-6" />}
              </div>
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider">Your Tier</div>
                <div className="text-xl font-bold text-white capitalize mt-0.5" data-testid="current-tier-name">{data.tier.tier}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {(data.tier.commission_rate * 100).toFixed(1)}% commission &middot; +{data.tier.priority_bonus} priority
                </div>
              </div>
            </div>

            {data.tier.next_tier && (
              <div className="text-right">
                <div className="text-xs text-muted-foreground mb-1">Next: <span className="text-muted-foreground capitalize font-medium">{data.tier.next_tier.name}</span></div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <div>Network: <span className="text-muted-foreground">{data.tier.network_size}/{data.tier.next_tier.network_needed}</span></div>
                  <div>Earnings: <span className="text-muted-foreground">${Math.round(data.tier.network_earnings)}/${data.tier.next_tier.earnings_needed}</span></div>
                </div>
              </div>
            )}
          </div>

          {data.tier.next_tier && (
            <div className="mt-4 space-y-2">
              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Network Progress</span>
                  <span>{data.tier.network_size} / {data.tier.next_tier.network_needed}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-signal/15 transition-all"
                    style={{ width: `${Math.min(100, (data.tier.network_size / data.tier.next_tier.network_needed) * 100)}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Earnings Progress</span>
                  <span>${Math.round(data.tier.network_earnings)} / ${data.tier.next_tier.earnings_needed}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-signal/15 transition-all"
                    style={{ width: `${Math.min(100, (data.tier.network_earnings / data.tier.next_tier.earnings_needed) * 100)}%` }} />
                </div>
              </div>
              {data.tier.next_tier.network_remaining <= 2 && (
                <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400">
                  <Zap className="w-3.5 h-3.5" />
                  You're {data.tier.next_tier.network_remaining} dev{data.tier.next_tier.network_remaining !== 1 ? 's' : ''} away from <span className="font-bold capitalize">{data.tier.next_tier.name}</span>!
                </div>
              )}
            </div>
          )}

          {/* All tiers ladder */}
          {data.all_tiers && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Tier Ladder</div>
              <div className="flex gap-1">
                {data.all_tiers.map((t) => (
                  <div key={t.name} className={`flex-1 py-1.5 px-2 rounded-lg text-center text-[10px] font-medium transition-all ${
                    t.name === data.tier.tier
                      ? 'bg-signal/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-white/[0.02] text-muted-foreground border border-border'
                  }`}>
                    <div className="capitalize">{t.name}</div>
                    <div className="text-[9px] opacity-60">{(t.commission_rate * 100).toFixed(1)}%</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main grid: Left content + Right leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left column: Main content */}
        <div className="lg:col-span-8 space-y-6">
          {/* Invite Link */}
          <div className="rounded-2xl border border-border bg-[var(--t-surface)] p-5 space-y-4" data-testid="invite-link-section">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <Link2 className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-white">Invite Link</h2>
                <p className="text-xs text-muted-foreground">Share with developers you trust</p>
              </div>
            </div>

            {data?.invite_link ? (
              <div className="flex items-center gap-3">
                <div className="flex-1 px-4 py-3 rounded-xl bg-black/50 border border-border text-sm text-muted-foreground font-mono truncate" data-testid="invite-link-value">
                  {window.location.origin}{data.invite_link}
                </div>
                <button
                  onClick={copyLink}
                  className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-all shrink-0 ${
                    copied 
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                      : 'bg-white text-black hover:bg-muted'
                  }`}
                  data-testid="copy-link-btn"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            ) : (
              <button
                onClick={generateLink}
                disabled={linkLoading}
                className="flex items-center gap-2 px-5 py-3 rounded-xl bg-signal/15 text-black font-medium text-sm hover:opacity-90 transition-all"
                data-testid="generate-link-btn"
              >
                {linkLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                Generate Invite Link
              </button>
            )}

            {data?.link && (
              <div className="flex items-center gap-6 text-xs text-muted-foreground">
                <span>Code: <span className="text-muted-foreground font-mono">{data.link.code}</span></span>
                <span>Clicks: <span className="text-muted-foreground">{data.link.clicks || 0}</span></span>
                <span>Conversions: <span className="text-muted-foreground">{data.link.conversions || 0}</span></span>
              </div>
            )}
          </div>

          {/* How it works */}
          <div className="rounded-2xl border border-border bg-[var(--t-surface)] p-5" data-testid="how-it-works-section">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">How It Works</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StepCard step="1" title="Invite" desc="Share your link" />
              <StepCard step="2" title="Onboard" desc="They start working" />
              <StepCard step="3" title="Earn" desc={`${(config.commission_rate || 0.03) * 100}% share`} />
              <StepCard step="4" title="Grow" desc="Priority boost" />
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Shield className="w-3.5 h-3.5" />
              <span>Limited to {config.expiry_days || 90} days or first ${config.earning_cap || 3000}</span>
            </div>
          </div>

          {/* Network Summary */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-[var(--t-surface)] p-4">
              <div className="text-sm text-muted-foreground mb-1">Invited Devs</div>
              <div className="text-2xl font-bold text-white">{data?.referrals_count || 0}</div>
            </div>
            <div className="rounded-xl border border-border bg-[var(--t-surface)] p-4">
              <div className="text-sm text-muted-foreground mb-1">Active Network</div>
              <div className="text-2xl font-bold text-emerald-400">{data?.active_referrals_count || 0}</div>
            </div>
          </div>

          {/* Invited Developers Table */}
          <div className="rounded-2xl border border-border bg-[var(--t-surface)] p-5" data-testid="invited-devs-section">
            <div className="flex items-center gap-3 mb-4">
              <Users className="w-5 h-5 text-muted-foreground" />
              <h2 className="text-base font-semibold text-white">Invited Developers</h2>
              <span className="ml-auto text-xs text-muted-foreground">{(data?.invited_devs || []).length} total</span>
            </div>

            {!(data?.invited_devs || []).length ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                No invited developers yet. Share your link to grow your network.
              </div>
            ) : (
              <div className="space-y-2">
                {data.invited_devs.map((dev) => (
                  <div key={dev.user_id} className="flex items-center justify-between p-4 rounded-xl bg-black/30 border border-border hover:border-border transition-colors" data-testid={`invited-dev-${dev.user_id}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-signal/15 flex items-center justify-center text-sm font-semibold text-muted-foreground border border-border">
                        {(dev.name || dev.email)?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-white">{dev.name || 'Unknown'}</div>
                        <div className="text-xs text-muted-foreground">{dev.email}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-sm font-medium text-emerald-400">${(dev.network_earnings || 0).toFixed(2)}</div>
                        <div className="text-xs text-muted-foreground">your earnings</div>
                      </div>
                      <div className="text-xs text-muted-foreground">{dev.completed_tasks || 0} tasks</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Payouts History */}
          <div className="rounded-2xl border border-border bg-[var(--t-surface)] p-5" data-testid="payouts-section">
            <div className="flex items-center gap-3 mb-4">
              <DollarSign className="w-5 h-5 text-muted-foreground" />
              <h2 className="text-base font-semibold text-white">Network Earnings</h2>
              <span className="ml-auto text-xs text-muted-foreground">{(data?.payouts || []).length} payouts</span>
            </div>

            {!(data?.payouts || []).length ? (
              <div className="text-sm text-muted-foreground py-8 text-center">No payouts yet. Earnings appear when invited devs earn money.</div>
            ) : (
              <div className="space-y-2">
                {data.payouts.map((p) => (
                  <div key={p.payout_id} className="flex items-center justify-between p-4 rounded-xl bg-black/30 border border-border" data-testid={`payout-${p.payout_id}`}>
                    <div>
                      <div className="text-sm font-medium text-white">${(p.amount || 0).toFixed(2)}</div>
                      <div className="text-xs text-muted-foreground">from ${(p.base_amount || 0).toFixed(2)} earned ({((p.commission_rate || 0) * 100).toFixed(0)}%)</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                        p.status === 'accrued' ? 'bg-amber-500/10 text-amber-400' :
                        p.status === 'approved' ? 'bg-emerald-500/10 text-emerald-400' :
                        p.status === 'paid' ? 'bg-signal/10 text-signal' : 'bg-red-500/10 text-red-400'
                      }`}>{p.status}</span>
                      <span className="text-xs text-muted-foreground">{p.created_at ? new Date(p.created_at).toLocaleDateString() : ''}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column: Leaderboard */}
        <div className="lg:col-span-4 space-y-6">
          <LeaderboardPanel leaderboard={leaderboard} currentUserId={user?.user_id} />

          {/* Growth Score Formula */}
          <div className="rounded-2xl border border-border bg-[var(--t-surface)] p-5" data-testid="growth-score-section">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Score Formula</h3>
            <div className="space-y-3 text-sm">
              <div className="p-3 rounded-xl bg-black/30 border border-border">
                <div className="text-white font-medium">Active Devs x 10</div>
                <div className="text-muted-foreground text-xs mt-0.5">Each active referred dev</div>
              </div>
              <div className="p-3 rounded-xl bg-black/30 border border-border">
                <div className="text-white font-medium">Tasks Done x 2</div>
                <div className="text-muted-foreground text-xs mt-0.5">Tasks by your network</div>
              </div>
              <div className="p-3 rounded-xl bg-black/30 border border-border">
                <div className="text-white font-medium">Earnings / $200 x 5</div>
                <div className="text-muted-foreground text-xs mt-0.5">Network earnings</div>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Score boosts your assignment priority (max +15 pts).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};


/* ========== LEADERBOARD PANEL ========== */

const LeaderboardPanel = ({ leaderboard, currentUserId }) => {
  const top = leaderboard?.top || [];
  const me = leaderboard?.me;
  const totalParticipants = leaderboard?.total_participants || 0;

  const getRankIcon = (rank) => {
    if (rank === 1) return <Crown className="w-4 h-4 text-amber-400" />;
    if (rank === 2) return <Medal className="w-4 h-4 text-gray-300" />;
    if (rank === 3) return <Medal className="w-4 h-4 text-amber-600" />;
    return <Hash className="w-3.5 h-3.5 text-muted-foreground" />;
  };

  const getRankBg = (rank, isMe) => {
    if (isMe) return 'bg-emerald-500/10 border-emerald-500/30';
    if (rank === 1) return 'bg-amber-500/5 border-amber-500/20';
    if (rank === 2) return 'bg-white/[0.02] border-border';
    if (rank === 3) return 'bg-amber-900/5 border-amber-800/15';
    return 'bg-black/20 border-border';
  };

  return (
    <div className="rounded-2xl border border-border bg-[var(--t-surface)] p-5" data-testid="leaderboard-section">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
          <Trophy className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-white">Leaderboard</h2>
          <p className="text-xs text-muted-foreground">{totalParticipants} developers</p>
        </div>
      </div>

      {/* Top list */}
      <div className="space-y-1.5" data-testid="leaderboard-list">
        {top.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            No rankings yet. Be the first!
          </div>
        ) : (
          top.slice(0, 15).map((dev) => {
            const isMe = dev.user_id === currentUserId;
            return (
              <div
                key={dev.user_id}
                className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${getRankBg(dev.rank, isMe)} ${isMe ? 'ring-1 ring-emerald-500/20' : ''}`}
                data-testid={`leaderboard-rank-${dev.rank}`}
              >
                {/* Rank */}
                <div className="w-8 flex items-center justify-center shrink-0">
                  {dev.rank <= 3 ? (
                    getRankIcon(dev.rank)
                  ) : (
                    <span className="text-xs text-muted-foreground font-mono">#{dev.rank}</span>
                  )}
                </div>

                {/* Avatar + Name */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium truncate ${isMe ? 'text-emerald-400' : 'text-white'}`}>
                      {dev.name || 'Unknown'}
                    </span>
                    {isMe && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 shrink-0">YOU</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
                    <span>{dev.active_referrals} refs</span>
                    <span>{dev.completed_tasks} tasks</span>
                    {dev.total_earnings > 0 && <span>${dev.total_earnings}</span>}
                  </div>
                </div>

                {/* Score */}
                <div className="text-right shrink-0">
                  <div className={`text-sm font-bold ${dev.rank <= 3 ? 'text-amber-400' : 'text-muted-foreground'}`}>
                    {dev.growth_score}
                  </div>
                  <div className="text-[10px] text-muted-foreground">pts</div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Current user position (if not in top 15) */}
      {me && me.rank > 15 && (
        <div className="mt-3 pt-3 border-t border-border" data-testid="leaderboard-me-section">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Your Position</div>
          <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 ring-1 ring-emerald-500/20">
            <div className="w-8 flex items-center justify-center">
              <span className="text-xs text-emerald-400 font-mono font-bold">#{me.rank}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-emerald-400 truncate">{me.name || 'You'}</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400">YOU</span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {me.active_referrals} refs / {me.completed_tasks} tasks
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold text-emerald-400">{me.growth_score}</div>
              <div className="text-[10px] text-muted-foreground">pts</div>
            </div>
          </div>
          {me.rank > 1 && (
            <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
              <ArrowUp className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400/60">Invite more devs to climb the ranks</span>
            </div>
          )}
        </div>
      )}

      {/* Current user position (if in top but visible) */}
      {me && me.rank <= 15 && me.rank > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Your rank</span>
            <span className="text-emerald-400 font-bold">#{me.rank} of {totalParticipants}</span>
          </div>
        </div>
      )}
    </div>
  );
};


/* ========== SUB-COMPONENTS ========== */

const StatCard = ({ icon, label, value, color, testId }) => {
  const colorMap = {
    emerald: 'bg-success/10 border-success/20 text-success',
    amber: 'bg-warning/10 border-warning/20 text-warning',
    cyan: 'bg-signal/10 border-signal/20 text-signal',
    violet: 'bg-signal/10 border-signal/20 text-signal',
  };

  return (
    <div className={`rounded-2xl border p-4 ${colorMap[color]}`} data-testid={testId}>
      <div className="flex items-center gap-2 mb-2 opacity-60">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="text-xl font-bold text-foreground">{value}</div>
    </div>
  );
};

const StepCard = ({ step, title, desc }) => (
  <div className="flex items-start gap-2.5 p-3 rounded-xl bg-black/20 border border-border">
    <div className="w-6 h-6 rounded-md bg-emerald-500/10 flex items-center justify-center text-emerald-400 text-[11px] font-bold shrink-0">
      {step}
    </div>
    <div>
      <div className="text-sm font-medium text-white">{title}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{desc}</div>
    </div>
  </div>
);


export default DeveloperGrowthPage;
