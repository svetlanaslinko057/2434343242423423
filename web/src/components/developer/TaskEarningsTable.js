import { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from '@/components/ui/sheet';

const StatusBadge = ({ status }) => {
  const statusConfig = {
    pending_qa: { label: 'Pending QA', className: 'bg-surface-2 text-text-secondary border-border' },
    approved: { label: 'Approved', className: 'bg-primary/10 text-primary border-primary/30' },
    batched: { label: 'Batched', className: 'bg-surface-2 text-primary border-primary/30' },
    held: { label: 'Held', className: 'bg-danger/10 text-danger border-danger/30' },
    flagged: { label: 'Flagged', className: 'bg-warning/10 text-warning border-warning/30' },
    paid: { label: 'Paid', className: 'bg-success/10 text-success border-success/30' }
  };

  const config = statusConfig[status] || statusConfig.pending_qa;

  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border ${config.className}`}>
      {config.label}
    </span>
  );
};

const TaskRow = ({ task, onClick }) => {
  const adjustmentColor = task.adjustments_total >= 0 ? 'text-text-secondary' : 'text-danger';

  return (
    <tr 
      className="border-b border-border hover:bg-surface-hover cursor-pointer transition-colors"
      onClick={onClick}
    >
      <td className="px-4 py-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-text-primary">{task.task_title}</p>
          <p className="text-xs text-text-muted">{task.project_name}</p>
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <span className="text-sm font-mono text-text-primary">
          ${task.base_earning?.toLocaleString() || '0'}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <span className={`text-sm font-mono ${adjustmentColor}`}>
          {task.adjustments_total >= 0 ? '+' : ''}{task.adjustments_total?.toFixed(2) || '0'}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <span className="text-sm font-semibold font-mono text-text-primary">
          ${task.final_earning?.toLocaleString() || '0'}
        </span>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={task.earning_status} />
      </td>
      <td className="px-4 py-3">
        <p className="text-xs text-text-secondary">{task.why || '—'}</p>
      </td>
    </tr>
  );
};

const TaskDetailSheet = ({ task, isOpen, onClose }) => {
  if (!task) return null;

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="bg-surface border-border w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-text-primary">{task.task_title}</SheetTitle>
          <SheetDescription className="text-text-secondary">
            {task.project_name}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Earning Breakdown */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-text-primary">Earning Breakdown</h4>
            <div className="bg-surface-2 rounded-lg border border-border p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Base Earning</span>
                <span className="font-mono text-text-primary">${task.base_earning?.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Adjustments</span>
                <span className={`font-mono ${task.adjustments_total >= 0 ? 'text-primary' : 'text-danger'}`}>
                  {task.adjustments_total >= 0 ? '+' : ''}{task.adjustments_total?.toFixed(2)}
                </span>
              </div>
              <div className="h-px bg-border my-2" />
              <div className="flex justify-between text-base">
                <span className="font-semibold text-text-primary">Final Earning</span>
                <span className="font-semibold font-mono text-text-primary">
                  ${task.final_earning?.toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* Formula */}
          {task.explainability_preview && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-text-primary">Calculation</h4>
              <div className="bg-surface-2 rounded-lg border border-border p-3">
                <code className="text-xs font-mono text-text-secondary">
                  {task.explainability_preview}
                </code>
              </div>
            </div>
          )}

          {/* Status & Reason */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-text-primary">Status</h4>
            <div className="flex items-center gap-2">
              <StatusBadge status={task.earning_status} />
              {task.why && (
                <span className="text-sm text-text-secondary">— {task.why}</span>
              )}
            </div>
          </div>

          {/* Batch Info */}
          {task.payout_batch_id && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-text-primary">Payout Batch</h4>
              <p className="text-sm text-text-secondary">
                Batch #{task.payout_batch_id.slice(-8)}
              </p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

const TaskEarningsTable = ({ tasks = [] }) => {
  const [selectedTask, setSelectedTask] = useState(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const handleRowClick = (task) => {
    setSelectedTask(task);
    setIsSheetOpen(true);
  };

  if (tasks.length === 0) {
    return (
      <div className="bg-surface rounded-xl border border-border p-12 text-center">
        <p className="text-text-muted">No task earnings yet</p>
      </div>
    );
  }

  return (
    <>
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-2 border-b border-border">
              <tr>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.14em] text-text-muted font-semibold">
                  Task
                </th>
                <th className="px-4 py-3 text-right text-xs uppercase tracking-[0.14em] text-text-muted font-semibold">
                  Base
                </th>
                <th className="px-4 py-3 text-right text-xs uppercase tracking-[0.14em] text-text-muted font-semibold">
                  Adjustments
                </th>
                <th className="px-4 py-3 text-right text-xs uppercase tracking-[0.14em] text-text-muted font-semibold">
                  Final
                </th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.14em] text-text-muted font-semibold">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.14em] text-text-muted font-semibold">
                  Why
                </th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <TaskRow 
                  key={task.earning_id} 
                  task={task} 
                  onClick={() => handleRowClick(task)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <TaskDetailSheet 
        task={selectedTask}
        isOpen={isSheetOpen}
        onClose={() => setIsSheetOpen(false)}
      />
    </>
  );
};

export default TaskEarningsTable;