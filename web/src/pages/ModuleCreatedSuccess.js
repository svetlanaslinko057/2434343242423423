import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, API } from '@/App';
import axios from 'axios';
import { CheckCircle2, Zap, TrendingUp, Clock, User, Shield } from 'lucide-react';

export default function ModuleCreatedSuccess() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const moduleId = searchParams.get('id');
  const finalPrice = searchParams.get('price');
  const speedTier = searchParams.get('speed');
  const title = searchParams.get('title');

  const [showUpsell, setShowUpsell] = useState(false);
  const [assignmentProgress, setAssignmentProgress] = useState(0);

  useEffect(() => {
    // Simulate dev assignment progress
    const interval = setInterval(() => {
      setAssignmentProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          return 100;
        }
        return prev + 10;
      });
    }, 800);

    // Show upsell after 3 seconds
    setTimeout(() => setShowUpsell(true), 3000);

    return () => clearInterval(interval);
  }, []);

  const getDeliveryTime = () => {
    if (speedTier === 'instant') return '1 day';
    if (speedTier === 'fast') return '3 days';
    return '5 days';
  };

  const handleAddQAPriority = async () => {
    alert('QA Priority added (+$120)');
    setShowUpsell(false);
  };

  const handleGoToProject = () => {
    navigate('/client/dashboard-os');
  };

  return (
    <div className="min-h-screen bg-[hsl(var(--background))] flex items-center justify-center p-6">
      <div className="max-w-2xl w-full">
        {/* Success Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-500/20 mb-4">
            <CheckCircle2 className="w-10 h-10 text-green-400" />
          </div>
          <h1 className="text-4xl font-bold text-white mb-2 font-[var(--font-display)]">
            🎉 Module Started
          </h1>
          <p className="text-xl text-muted-foreground">{title || 'Your Module'}</p>
        </div>

        {/* Price Lock Summary */}
        <div className="border border-green-500/30 rounded-lg p-6 bg-green-500/10 mb-6">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-muted-foreground text-sm mb-1">Price Locked</div>
              <div className="text-2xl font-bold text-green-400 tabular-nums">${finalPrice}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-sm mb-1">Delivery</div>
              <div className="text-2xl font-bold text-white">{getDeliveryTime()}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-sm mb-1">Developer</div>
              <div className="text-2xl font-bold text-white">Top Tier</div>
            </div>
          </div>
        </div>

        {/* Instant Trust Boost */}
        <div className="border border-signal/30 rounded-lg p-4 bg-signal/10 mb-6">
          <div className="flex items-center gap-3">
            <TrendingUp className="w-6 h-6 text-signal" />
            <div className="flex-1">
              <div className="text-white font-medium text-sm">Confidence Score Increased</div>
              <div className="text-muted-foreground text-xs">82 → 91 (+9)</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Reason:</div>
              <div className="text-xs text-muted-foreground">Contract activated</div>
            </div>
          </div>
        </div>

        {/* Dev Assignment Status */}
        <div className="border border-border rounded-lg p-6 mb-6 bg-[hsl(var(--card))]">
          <div className="flex items-center gap-3 mb-4">
            <User className="w-5 h-5 text-signal" />
            <h3 className="text-white font-semibold">Developer Assignment</h3>
          </div>
          
          {assignmentProgress < 100 ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-muted-foreground text-sm">Assigning developer...</span>
                <span className="text-muted-foreground text-sm">{assignmentProgress}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-signal/15 transition-all duration-500"
                  style={{ width: `${assignmentProgress}%` }}
                />
              </div>
              <div className="text-xs text-muted-foreground mt-2">Top 10% developer being selected...</div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-400" />
              <span className="text-white text-sm">Developer assigned • Starting in ~8 minutes</span>
            </div>
          )}
        </div>

        {/* Progression Stepper */}
        <div className="border border-border rounded-lg p-6 mb-6 bg-[hsl(var(--card))]">
          <h3 className="text-white font-semibold mb-4">Progress Steps</h3>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-400" />
              <span className="text-white text-sm">Price locked</span>
            </div>
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-400" />
              <span className="text-white text-sm">Contract active</span>
            </div>
            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-signal animate-pulse" />
              <span className="text-white text-sm">Developer assigned</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full border-2 border-border" />
              <span className="text-muted-foreground text-sm">In progress</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full border-2 border-border" />
              <span className="text-muted-foreground text-sm">QA review</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full border-2 border-border" />
              <span className="text-muted-foreground text-sm">Delivery</span>
            </div>
          </div>
        </div>

        {/* Post-Commit Upsell */}
        {showUpsell && (
          <div className="border border-yellow-500/30 rounded-lg p-5 mb-6 bg-yellow-500/10 animate-fade-in">
            <div className="flex items-start gap-4">
              <div className="p-2 bg-yellow-500/20 rounded-lg">
                <Zap className="w-6 h-6 text-yellow-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-white font-semibold mb-1">While your module is starting...</h3>
                <p className="text-muted-foreground text-sm mb-3">Add priority QA review?</p>
                <div className="flex items-center gap-2 mb-4">
                  <Shield className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground text-sm">Get reviewed in 2h instead of 24h</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleAddQAPriority}
                    className="px-4 py-2 bg-yellow-500/20 text-yellow-400 rounded-lg text-sm font-medium hover:bg-yellow-500/30 transition-colors"
                  >
                    Add QA Priority (+$120)
                  </button>
                  <button
                    onClick={() => setShowUpsell(false)}
                    className="text-muted-foreground text-sm hover:text-muted-foreground transition-colors"
                  >
                    Skip
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Next Step */}
        <div className="border border-border rounded-lg p-6 mb-6 bg-[hsl(var(--card))]">
          <h3 className="text-white font-semibold mb-4">What Happens Next</h3>
          <div className="space-y-2 text-sm text-muted-foreground">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
              <span>Developer will start within 10 minutes</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
              <span>You'll get first update shortly</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
              <span>Track live progress in your dashboard</span>
            </div>
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={handleGoToProject}
          className="w-full py-4 rounded-lg font-semibold text-base transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{
            backgroundColor: 'hsl(var(--trust))',
            color: '#000'
          }}
        >
          Go to Project Dashboard
        </button>
      </div>
    </div>
  );
}
