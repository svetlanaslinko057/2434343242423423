import { useState, useEffect } from 'react';
import axios from 'axios';
import { DollarSign, TrendingUp, AlertTriangle, Loader2 } from 'lucide-react';
import HonestState from '@/components/HonestState';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Этап 4 — Honest Runtime: real dev-cost from backend, no mocks.
// Backend route: GET /api/admin/projects/{id}/dev-cost
// Response shape (when data exists):
//   { dev_cost_total, approved_cost, held_cost, paid_cost, revision_cost, revision_share }
// When no earnings yet, backend returns the same keys with zeros — we treat
// `dev_cost_total === 0 && no children` as the empty/beta state.

const ProjectDevCostPanel = ({ projects = [] }) => {
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [devCostData, setDevCostData] = useState(null);
  const [state, setState] = useState('empty'); // loading | empty | beta | live | error

  useEffect(() => {
    if (!selectedProjectId) {
      setDevCostData(null);
      setState('empty');
      return;
    }
    let cancelled = false;
    setState('loading');
    setDevCostData(null);
    axios
      .get(`${API}/admin/projects/${selectedProjectId}/dev-cost`, { withCredentials: true })
      .then((r) => {
        if (cancelled) return;
        const d = r.data || {};
        const total = Number(d.dev_cost_total || 0);
        if (total === 0) {
          setDevCostData(null);
          // Beta: project exists but no earnings yet
          setState('beta');
        } else {
          setDevCostData(d);
          setState('live');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setState('error');
        setDevCostData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);

  const revisionShareHigh = devCostData && Number(devCostData.revision_share || 0) > 10;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold tracking-tight text-text-primary">Project Dev Cost</h3>

      {/* Project Selector */}
      <div className="space-y-2">
        <label className="text-xs uppercase tracking-[0.14em] text-text-muted">Select Project</label>
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-text-primary focus:outline-none focus:border-primary/50 transition-colors"
        >
          <option value="">Choose a project...</option>
          {projects.map((project) => (
            <option key={project.project_id} value={project.project_id}>
              {project.name || project.title || project.project_id}
            </option>
          ))}
        </select>
        {projects.length === 0 && (
          <p className="text-xs text-text-muted">No projects available yet.</p>
        )}
      </div>

      {/* States */}
      {state === 'loading' && (
        <div className="p-8 rounded-lg border border-border bg-surface text-center">
          <Loader2 className="w-6 h-6 mx-auto mb-2 text-text-muted animate-spin" />
          <p className="text-xs text-text-muted">Computing dev cost…</p>
        </div>
      )}

      {state === 'empty' && (
        <HonestState
          state="empty"
          icon={DollarSign}
          title="Select a project to view dev cost breakdown"
        />
      )}

      {state === 'beta' && (
        <HonestState
          state="beta"
          icon={DollarSign}
          title="No dev cost yet for this project"
          hint="Numbers will appear after the first approved earning."
        />
      )}

      {state === 'error' && (
        <HonestState
          state="error"
          title="Couldn't load dev cost data"
          hint="Try again or check backend logs."
        />
      )}

      {state === 'live' && devCostData && (
        <div className="space-y-3">
          {/* Total Cost Card */}
          <div className="p-4 rounded-lg bg-surface-2 border border-border">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-text-muted" />
              <p className="text-xs uppercase tracking-[0.14em] text-text-muted">Developer Cost Total</p>
            </div>
            <p className="text-3xl font-semibold font-mono text-text-primary">
              ${Number(devCostData.dev_cost_total || 0).toLocaleString()}
            </p>
          </div>

          {/* Breakdown */}
          <div className="bg-surface-2 rounded-lg border border-border p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Approved Cost</span>
              <span className="font-mono text-primary">${Number(devCostData.approved_cost || 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Held Cost</span>
              <span className="font-mono text-warning">${Number(devCostData.held_cost || 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Paid Cost</span>
              <span className="font-mono text-success">${Number(devCostData.paid_cost || 0).toLocaleString()}</span>
            </div>
            <div className="h-px bg-border" />
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Revision Cost</span>
              <span className="font-mono text-danger font-semibold">${Number(devCostData.revision_cost || 0).toLocaleString()}</span>
            </div>
          </div>

          {/* Revision Share */}
          <div
            className={`p-4 rounded-lg border ${
              revisionShareHigh ? 'bg-danger/10 border-danger/30' : 'bg-surface-2 border-border'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className={`w-4 h-4 ${revisionShareHigh ? 'text-danger' : 'text-text-muted'}`} />
              <p className="text-xs uppercase tracking-[0.14em] text-text-muted">Revision Share</p>
            </div>
            <div className="flex items-baseline gap-2">
              <p className={`text-2xl font-semibold ${revisionShareHigh ? 'text-danger' : 'text-text-primary'}`}>
                {Number(devCostData.revision_share || 0).toFixed(1)}%
              </p>
              {revisionShareHigh && (
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 text-danger" />
                  <span className="text-xs text-danger font-medium">HIGH (&gt;10%)</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectDevCostPanel;
