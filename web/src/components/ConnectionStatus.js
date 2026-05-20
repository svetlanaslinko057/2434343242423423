import { useConnectionStatus } from '@/hooks/useRealtime';
import { Wifi, WifiOff, Loader2 } from 'lucide-react';

const statusConfig = {
  connected: {
    dot: 'bg-emerald-400',
    pulse: true,
    icon: Wifi,
    iconColor: 'text-emerald-400',
    label: 'Live',
    labelColor: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
  },
  connecting: {
    dot: 'bg-amber-400',
    pulse: false,
    icon: Loader2,
    iconColor: 'text-amber-400',
    label: 'Connecting',
    labelColor: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    spin: true,
  },
  disconnected: {
    dot: 'bg-red-400',
    pulse: false,
    icon: WifiOff,
    iconColor: 'text-red-400',
    label: 'Offline',
    labelColor: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
  },
};

export function ConnectionStatusBadge({ compact = false }) {
  const status = useConnectionStatus();
  const config = statusConfig[status] || statusConfig.disconnected;
  const Icon = config.icon;

  if (compact) {
    return (
      <div 
        className="relative flex items-center" 
        title={`Realtime: ${config.label}`}
        data-testid="connection-status"
      >
        <div className={`w-2 h-2 rounded-full ${config.dot}`} />
        {config.pulse && (
          <div className={`absolute w-2 h-2 rounded-full ${config.dot} animate-ping`} />
        )}
      </div>
    );
  }

  return (
    <div 
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border ${config.bg} ${config.border}`}
      data-testid="connection-status"
    >
      <div className="relative">
        <div className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
        {config.pulse && (
          <div className={`absolute inset-0 w-1.5 h-1.5 rounded-full ${config.dot} animate-ping`} />
        )}
      </div>
      <Icon className={`w-3 h-3 ${config.iconColor} ${config.spin ? 'animate-spin' : ''}`} />
      <span className={`text-xs font-medium ${config.labelColor}`}>{config.label}</span>
    </div>
  );
}

export default ConnectionStatusBadge;
