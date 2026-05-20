import { DollarSign, Check } from 'lucide-react';

export const PricingBreakdownPanel = ({ breakdown, totalPrice, benefits }) => {
  return (
    <div className="sticky top-6 border border-border rounded-lg p-6 bg-[hsl(var(--card))]" data-testid="pricing-breakdown-panel">
      {/* Total Price */}
      <div className="mb-6">
        <div className="text-muted-foreground text-sm mb-2">TOTAL</div>
        <div
          className="text-5xl font-bold tabular-nums tracking-tight transition-all duration-300"
          style={{ fontFamily: 'var(--font-display)', color: 'hsl(var(--trust))' }}
          data-testid="total-price"
        >
          ${totalPrice.toLocaleString()}
        </div>
      </div>

      {/* Benefits Checklist */}
      {benefits && benefits.length > 0 && (
        <div className="mb-6 pb-6 border-b border-border">
          <div className="space-y-2">
            {benefits.map((benefit, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
                <div className="text-muted-foreground text-sm">{benefit}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pricing Breakdown */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <DollarSign className="w-4 h-4 text-muted-foreground" />
          <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Price Breakdown</div>
        </div>

        <div className="space-y-3">
          {breakdown && breakdown.map((item, idx) => (
            <div key={idx} className="flex items-center justify-between text-sm">
              <div className="text-muted-foreground">{item.label}</div>
              <div className="font-medium tabular-nums text-white">
                {item.amount > 0 ? `+$${item.amount.toLocaleString()}` : `$${Math.abs(item.amount).toLocaleString()}`}
              </div>
            </div>
          ))}

          <div className="h-px bg-muted my-3"></div>

          <div className="flex items-center justify-between font-semibold">
            <div className="text-white">Total</div>
            <div className="text-lg tabular-nums" style={{ color: 'hsl(var(--trust))' }}>
              ${totalPrice.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Trust Message */}
      <div className="text-xs text-muted-foreground text-center">
        Transparent pricing • No hidden fees
      </div>
    </div>
  );
};
