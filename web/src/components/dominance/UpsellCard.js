import { Shield, Globe, Lock, Bell } from 'lucide-react';
import { useState } from 'react';

export const UpsellCard = ({ upsell, isAdded, onToggle }) => {
  const [isHovered, setIsHovered] = useState(false);

  const getIcon = (title) => {
    if (title.toLowerCase().includes('fraud')) return Shield;
    if (title.toLowerCase().includes('currency')) return Globe;
    if (title.toLowerCase().includes('2fa') || title.toLowerCase().includes('sso')) return Lock;
    if (title.toLowerCase().includes('alert')) return Bell;
    return Shield;
  };

  const Icon = getIcon(upsell.title);

  return (
    <div
      className={`border rounded-lg p-4 transition-all ${
        isAdded
          ? 'border-green-500/50 bg-green-500/10'
          : 'border-border hover:border-border hover:bg-muted'
      }`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-testid="upsell-card"
    >
      <div className="flex items-start gap-3">
        <div
          className={`p-2 rounded-lg transition-colors ${
            isAdded ? 'bg-green-500/20' : 'bg-muted'
          }`}
        >
          <Icon className={`w-5 h-5 ${isAdded ? 'text-green-400' : 'text-signal'}`} />
        </div>

        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <div className="text-white font-medium text-sm">{upsell.title}</div>
            {isAdded && (
              <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">Added</span>
            )}
          </div>
          <div className="text-muted-foreground text-xs mb-3">{upsell.description}</div>

          <div className="flex items-center justify-between">
            <div className="text-white font-semibold text-base tabular-nums">+${upsell.price}</div>
            <button
              onClick={() => onToggle(upsell)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                isAdded
                  ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                  : 'bg-signal/20 text-signal hover:bg-signal/30'
              }`}
              data-testid="upsell-toggle-button"
            >
              {isAdded ? 'Remove' : 'Add'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
