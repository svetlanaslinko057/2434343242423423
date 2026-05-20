import { Clock, CheckCircle2, Package, DollarSign, ChevronRight } from 'lucide-react';

const PipelineStage = ({ icon: Icon, label, amount, count, isActive }) => {
  return (
    <div className={`flex-1 p-4 rounded-lg border transition-all ${
      isActive ? 'bg-surface-2 border-primary/30' : 'bg-surface border-border'
    }`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${isActive ? 'text-primary' : 'text-text-muted'}`} />
        <p className="text-xs uppercase tracking-[0.14em] text-text-muted">{label}</p>
      </div>
      <p className="text-2xl font-semibold tracking-tight text-text-primary mb-1">
        ${amount?.toLocaleString() || '0'}
      </p>
      <p className="text-xs text-text-secondary">{count || 0} task{count !== 1 ? 's' : ''}</p>
    </div>
  );
};

const EarningsPipeline = ({ summary }) => {
  const stages = [
    {
      icon: Clock,
      label: 'Pending QA',
      amount: summary?.pending_qa_amount || 0,
      count: summary?.pending_qa_count || 0,
      isActive: (summary?.pending_qa_count || 0) > 0
    },
    {
      icon: CheckCircle2,
      label: 'Approved',
      amount: summary?.approved_amount || 0,
      count: summary?.approved_count || 0,
      isActive: (summary?.approved_count || 0) > 0
    },
    {
      icon: Package,
      label: 'Batched',
      amount: summary?.batched_amount || 0,
      count: summary?.batched_count || 0,
      isActive: (summary?.batched_count || 0) > 0
    },
    {
      icon: DollarSign,
      label: 'Paid',
      amount: summary?.paid_total || 0,
      count: summary?.paid_count || 0,
      isActive: false
    }
  ];

  return (
    <div className="bg-surface rounded-xl border border-border p-6">
      <h3 className="text-sm font-semibold tracking-tight text-text-primary mb-4">Earnings Pipeline</h3>
      <div className="flex items-center gap-2">
        {stages.map((stage, index) => (
          <>
            <PipelineStage key={stage.label} {...stage} />
            {index < stages.length - 1 && (
              <ChevronRight className="w-5 h-5 text-text-muted flex-shrink-0" />
            )}
          </>
        ))}
      </div>
    </div>
  );
};

export default EarningsPipeline;