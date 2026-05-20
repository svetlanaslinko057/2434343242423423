import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import axios from 'axios';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { SpeedTierSelector } from '@/components/dominance/SpeedTierSelector';
import { PricingBreakdownPanel } from '@/components/dominance/PricingBreakdownPanel';
import { UpsellCard } from '@/components/dominance/UpsellCard';

export default function CreateModuleDominance() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [moduleInfo, setModuleInfo] = useState({
    title: '',
    description: '',
    template_type: 'general',
    base_price: 800
  });

  const [speedTier, setSpeedTier] = useState('standard');
  const [addedUpsells, setAddedUpsells] = useState([]);
  const [availableUpsells, setAvailableUpsells] = useState([]);

  const [pricing, setPricing] = useState({
    base_price: 800,
    final_price: 800,
    pricing_breakdown: [{ label: 'Base development', amount: 800 }]
  });

  useEffect(() => {
    calculatePricing();
  }, [speedTier, addedUpsells, moduleInfo.base_price]);

  const calculatePricing = () => {
    const base = moduleInfo.base_price || 800;
    let total = base;
    const breakdown = [{ label: 'Base development', amount: base }];

    if (speedTier === 'fast') {
      const extra = Math.floor(base * 0.3);
      total += extra;
      breakdown.push({ label: 'Fast delivery', amount: extra });
    } else if (speedTier === 'instant') {
      const extra = base;
      total += extra;
      breakdown.push({ label: 'Instant delivery', amount: extra });
    }

    if (speedTier === 'fast' || speedTier === 'instant') {
      const extra = Math.floor(base * 0.3);
      total += extra;
      breakdown.push({ label: 'Urgent start', amount: extra });
    }

    if (speedTier === 'instant') {
      const extra = Math.floor(base * 0.2);
      total += extra;
      breakdown.push({ label: 'Top developer', amount: extra });
    }

    addedUpsells.forEach((upsell) => {
      total += upsell.price;
      breakdown.push({ label: upsell.title, amount: upsell.price });
    });

    setPricing({
      base_price: base,
      final_price: total,
      pricing_breakdown: breakdown
    });
  };

  const handleUpsellToggle = (upsell) => {
    setAddedUpsells((prev) => {
      const isAdded = prev.some((u) => u.upsell_id === upsell.upsell_id);
      if (isAdded) {
        return prev.filter((u) => u.upsell_id !== upsell.upsell_id);
      } else {
        return [...prev, upsell];
      }
    });
  };

  const getBenefits = () => {
    const benefits = [];
    if (speedTier === 'instant') {
      benefits.push('Delivery in 24 hours');
      benefits.push('Senior developer assigned');
      benefits.push('No queue / priority execution');
    } else if (speedTier === 'fast') {
      benefits.push('Delivery in 3 days');
      benefits.push('Experienced developer');
      benefits.push('Fast-track QA');
    } else {
      benefits.push('Delivery in 5 days');
      benefits.push('Standard queue');
    }
    benefits.push('QA included');
    benefits.push('Unlimited revisions (up to 2)');
    return benefits;
  };

  const handleCreateModule = async () => {
    if (!moduleInfo.title || !moduleInfo.description) {
      alert('Please fill in module title and description');
      return;
    }

    try {
      const res = await axios.post(
        `${API}/modules/create-with-pricing`,
        {
          title: moduleInfo.title,
          description: moduleInfo.description,
          template_type: moduleInfo.template_type,
          base_price: pricing.base_price,
          final_price: pricing.final_price,
          pricing_breakdown: pricing.pricing_breakdown,
          speed_tier: speedTier,
          pricing_context: {
            urgency: speedTier === 'fast' || speedTier === 'instant',
            elite_dev: speedTier === 'instant',
            speed_tier: speedTier,
            upsells: addedUpsells.map(u => u.upsell_id)
          },
          upsells: addedUpsells
        },
        { withCredentials: true }
      );

      // Redirect to success page with reinforcement
      const params = new URLSearchParams({
        id: res.data.module_id,
        price: pricing.final_price,
        speed: speedTier,
        title: moduleInfo.title
      });
      navigate(`/client/module-created?${params.toString()}`);
    } catch (error) {
      console.error('Error creating module:', error);
      alert('Failed to create module. Please try again.');
    }
  };

  useEffect(() => {
    const mockUpsells = [
      {
        upsell_id: 'upsell_analytics_001',
        title: 'Advanced Analytics',
        description: 'Prevent revenue loss with real-time insights and custom metrics',
        price: 400
      },
      {
        upsell_id: 'upsell_export_001',
        title: 'Data Export',
        description: 'Avoid manual data work with CSV/PDF export functionality',
        price: 200
      },
      {
        upsell_id: 'upsell_alerts_001',
        title: 'Alert System',
        description: 'Never miss critical events with email/SMS notifications',
        price: 300
      }
    ];
    setAvailableUpsells(mockUpsells);
  }, [moduleInfo.template_type]);

  return (
    <div className="min-h-screen bg-[hsl(var(--background))] p-6" data-testid="create-module-dominance">
      <div className="max-w-7xl mx-auto mb-6">
        <button
          onClick={() => navigate('/client/dashboard-os')}
          className="flex items-center gap-2 text-muted-foreground hover:text-white transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">Back to Dashboard</span>
        </button>

        <div className="flex items-center gap-3">
          <Sparkles className="w-7 h-7 text-yellow-400" />
          <h1 className="text-3xl font-bold text-white font-[var(--font-display)]">Create Module</h1>
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-5 gap-8">
        <div className="lg:col-span-3 space-y-8">
          <div className="border border-border rounded-lg p-6 bg-[hsl(var(--card))]">
            <h2 className="text-lg font-semibold text-white mb-4">Module Information</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-muted-foreground mb-2">Module Title</label>
                <input
                  type="text"
                  value={moduleInfo.title}
                  onChange={(e) => setModuleInfo({ ...moduleInfo, title: e.target.value })}
                  placeholder="e.g., Payment Integration"
                  className="w-full px-4 py-2 bg-muted border border-border rounded-lg text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--trust))]"
                  data-testid="module-title-input"
                />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-2">Description</label>
                <textarea
                  value={moduleInfo.description}
                  onChange={(e) => setModuleInfo({ ...moduleInfo, description: e.target.value })}
                  placeholder="What needs to be built?"
                  rows={3}
                  className="w-full px-4 py-2 bg-muted border border-border rounded-lg text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--trust))]"
                  data-testid="module-description-input"
                />
              </div>
            </div>
          </div>

          <div className="border border-border rounded-lg p-6 bg-[hsl(var(--card))]">
            <SpeedTierSelector selectedTier={speedTier} onSelectTier={setSpeedTier} />
          </div>

          {availableUpsells.length > 0 && (
            <div className="border border-border rounded-lg p-6 bg-[hsl(var(--card))]">
              <h2 className="text-lg font-semibold text-white mb-4">Recommended Add-ons</h2>
              <div className="space-y-3">
                {availableUpsells.map((upsell) => (
                  <UpsellCard
                    key={upsell.upsell_id}
                    upsell={upsell}
                    isAdded={addedUpsells.some((u) => u.upsell_id === upsell.upsell_id)}
                    onToggle={handleUpsellToggle}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          <PricingBreakdownPanel
            breakdown={pricing.pricing_breakdown}
            totalPrice={pricing.final_price}
            benefits={getBenefits()}
          />

          {/* Scarcity Pressure */}
          {speedTier === 'instant' && (
            <div className="mt-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30">
              <div className="flex items-center gap-2">
                <span className="text-red-400 text-sm font-medium">⚡ Only 2 instant slots available today</span>
              </div>
            </div>
          )}

          {/* Hard Commit CTA */}
          <button
            onClick={handleCreateModule}
            className="w-full mt-6 py-4 rounded-lg font-semibold text-base transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{
              backgroundColor: 'hsl(var(--trust))',
              color: '#000'
            }}
            data-testid="create-module-cta"
          >
            🔒 Lock Price & Start Development
          </button>

          <div className="text-center text-xs text-muted-foreground mt-3">
            Price will be locked after confirmation
          </div>
        </div>
      </div>
    </div>
  );
}
