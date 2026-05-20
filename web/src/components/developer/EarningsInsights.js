import { TrendingUp, AlertCircle, CheckCircle2 } from 'lucide-react';

const InsightCard = ({ icon: Icon, title, variant = 'default' }) => {
  const variants = {
    default: 'bg-surface-2 border-border text-text-secondary',
    warning: 'bg-warning/10 border-warning/30 text-warning',
    success: 'bg-primary/10 border-primary/30 text-primary'
  };

  return (
    <div className={`p-4 rounded-lg border ${variants[variant]}`}>
      <div className="flex items-start gap-3">
        <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <p className="text-sm flex-1">{title}</p>
      </div>
    </div>
  );
};

const EarningsInsights = ({ summary, held, flagged }) => {
  const insights = [];

  // Generate insights based on data
  if (held && held.length > 0) {
    const totalHeld = held.reduce((sum, e) => sum + (e.final_earning || 0), 0);
    insights.push({
      icon: AlertCircle,
      title: `${held.length} revision${held.length !== 1 ? 's' : ''} holding $${totalHeld.toLocaleString()} — completing QA fixes will release earnings faster`,
      variant: 'warning'
    });
  }

  if (flagged && flagged.length > 0) {
    insights.push({
      icon: AlertCircle,
      title: 'Low confidence score is causing review delays — improve time tracking consistency',
      variant: 'warning'
    });
  }

  if (summary?.approved_count > 0) {
    insights.push({
      icon: CheckCircle2,
      title: `${summary.approved_count} task${summary.approved_count !== 1 ? 's' : ''} ($${summary.approved_amount.toLocaleString()}) ready for next payout batch`,
      variant: 'success'
    });
  }

  if (insights.length === 0) {
    insights.push({
      icon: TrendingUp,
      title: 'All earnings are on track — maintain quality and tracking consistency',
      variant: 'default'
    });
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold tracking-tight text-text-primary">Insights</h3>
      <div className="space-y-2">
        {insights.map((insight, idx) => (
          <InsightCard key={idx} {...insight} />
        ))}
      </div>
    </div>
  );
};

export default EarningsInsights;