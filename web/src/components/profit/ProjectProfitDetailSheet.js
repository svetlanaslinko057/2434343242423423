import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from '@/components/ui/sheet';
import { DollarSign, AlertTriangle, TrendingUp } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const ProjectProfitDetailSheet = ({ projectId, isOpen, onClose }) => {
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (projectId && isOpen) {
      fetchProjectDetail();
    }
  }, [projectId, isOpen]);

  const fetchProjectDetail = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API}/admin/profit/projects/${projectId}`, {
        withCredentials: true
      });
      setProject(response.data);
    } catch (error) {
      console.error('Error fetching project profit detail:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent 
        className="w-full sm:max-w-2xl overflow-y-auto" 
        style={{
          backgroundColor: 'var(--surface-admin-1)',
          borderColor: 'var(--border-admin)'
        }}
      >
        <SheetHeader>
          <SheetTitle className="text-[var(--text-admin)] flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            {project?.project_name || 'Project Detail'}
          </SheetTitle>
          <SheetDescription className="text-[var(--text-admin-secondary)]">
            Profit breakdown and margin analysis
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="mt-6 flex items-center justify-center p-12">
            <div className="w-8 h-8 border-2 border-[var(--border-admin)] border-t-[var(--info)] rounded-full animate-spin" />
          </div>
        ) : project ? (
          <div className="mt-6 space-y-6">
            {/* Financial Breakdown */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-[var(--text-admin)]">Financial Breakdown</h4>
              <div className="bg-[var(--surface-admin-2)] rounded-lg border border-[var(--border-admin)] p-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-admin-secondary)]">Revenue</span>
                  <span className="font-mono text-[var(--text-admin)]">${project.revenue_total?.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-admin-secondary)]">Dev Cost</span>
                  <span className="font-mono text-[var(--text-admin-secondary)]">-${project.developer_cost_total?.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-admin-secondary)]">Revision Cost</span>
                  <span className="font-mono text-[var(--warning)]">-${project.revision_cost_total?.toLocaleString()}</span>
                </div>
                <div className="h-px bg-[var(--border-admin)]" />
                <div className="flex justify-between">
                  <span className="font-semibold text-[var(--text-admin)]">Profit (Margin)</span>
                  <div className="text-right">
                    <div className={`text-lg font-semibold font-mono ${project.margin_percent >= 20 ? 'text-[var(--success)]' : project.margin_percent >= 5 ? 'text-[var(--warning)]' : 'text-[var(--danger)]'}`}>
                      {project.margin_percent?.toFixed(1)}%
                    </div>
                    <div className="text-sm font-mono text-[var(--text-admin-secondary)]">
                      ${project.margin_absolute?.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Cost Breakdown by Status */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-[var(--text-admin)]">Cost by Status</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-[var(--surface-admin-2)] border border-[var(--border-admin)]">
                  <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-admin-muted)] mb-1">Approved</p>
                  <p className="text-base font-semibold font-mono text-[var(--success)]">
                    ${project.approved_cost?.toLocaleString() || '0'}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-[var(--surface-admin-2)] border border-[var(--border-admin)]">
                  <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-admin-muted)] mb-1">Held</p>
                  <p className="text-base font-semibold font-mono text-[var(--warning)]">
                    ${project.held_cost?.toLocaleString() || '0'}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-[var(--surface-admin-2)] border border-[var(--border-admin)]">
                  <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-admin-muted)] mb-1">Flagged</p>
                  <p className="text-base font-semibold font-mono text-[var(--danger)]">
                    ${project.flagged_cost?.toLocaleString() || '0'}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-[var(--surface-admin-2)] border border-[var(--border-admin)]">
                  <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-admin-muted)] mb-1">Paid</p>
                  <p className="text-base font-semibold font-mono text-[var(--text-admin)]">
                    ${project.paid_cost?.toLocaleString() || '0'}
                  </p>
                </div>
              </div>
            </div>

            {/* Signals */}
            {project.signals && project.signals.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-[var(--text-admin)]">Risk Signals</h4>
                <div className="space-y-2">
                  {project.signals.map((signal, idx) => (
                    <div 
                      key={idx} 
                      className={`p-3 rounded-lg border-l-[3px] ${
                        signal.severity === 'critical' ? 'bg-[var(--danger-surface)] border-[var(--danger)]' :
                        signal.severity === 'danger' ? 'bg-[var(--danger-surface)] border-[var(--danger)]' :
                        'bg-[var(--warning-surface)] border-[var(--warning)]'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle className={`w-4 h-4 mt-0.5 ${
                          signal.severity === 'critical' ? 'text-[var(--danger)]' :
                          signal.severity === 'danger' ? 'text-[var(--danger)]' :
                          'text-[var(--warning)]'
                        }`} />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-[var(--text-admin)] mb-1">
                            {signal.type.replace(/_/g, ' ').toUpperCase()}
                          </p>
                          <p className="text-xs text-[var(--text-admin-secondary)]">
                            {signal.message}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top Costly Tasks */}
            {project.top_costly_tasks && project.top_costly_tasks.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-[var(--text-admin)]">Top Costly Tasks</h4>
                <div className="border border-[var(--border-admin)] rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-[var(--surface-admin-2)]">
                      <tr className="border-b border-[var(--border-admin)]">
                        <th className="text-left py-2 px-3 text-xs uppercase tracking-[0.14em] text-[var(--text-admin-muted)] font-semibold">Task</th>
                        <th className="text-right py-2 px-3 text-xs uppercase tracking-[0.14em] text-[var(--text-admin-muted)] font-semibold">Cost</th>
                        <th className="text-right py-2 px-3 text-xs uppercase tracking-[0.14em] text-[var(--text-admin-muted)] font-semibold">Revision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {project.top_costly_tasks.map((task, idx) => (
                        <tr key={idx} className="border-b border-[var(--border-admin)]/50">
                          <td className="py-2 px-3 text-sm text-[var(--text-admin)]">{task.task_title}</td>
                          <td className="py-2 px-3 text-right text-sm font-mono text-[var(--text-admin)]">
                            ${task.final_earning?.toLocaleString()}
                          </td>
                          <td className="py-2 px-3 text-right text-sm font-mono text-[var(--warning)]">
                            {task.revision_hours?.toFixed(1)}h
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
};

export default ProjectProfitDetailSheet;
