/**
 * StatusBadge — semantic, theme-aware pill.
 * Tones map to design tokens: success / warning / danger / info / neutral.
 *
 *   <StatusBadge tone="warning">QA pending</StatusBadge>
 *   <StatusBadge tone="danger" pulse>Blocked</StatusBadge>
 */
const TONES = {
  success: 'badge-success',
  warning: 'badge-warning',
  danger: 'badge-danger',
  info: 'badge-info',
  neutral: 'badge-neutral',
};

export function StatusBadge({ tone = 'neutral', children, pulse = false, className = '', testId }) {
  const cls = TONES[tone] || TONES.neutral;
  return (
    <span
      data-testid={testId}
      className={`status-badge ${cls} ${pulse ? 'status-badge-pulse' : ''} ${className}`}
    >
      {children}
    </span>
  );
}

export default StatusBadge;
