import { useTheme } from '@/contexts/ThemeContext';

/**
 * Logo — brand mark. Automatically swaps source by active theme so
 * the white wordmark doesn't disappear on the cream light surface.
 *
 *   dark  → /evax-logo.png          (white EVA + green X)
 *   light → /evax-logo-light.png    (dark EVA + green X)
 *
 * Both PNGs ship in /app/web/public. Use `height` to size — container
 * controls width via `max-w-full` so the asset never overflows.
 */
export default function Logo({
  className = '',
  height = 32,
  alt = 'EVA-X',
  testId = 'app-logo',
}) {
  const { theme } = useTheme();
  const base = process.env.PUBLIC_URL || '';
  const src = theme === 'light' ? `${base}/evax-logo-light.png` : `${base}/evax-logo.png`;
  return (
    <img
      data-testid={testId}
      src={src}
      alt={alt}
      style={{ height, width: 'auto', maxWidth: '100%', objectFit: 'contain' }}
      className={className}
    />
  );
}
