import { useTheme } from '@/contexts/ThemeContext';

/**
 * AppCard — branded surface card with elevation + soft hover.
 * Uses CSS variables so it adapts automatically between dark and light themes.
 *
 * Usage:
 *   <AppCard><CardHeader title="Snapshot" /> ... </AppCard>
 *   <AppCard interactive onClick={...}>...</AppCard>
 *   <AppCard padded={false}>...</AppCard>   // for tables / custom inner layout
 */
export function AppCard({
  children,
  className = '',
  interactive = false,
  padded = true,
  testId,
  ...rest
}) {
  return (
    <div
      data-testid={testId}
      className={[
        'app-card',
        interactive && 'app-card-interactive',
        padded && 'p-5',
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, kicker }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div className="min-w-0">
        {kicker && <div className="text-token-kicker mb-1">{kicker}</div>}
        {title && <div className="text-h3 text-token-primary">{title}</div>}
        {subtitle && <div className="text-small text-token-secondary mt-1">{subtitle}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardSection({ children, className = '' }) {
  return <div className={`space-y-3 ${className}`}>{children}</div>;
}

/* Re-export the active theme name for ad-hoc consumers */
export function useActiveTheme() {
  const { theme } = useTheme();
  return theme;
}

export default AppCard;
