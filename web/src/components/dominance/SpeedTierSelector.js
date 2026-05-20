import { Zap, TrendingUp, Clock } from 'lucide-react';

export const SpeedTierSelector = ({ selectedTier, onSelectTier }) => {
  const tiers = [
    {
      id: 'instant',
      label: 'Instant',
      duration: '1 day',
      icon: Zap,
      badge: '🔥 MOST CHOSEN',
      description: 'Best for urgent launches',
      price: 800,
      color: 'hsl(var(--trust))',
      bgColor: 'hsl(var(--trust) / 0.05)',
      borderColor: 'hsl(var(--trust) / 0.3)'
    },
    {
      id: 'fast',
      label: 'Fast',
      duration: '3 days',
      icon: TrendingUp,
      badge: null,
      description: 'Balanced speed & cost',
      price: 240,
      color: 'hsl(var(--info))',
      bgColor: 'hsl(var(--info) / 0.05)',
      borderColor: 'hsl(var(--info) / 0.2)'
    },
    {
      id: 'standard',
      label: 'Standard',
      duration: '5 days',
      icon: Clock,
      badge: null,
      description: 'Included',
      price: 0,
      color: 'hsl(var(--muted-foreground))',
      bgColor: 'transparent',
      borderColor: 'hsl(var(--border))'
    }
  ];

  return (
    <div data-testid="speed-tier-selector">
      <div className="mb-3">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-yellow-400" />
          <h3 className="text-sm font-semibold text-white font-[var(--font-body)]">DELIVERY SPEED</h3>
        </div>
      </div>

      <div className="space-y-3">
        {tiers.map((tier) => {
          const Icon = tier.icon;
          const isSelected = selectedTier === tier.id;

          return (
            <div
              key={tier.id}
              onClick={() => onSelectTier(tier.id)}
              className={`relative border-2 rounded-lg p-4 cursor-pointer transition-all ${
                isSelected ? 'ring-2 ring-offset-2 ring-offset-[hsl(var(--background))]' : 'hover:bg-muted'
              }`}
              style={{
                borderColor: isSelected ? tier.color : tier.borderColor,
                backgroundColor: isSelected ? tier.bgColor : 'transparent',
                ringColor: isSelected ? tier.color : 'transparent'
              }}
              data-testid={`speed-tier-${tier.id}`}
            >
              {/* Badge */}
              {tier.badge && (
                <div
                  className="absolute -top-3 left-4 px-3 py-1 rounded-full text-xs font-bold"
                  style={{ backgroundColor: tier.color, color: '#000' }}
                >
                  {tier.badge}
                </div>
              )}

              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1">
                  <Icon className="w-6 h-6 mt-1" style={{ color: tier.color }} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="text-white font-semibold text-base">{tier.label}</div>
                      <div className="text-muted-foreground text-sm">— {tier.duration}</div>
                    </div>
                    <div className="text-muted-foreground text-sm">{tier.description}</div>
                  </div>
                </div>

                {/* Price */}
                <div className="text-right">
                  {tier.price > 0 ? (
                    <div className="text-white font-semibold text-lg tabular-nums">+${tier.price}</div>
                  ) : (
                    <div className="text-muted-foreground text-sm">Included</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
