/**
 * DescribeFlow — full /describe page (visitor mode).
 *
 * Larger surface than the landing hero widget. Used when the user wants
 * (or is asked) to describe their idea more carefully — e.g. on first
 * visit landing redirect, on clarity=low retry from the hero widget, or
 * when the user explicitly navigates from a CTA.
 *
 * Internally just wraps DescribeWidget in `full` mode plus surrounding
 * context (header, hints, examples). All API interactions live in
 * DescribeWidget; this page is mostly composition.
 */
import { useLocation, useNavigate } from 'react-router-dom';
import { Lightbulb, Link2, FileText, ArrowLeft } from 'lucide-react';
import Logo from '@/components/Logo';
import ThemeToggle from '@/components/ThemeToggle';
import DescribeWidget from '@/components/DescribeWidget';

const EXAMPLES = [
  {
    icon: Link2,
    label: 'Paste a link',
    text: 'https://linear.app — but for hardware engineering teams.',
  },
  {
    icon: FileText,
    label: 'Describe in plain words',
    text: 'A two-sided marketplace where dietitians find clients and book paid consultations, with on-platform payments held until each session is complete.',
  },
  {
    icon: Lightbulb,
    label: 'Attach a brief',
    text: 'PDF, doc, image, or screenshot — we parse it and turn it into a scope.',
  },
];

const DescribeFlow = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const clarityHints = location.state?.clarityHints || [];
  // initialGoal from router state would normally be passed into DescribeWidget,
  // but the widget owns its own input state. We'll mention hints contextually instead.

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="describe-flow-page">
      <header className="sticky top-0 z-30 w-full backdrop-blur-md bg-background/80 border-b border-border">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={() => navigate('/')} className="flex items-center" data-testid="describe-back">
            <Logo />
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors"
              data-testid="describe-back-link"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 pt-12 pb-24">
        <div className="space-y-3 mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-card border border-border">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--t-signal)' }} />
            <span className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Free estimate · No signup
            </span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.05]" data-testid="describe-title">
            Tell us about your product.
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            Paste a link to a similar product, write a few sentences, or attach a brief.
            The system reads it, calculates scope, and returns a real price — in seconds.
          </p>
        </div>

        {clarityHints.length > 0 && (
          <div className="mb-8 p-4 rounded-xl bg-yellow-500/5 border border-yellow-500/30" data-testid="describe-clarity-hints">
            <div className="text-sm font-semibold text-foreground mb-1">A couple of things to clarify:</div>
            <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
              {clarityHints.slice(0, 4).map((h, i) => (
                <li key={i}>{typeof h === 'string' ? h : (h.text || h.message || JSON.stringify(h))}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mb-12">
          <DescribeWidget mode="full" />
        </div>

        <section className="border-t border-border pt-10 space-y-6">
          <h2 className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Three ways to start
          </h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {EXAMPLES.map((ex, i) => (
              <div
                key={i}
                className="p-5 rounded-xl bg-card border border-border space-y-3"
                data-testid={`describe-example-${i}`}
              >
                <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-muted">
                  <ex.icon className="w-5 h-5 text-foreground" />
                </div>
                <div className="font-semibold text-foreground text-sm">{ex.label}</div>
                <div className="text-sm text-muted-foreground italic">"{ex.text}"</div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
};

export default DescribeFlow;
