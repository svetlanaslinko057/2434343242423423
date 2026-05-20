/**
 * EmptyState — neutral, branded "nothing here yet" placeholder.
 *
 * <EmptyState
 *    title="No pending QA"
 *    description="All modules have been reviewed."
 *    icon={<ShieldCheck className="w-7 h-7" />}    // optional
 *    action={<button className="btn-token-primary">Browse all</button>}  // optional
 *    tone="success"        // success | warning | danger | neutral (default)
 *    compact               // smaller padding for in-table empty
 * />
 */
const TONE_COLOUR = {
  success: 'var(--token-success)',
  warning: 'var(--token-warning)',
  danger:  'var(--token-danger)',
  info:    'var(--token-info)',
  neutral: 'var(--token-text-muted)',
};

export function EmptyState({
  title,
  description,
  icon,
  action,
  tone = 'neutral',
  compact = false,
  className = '',
  testId,
}) {
  return (
    <div
      data-testid={testId}
      className={`app-card text-center ${compact ? 'py-8' : 'py-12'} ${className}`}
    >
      {icon && (
        <div
          className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center"
          style={{
            background: 'var(--token-surface-elevated)',
            color: TONE_COLOUR[tone] || TONE_COLOUR.neutral,
            border: '1px solid var(--token-border)',
          }}
        >
          {icon}
        </div>
      )}
      {title && <div className="text-h3 mb-1">{title}</div>}
      {description && <div className="text-small-token max-w-md mx-auto">{description}</div>}
      {action && <div className="mt-4 inline-flex">{action}</div>}
    </div>
  );
}

export default EmptyState;
