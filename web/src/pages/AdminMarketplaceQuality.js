/**
 * Admin · Marketplace Quality (formerly AdminQAPage).
 *
 * Provider-level quality monitoring for the services marketplace.
 * NOT the same as module QA (which lives at /admin/qa, /admin/workflow).
 *
 * Endpoints:
 *   GET  /api/admin/qa/overview
 *   GET  /api/admin/qa/providers
 *   GET  /api/admin/qa/issues
 *   POST /api/admin/qa/flag-provider
 *   POST /api/admin/qa/limit-provider
 *   POST /api/admin/qa/unlimit-provider
 */
import { useState, useEffect, useCallback } from 'react';
import { API } from '@/App';
import axios from 'axios';
import {
  ShieldAlert, AlertTriangle, CheckCircle2, XCircle, Ban,
  TrendingDown, Flag, Lock, Unlock, BarChart3, Users,
} from 'lucide-react';

const AdminMarketplaceQuality = () => {
  const [overview, setOverview] = useState(null);
  const [providers, setProviders] = useState([]);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [actionLoading, setActionLoading] = useState({});

  const fetchData = useCallback(async () => {
    try {
      const [ovRes, provRes, issRes] = await Promise.all([
        axios.get(`${API}/admin/qa/overview`, { withCredentials: true }),
        axios.get(`${API}/admin/qa/providers`, { withCredentials: true }),
        axios.get(`${API}/admin/qa/issues`, { withCredentials: true }),
      ]);
      setOverview(ovRes.data);
      setProviders(provRes.data);
      setIssues(issRes.data);
    } catch (err) {
      console.error('Marketplace QA fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleFlag = async (providerId) => {
    setActionLoading((p) => ({ ...p, [providerId]: 'flag' }));
    try {
      await axios.post(`${API}/admin/qa/flag-provider`, { provider_id: providerId, reason: 'Manual review' }, { withCredentials: true });
      await fetchData();
    } catch (err) { console.error(err); }
    finally { setActionLoading((p) => ({ ...p, [providerId]: null })); }
  };

  const handleLimit = async (providerId) => {
    setActionLoading((p) => ({ ...p, [providerId]: 'limit' }));
    try {
      await axios.post(`${API}/admin/qa/limit-provider`, { provider_id: providerId, reason: 'Low quality score' }, { withCredentials: true });
      await fetchData();
    } catch (err) { console.error(err); }
    finally { setActionLoading((p) => ({ ...p, [providerId]: null })); }
  };

  const handleUnlimit = async (providerId) => {
    setActionLoading((p) => ({ ...p, [providerId]: 'unlimit' }));
    try {
      await axios.post(`${API}/admin/qa/unlimit-provider`, { provider_id: providerId }, { withCredentials: true });
      await fetchData();
    } catch (err) { console.error(err); }
    finally { setActionLoading((p) => ({ ...p, [providerId]: null })); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto" data-testid="admin-marketplace-quality">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Marketplace Quality</h1>
        <p className="text-zinc-500 text-sm mt-1">Service provider quality monitoring · flag · limit · restore</p>
      </div>

      <div className="flex gap-1 mb-6 bg-zinc-900/60 border border-zinc-800 rounded-xl p-1 w-fit">
        {['overview', 'providers', 'issues'].map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t ? 'bg-muted text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            data-testid={`mktq-tab-${t}`}
          >{t.charAt(0).toUpperCase() + t.slice(1)}</button>
        ))}
      </div>

      {tab === 'overview' && overview && (
        <div data-testid="mktq-overview">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <MetricCard label="Health Score" value={`${overview.health_score}%`} icon={<ShieldAlert className="w-4 h-4" />} color={overview.health_score >= 80 ? 'emerald' : overview.health_score >= 50 ? 'amber' : 'red'} testId="health-score" />
            <MetricCard label="Dispute Rate" value={`${overview.dispute_rate}%`} icon={<AlertTriangle className="w-4 h-4" />} color={overview.dispute_rate < 5 ? 'emerald' : 'red'} testId="dispute-rate" />
            <MetricCard label="Flagged Providers" value={overview.flagged_providers} icon={<Flag className="w-4 h-4" />} color="amber" testId="flagged-count" />
            <MetricCard label="Limited Providers" value={overview.limited_providers} icon={<Ban className="w-4 h-4" />} color="red" testId="limited-count" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard label="Total Providers" value={overview.total_providers} icon={<Users className="w-4 h-4" />} color="blue" />
            <MetricCard label="Total Bookings" value={overview.total_bookings} icon={<BarChart3 className="w-4 h-4" />} color="violet" />
            <MetricCard label="Missed Requests" value={overview.total_missed_requests} icon={<TrendingDown className="w-4 h-4" />} color="amber" />
            <MetricCard label="Low Quality" value={overview.low_quality_providers} icon={<XCircle className="w-4 h-4" />} color="red" />
          </div>
        </div>
      )}

      {tab === 'providers' && (
        <div data-testid="mktq-providers">
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-4 py-3 text-zinc-500 font-medium">Provider</th>
                  <th className="text-left px-4 py-3 text-zinc-500 font-medium">Score</th>
                  <th className="text-left px-4 py-3 text-zinc-500 font-medium">Tier</th>
                  <th className="text-left px-4 py-3 text-zinc-500 font-medium">Bookings</th>
                  <th className="text-left px-4 py-3 text-zinc-500 font-medium">Issues</th>
                  <th className="text-left px-4 py-3 text-zinc-500 font-medium">Lost Revenue</th>
                  <th className="text-right px-4 py-3 text-zinc-500 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <tr key={p.user_id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors" data-testid={`provider-row-${p.user_id}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {p.qa_limited && <Ban className="w-3.5 h-3.5 text-red-400" />}
                        {p.qa_flagged && !p.qa_limited && <Flag className="w-3.5 h-3.5 text-amber-400" />}
                        <span className="text-white font-medium">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                        p.quality_score >= 70 ? 'bg-emerald-500/20 text-emerald-400'
                        : p.quality_score >= 40 ? 'bg-amber-500/20 text-amber-400'
                        : 'bg-red-500/20 text-red-400'
                      }`}>{p.quality_score}</span>
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{p.tier}</td>
                    <td className="px-4 py-3 text-zinc-400">{p.total_bookings}</td>
                    <td className="px-4 py-3">
                      <span className="text-zinc-400">{p.breakdown?.disputes?.count || 0}d / {p.breakdown?.complaints?.count || 0}c</span>
                    </td>
                    <td className="px-4 py-3 text-red-400">{p.lost_revenue > 0 ? `$${p.lost_revenue}` : '-'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {p.qa_limited ? (
                          <button onClick={() => handleUnlimit(p.user_id)} disabled={actionLoading[p.user_id]}
                            className="flex items-center gap-1 px-2 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/20 rounded text-[11px] font-medium text-emerald-400 transition-colors"
                            data-testid={`unlimit-${p.user_id}`}
                          ><Unlock className="w-3 h-3" /> Restore</button>
                        ) : (
                          <>
                            {!p.qa_flagged && (
                              <button onClick={() => handleFlag(p.user_id)} disabled={actionLoading[p.user_id]}
                                className="flex items-center gap-1 px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/20 rounded text-[11px] font-medium text-amber-400 transition-colors"
                                data-testid={`flag-${p.user_id}`}
                              ><Flag className="w-3 h-3" /> Flag</button>
                            )}
                            <button onClick={() => handleLimit(p.user_id)} disabled={actionLoading[p.user_id]}
                              className="flex items-center gap-1 px-2 py-1 bg-red-500/20 hover:bg-red-500/30 border border-red-500/20 rounded text-[11px] font-medium text-red-400 transition-colors"
                              data-testid={`limit-${p.user_id}`}
                            ><Lock className="w-3 h-3" /> Limit</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {providers.length === 0 && (
                  <tr><td colSpan="7" className="px-4 py-8 text-center text-zinc-600">No providers found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'issues' && (
        <div className="space-y-2" data-testid="mktq-issues">
          {issues.length === 0 && (
            <div className="text-center py-12 bg-zinc-900/40 border border-zinc-800 rounded-xl">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
              <p className="text-zinc-400">No quality issues detected</p>
            </div>
          )}
          {issues.map((issue) => (
            <div key={issue.issue_id} className={`flex items-center justify-between bg-zinc-900/60 border rounded-xl px-4 py-3 ${
              issue.severity === 'critical' ? 'border-red-500/30'
              : issue.severity === 'high' ? 'border-orange-500/20'
              : 'border-zinc-800'
            }`} data-testid={`issue-${issue.issue_id}`}>
              <div className="flex items-center gap-3">
                <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                  issue.severity === 'critical' ? 'bg-red-500/20 text-red-400'
                  : issue.severity === 'high' ? 'bg-orange-500/20 text-orange-400'
                  : 'bg-amber-500/20 text-amber-400'
                }`}>{issue.severity}</span>
                <div>
                  <p className="text-sm text-white">{issue.type === 'dispute' ? 'Dispute' : issue.type === 'complaint' ? 'Complaint' : 'Auto-flagged'}: <span className="text-zinc-400">{issue.provider_name}</span></p>
                  {issue.message && <p className="text-xs text-zinc-500 mt-0.5">{issue.message}</p>}
                </div>
              </div>
              {issue.amount > 0 && <span className="text-sm font-medium text-red-400">${issue.amount}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const MetricCard = ({ label, value, icon, color, testId }) => {
  const colors = {
    emerald: 'bg-success/10 border-success/20 text-success',
    amber: 'bg-warning/10 border-warning/20 text-warning',
    red: 'bg-danger/10 border-danger/20 text-danger',
    blue: 'bg-signal/10 border-signal/20 text-signal',
    violet: 'bg-signal/10 border-signal/20 text-signal',
  };
  return (
    <div className={`${colors[color]} border rounded-xl p-4`} data-testid={testId}>
      <div className="flex items-center gap-2 mb-2 opacity-70">{icon}<span className="text-[11px] uppercase tracking-wider font-medium">{label}</span></div>
      <p className="text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
};

export default AdminMarketplaceQuality;
