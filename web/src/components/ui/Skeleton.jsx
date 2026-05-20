/**
 * Skeleton — content placeholder used while async data loads.
 *
 * <Skeleton className="h-4 w-32" />
 * <Skeleton.Card />          // pre-built composite for card-shape
 * <Skeleton.Row count={5} /> // pre-built table rows
 *
 * Uses CSS variables, so it adapts to dark / light automatically.
 */
export function Skeleton({ className = '', style, testId }) {
  return (
    <div
      data-testid={testId}
      className={`skeleton-shimmer rounded ${className}`}
      style={style}
      aria-hidden
    />
  );
}

Skeleton.Card = function SkeletonCard() {
  return (
    <div className="app-card">
      <Skeleton className="h-3 w-20 mb-3" />
      <Skeleton className="h-8 w-32 mb-2" />
      <Skeleton className="h-3 w-40" />
    </div>
  );
};

Skeleton.Row = function SkeletonRow({ count = 4 }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3"
          style={{ borderTop: i === 0 ? 'none' : '1px solid var(--token-border)' }}>
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
};

Skeleton.Text = function SkeletonText({ lines = 3 }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
};

export default Skeleton;
