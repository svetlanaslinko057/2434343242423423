import { useState } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

const RiskBadge = ({ risk }) => {
  const config = {
    healthy: { label: 'Healthy', className: 'bg-[var(--success-surface)] text-[var(--success)] border-[var(--success-border)]' },
    warning: { label: 'Warning', className: 'bg-[var(--warning-surface)] text-[var(--warning)] border-[var(--warning-border)]' },
    danger: { label: 'Danger', className: 'bg-[var(--danger-surface)] text-[var(--danger)] border-[var(--danger-border)]' },
    critical: { label: 'Critical', className: 'bg-[var(--danger-surface)] text-[var(--danger)] border-[var(--danger-border)]' }
  };

  const riskConfig = config[risk] || config.warning;

  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-semibold uppercase tracking-wider border ${riskConfig.className}`}>
      {riskConfig.label}
    </span>
  );
};

const ProjectRow = ({ project, onClick }) => {
  const marginColor = project.margin_percent >= 40 ? 'text-[var(--success)]' :
                      project.margin_percent >= 20 ? 'text-[var(--warning)]' :
                      'text-[var(--danger)]';

  return (
    <tr 
      className="border-b border-[var(--border-admin)] hover:bg-[var(--surface-admin-1)] cursor-pointer transition-colors"
      onClick={onClick}
    >
      <td className="px-4 py-3">
        <p className="text-sm font-medium text-[var(--text-admin)]">{project.project_name}</p>
      </td>
      <td className="px-4 py-3 text-right">
        <span className="text-sm font-mono text-[var(--text-admin)]">
          ${project.revenue_total?.toLocaleString() || '0'}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <span className="text-sm font-mono text-[var(--text-admin-secondary)]">
          ${project.developer_cost_total?.toLocaleString() || '0'}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <span className="text-sm font-mono text-[var(--warning)]">
          ${project.revision_cost_total?.toLocaleString() || '0'}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex flex-col items-end">
          <span className={`text-sm font-semibold font-mono ${marginColor}`}>
            {project.margin_percent?.toFixed(1)}%
          </span>
          <span className="text-xs text-[var(--text-admin-muted)] font-mono">
            ${project.margin_absolute?.toLocaleString() || '0'}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <RiskBadge risk={project.risk_level} />
      </td>
      <td className="px-4 py-3">
        <button className="px-3 py-1.5 rounded-lg bg-[var(--info-surface)] border border-[var(--info-border)] text-[var(--info)] text-xs font-medium hover:bg-[var(--info-border)] transition-colors">
          Inspect
        </button>
      </td>
    </tr>
  );
};

const ProjectProfitTable = ({ projects = [], onSelectProject }) => {
  const [sortField, setSortField] = useState('margin_percent');
  const [sortDirection, setSortDirection] = useState('asc'); // asc = worst first

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedProjects = [...projects].sort((a, b) => {
    const aVal = a[sortField] || 0;
    const bVal = b[sortField] || 0;
    return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
  });

  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border-admin)] bg-[var(--surface-admin-1)] p-12 text-center">
        <TrendingDown className="w-12 h-12 text-[var(--text-admin-muted)] mx-auto mb-3" />
        <p className="text-[var(--text-admin)] font-medium mb-1">No project profit data</p>
        <p className="text-sm text-[var(--text-admin-muted)]">Projects with revenue will appear here</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border-admin)] bg-[var(--surface-admin-1)] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-[var(--surface-admin-2)] border-b border-[var(--border-admin)]">
            <tr>
              <th 
                className="px-4 py-3 text-left text-xs uppercase tracking-[0.14em] text-[var(--text-admin-muted)] font-semibold cursor-pointer hover:text-[var(--text-admin)]" 
                onClick={() => handleSort('project_name')}
              >
                Project
              </th>
              <th 
                className="px-4 py-3 text-right text-xs uppercase tracking-[0.14em] text-[var(--text-admin-muted)] font-semibold cursor-pointer hover:text-[var(--text-admin)]"
                onClick={() => handleSort('revenue_total')}
              >
                Revenue
              </th>
              <th 
                className="px-4 py-3 text-right text-xs uppercase tracking-[0.14em] text-[var(--text-admin-muted)] font-semibold cursor-pointer hover:text-[var(--text-admin)]"
                onClick={() => handleSort('developer_cost_total')}
              >
                Dev Cost
              </th>
              <th 
                className="px-4 py-3 text-right text-xs uppercase tracking-[0.14em] text-[var(--text-admin-muted)] font-semibold cursor-pointer hover:text-[var(--text-admin)]"
                onClick={() => handleSort('revision_cost_total')}
              >
                Revision
              </th>
              <th 
                className="px-4 py-3 text-right text-xs uppercase tracking-[0.14em] text-[var(--text-admin-muted)] font-semibold cursor-pointer hover:text-[var(--text-admin)]"
                onClick={() => handleSort('margin_percent')}
              >
                Margin
              </th>
              <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.14em] text-[var(--text-admin-muted)] font-semibold">
                Risk
              </th>
              <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.14em] text-[var(--text-admin-muted)] font-semibold">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedProjects.map((project) => (
              <ProjectRow 
                key={project.project_id} 
                project={project} 
                onClick={() => onSelectProject(project.project_id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ProjectProfitTable;