import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Code2,
  Layers,
  CheckCircle2,
  Cpu,
  Boxes,
  ShieldCheck,
  Workflow,
  GitBranch,
  Eye,
  FileSignature,
  Smartphone,
  Plug,
  Sparkles,
  Activity,
  Quote as QuoteIcon,
  Rocket,
  Zap,
  Crown,
  Check,
} from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';
import Logo from '@/components/Logo';
import DescribeWidget from '@/components/DescribeWidget';
import { useTheme } from '@/contexts/ThemeContext';
import LandingPageLight from '@/pages/LandingPageLight';

/**
 * LandingPage v3 — Execution System positioning.
 *
 * Replaces the previous "ship products, not tickets" hero with a layout
 * built around the actual product story: AI scope → real devs → verified
 * delivery, plus the dedicated System layer that's the real differentiator.
 *
 * Visual rules (kept in sync with /app/web/src/index.css `.light`):
 *   primary  = var(--t-signal)  (deep mint, used for CTAs/text)
 *   accent   = var(--t-signal)  (bright mint, glows only — never solid background)
 *   bg-app   = #FAFAFA
 *   card     = #FFFFFF, border var(--t-border-strong), shadow 0 4px 12px rgba(0,0,0,.04)
 *   text-1   = #0F172A   text-2 = #475569
 *
 * Dark mode keeps existing tokens (foreground/background/etc.).
 *
 * NB: this file is now a theme-aware router. The full v3 layout below is
 * preserved unchanged for `dark` mode (institutional cognition surface).
 * For `light` mode we delegate to `LandingPageLight` — the operational
 * paper-substrate redesign (warm parchment, editorial grotesk, sequence
 * typography, no startup-green, heavy graphite CTA).
 */
const LandingPage = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();

  if (theme === 'light') {
    return <LandingPageLight />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="landing-page">
      <Header onLogin={() => navigate('/builder/auth')} onStart={() => navigate('/client/auth')} />

      <main>
        <Hero
          onStart={() => navigate('/client/auth')}
          onJoin={() => navigate('/builder/auth')}
        />

        <FlowSection />

        <BuildModesSection
          onStart={() => navigate('/client/auth')}
        />

        <SystemSection />

        <CapabilitiesSection />

        <UseCasesSection />

        <TrustSection />

        <FinalCTA onStart={() => navigate('/client/auth')} />
      </main>

      <MobileStickyCTA onStart={() => navigate('/client/auth')} />

      <Footer />
    </div>
  );
};

/* ============================================================
 * HEADER
 * ============================================================ */
const Header = ({ onLogin, onStart }) => (
  <nav
    className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-background/80 border-b border-border"
    data-testid="landing-header"
  >
    <div className="max-w-7xl mx-auto px-6 sm:px-10 h-16 flex items-center justify-between">
      <div className="flex items-center" data-testid="landing-logo">
        <Logo height={32} className="h-8 w-auto" />
      </div>

      <div className="hidden md:flex items-center gap-8">
        <a href="#flow" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="nav-flow">
          How it works
        </a>
        <a href="#build-modes" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="nav-build-modes">
          Build modes
        </a>
        <a href="#system" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="nav-system">
          System
        </a>
        <a href="#capabilities" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="nav-capabilities">
          Capabilities
        </a>
        <a href="#use-cases" className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="nav-use-cases">
          Use cases
        </a>
      </div>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        <button
          onClick={onLogin}
          className="hidden sm:flex text-sm text-muted-foreground hover:text-foreground transition-colors px-4 py-2 hover:bg-muted rounded-xl"
          data-testid="nav-login"
        >
          Log in
        </button>
        <button
          onClick={onStart}
          className="text-sm font-semibold px-5 py-2.5 rounded-xl text-white transition-all hover:translate-y-[-1px]"
          style={{
            background: 'var(--t-signal)',
            boxShadow: '0 6px 16px rgba(11,143,94,0.25)',
          }}
          data-testid="nav-start"
        >
          Start project
        </button>
      </div>
    </div>
  </nav>
);

/* ============================================================
 * HERO
 * ============================================================ */
const Hero = ({ onStart, onJoin }) => (
  <section className="relative pt-28 pb-20 sm:pt-32 sm:pb-28 overflow-hidden" data-testid="hero">
    {/* Layered ambient glow — focal point on the pipeline (right) */}
    <div
      aria-hidden
      className="absolute inset-0 pointer-events-none"
      style={{
        background: [
          'radial-gradient(620px circle at 72% 32%, rgba(47,230,166,0.10), transparent 42%)',
          'radial-gradient(900px circle at 8% 100%, rgba(11,143,94,0.05), transparent 55%)',
        ].join(','),
      }}
    />
    <div className="relative max-w-7xl mx-auto px-6 sm:px-10 grid lg:grid-cols-12 gap-12 items-center">
      {/* Left */}
      <div className="lg:col-span-6 space-y-7">
        <div
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-card border border-border"
          data-testid="hero-eyebrow"
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--t-signal)' }} />
          <span className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Execution Platform
          </span>
        </div>

        <h1
          className="text-5xl sm:text-6xl lg:text-[72px] font-semibold tracking-tight leading-[1.05] text-foreground"
          data-testid="hero-title"
        >
          Build real products
          <br />
          <span style={{ color: 'var(--t-signal)' }}>not tasks</span>
        </h1>

        <p
          className="text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-xl"
          data-testid="hero-subtitle"
        >
          Describe your idea. The system calculates scope, cost and timeline —
          then real developers execute with QA and{' '}
          <span className="text-foreground font-semibold">contract-backed delivery</span>.
        </p>

        {/* Inline describe widget — paste link, write text, or attach file. No voice. */}
        <div className="pt-2" data-testid="hero-describe">
          <DescribeWidget mode="inline" />
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={onJoin}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5"
            data-testid="hero-join-button"
          >
            <Code2 className="w-4 h-4" />
            See how execution works
          </button>
        </div>

        <div
          className="inline-flex items-center gap-2 text-sm font-mono font-semibold pt-2"
          style={{ color: 'var(--t-signal)' }}
          data-testid="hero-promise"
        >
          → No fixed packages. Every price is calculated from your scope.
        </div>

        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 pt-4 text-sm">
          <TrustItem value="500+" label="projects delivered" />
          <TrustItem value="98%" label="delivery rate" />
          <TrustItem value="4 weeks" label="avg MVP" />
        </div>
      </div>

      {/* Right — Pipeline UI */}
      <div className="lg:col-span-6">
        <PipelineUI />
      </div>
    </div>
  </section>
);

const TrustItem = ({ value, label }) => (
  <div className="flex items-baseline gap-2">
    <span className="text-foreground font-semibold">{value}</span>
    <span className="text-muted-foreground">{label}</span>
  </div>
);

/* ============================================================
 * PIPELINE UI (replaces terminal — visualizes "the system")
 * ============================================================ */
const PIPELINE_STEPS = [
  { key: 'idea', label: 'Idea', sub: 'submitted', icon: Sparkles, tint: '#94A3B8' },
  { key: 'scope', label: 'AI Scope', sub: '6 modules · $4,200', icon: Cpu, tint: 'var(--t-signal)' },
  { key: 'tasks', label: 'Tasks', sub: '24 tracked', icon: Workflow, tint: 'var(--t-signal)' },
  { key: 'dev', label: 'Dev', sub: '3 builders active', icon: GitBranch, tint: 'var(--t-signal)' },
  { key: 'qa', label: 'QA', sub: '12 / 12 verified', icon: ShieldCheck, tint: 'var(--t-signal)' },
  { key: 'ship', label: 'Delivery', sub: 'ready to ship', icon: CheckCircle2, tint: 'var(--t-signal)' },
];

const PipelineUI = () => {
  const [active, setActive] = useState(2);
  useEffect(() => {
    const t = setInterval(() => setActive((a) => (a + 1) % PIPELINE_STEPS.length), 1800);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      className="relative rounded-2xl bg-card border border-border p-6 sm:p-7"
      style={{
        boxShadow:
          '0 24px 60px rgba(15,23,42,0.10), 0 4px 14px rgba(15,23,42,0.05), 0 0 0 1px rgba(15,23,42,0.04)',
      }}
      data-testid="pipeline-ui"
    >
      {/* Window chrome */}
      <div className="flex items-center justify-between pb-4 mb-5 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#FF5F57]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#FEBC2E]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#28C840]" />
          <span className="ml-3 text-xs text-muted-foreground font-mono">devos · pipeline</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--t-signal)' }} />
          <span className="text-[11px] text-muted-foreground font-mono">live</span>
        </div>
      </div>

      {/* Pipeline rail */}
      <div className="space-y-2.5">
        {PIPELINE_STEPS.map((s, i) => {
          const isActive = i === active;
          const isDone = i < active;
          const Icon = s.icon;
          return (
            <div
              key={s.key}
              className={`relative flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-all duration-300 ${
                isActive
                  ? 'border-transparent'
                  : isDone
                  ? 'border-border bg-muted/40'
                  : 'border-border bg-card'
              }`}
              style={
                isActive
                  ? {
                      background: 'rgba(11,143,94,0.10)',
                      borderColor: 'rgba(11,143,94,0.45)',
                      boxShadow:
                        '0 10px 28px rgba(11,143,94,0.22), 0 0 0 1px rgba(11,143,94,0.18)',
                    }
                  : undefined
              }
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{
                  background: isActive
                    ? 'var(--t-signal)'
                    : isDone
                    ? 'rgba(11,143,94,0.12)'
                    : 'hsl(var(--muted))',
                  color: isActive ? '#fff' : isDone ? 'var(--t-signal)' : 'hsl(var(--muted-foreground))',
                }}
              >
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-foreground">
                  {String(i + 1).padStart(2, '0')} · {s.label}
                </div>
                <div className="text-xs text-muted-foreground truncate">{s.sub}</div>
              </div>
              {isDone && <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--t-signal)' }} />}
              {isActive && (
                <span
                  className="text-[10px] font-mono px-2 py-0.5 rounded-md"
                  style={{ background: 'var(--t-signal)', color: '#fff' }}
                >
                  RUNNING
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer status */}
      <div className="flex items-center justify-between mt-5 pt-4 border-t border-border">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Activity className="w-3.5 h-3.5" style={{ color: 'var(--t-signal)' }} />
          <span>Auto-orchestrated · contracts locked · QA verified</span>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">v1.0</span>
      </div>
    </div>
  );
};

/* ============================================================
 * FLOW (How it works) — sequence with arrows
 * ============================================================ */
const FLOW_STEPS = [
  {
    n: '01',
    title: 'Describe your idea',
    desc: 'Describe what you want to build. The system parses goals, users and constraints into a structured input.',
    sub: 'structured input',
    icon: Sparkles,
  },
  {
    n: '02',
    title: 'Choose build mode',
    desc: 'Pick how the product gets built — AI Build, AI + Engineering, or Full Engineering. The system adjusts execution accordingly.',
    sub: 'AI · Hybrid · Full Eng',
    icon: GitBranch,
  },
  {
    n: '03',
    title: 'Get calculated scope',
    desc: 'The system computes modules, timeline and price based on your real project — no fixed packages, no estimates by feel.',
    sub: 'scope · cost · timeline',
    icon: Cpu,
  },
  {
    n: '04',
    title: 'Sign contract',
    desc: 'Scope is locked, escrow is staged, payments are tied to verified delivery. Nothing starts before terms are clear.',
    sub: 'contract-backed',
    icon: FileSignature,
  },
  {
    n: '05',
    title: 'Start execution',
    desc: 'Real developers build it, QA verifies every module, you watch progress live. Money releases only on done.',
    sub: 'live execution · QA',
    icon: Rocket,
  },
];

const FlowSection = () => {
  const [hoverIdx, setHoverIdx] = useState(-1);
  return (
  <section id="flow" className="py-24 sm:py-28 border-t border-border" data-testid="flow-section">
    <div className="max-w-7xl mx-auto px-6 sm:px-10">
      <SectionHeader
        eyebrow="How it works"
        title="Estimate your product before you pay"
        sub="Describe what you want to build. The system breaks it into scope, modules, timeline and cost — before any contract is signed."
      />

      <div className="relative mt-16 grid sm:grid-cols-2 lg:grid-cols-5 gap-5 lg:gap-3">
        {FLOW_STEPS.map((step, i) => {
          const Icon = step.icon;
          const isHover = hoverIdx === i;
          return (
            <div
              key={step.n}
              className="relative"
              data-testid={`flow-step-${step.n}`}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(-1)}
            >
              <div
                className="rounded-2xl bg-card border p-6 h-full transition-all duration-200 hover:translate-y-[-3px]"
                style={{
                  borderColor: isHover ? 'rgba(11,143,94,0.35)' : 'hsl(var(--border))',
                  boxShadow: isHover
                    ? '0 14px 36px rgba(11,143,94,0.14), 0 2px 6px rgba(15,23,42,0.04)'
                    : '0 4px 12px rgba(15,23,42,0.05)',
                }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className="w-14 h-14 rounded-xl flex items-center justify-center font-mono font-bold text-lg tracking-tight transition-colors"
                    style={{
                      background: isHover ? 'rgba(11,143,94,0.14)' : 'rgba(11,143,94,0.08)',
                      color: 'var(--t-signal)',
                      border: '1px solid rgba(11,143,94,0.22)',
                    }}
                  >
                    {step.n}
                  </div>
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center transition-transform"
                    style={{
                      background: 'var(--t-signal)',
                      color: '#fff',
                      boxShadow: isHover ? '0 8px 20px rgba(11,143,94,0.30)' : 'none',
                      transform: isHover ? 'scale(1.05)' : 'scale(1)',
                    }}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                </div>
                <h3
                  className="text-base font-semibold text-foreground mb-2"
                  style={{ letterSpacing: '-0.01em' }}
                >
                  {step.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  {step.desc}
                </p>
                <div
                  className="inline-flex items-center gap-2 text-[11px] font-mono font-semibold px-2.5 py-1 rounded-md transition-all"
                  style={{
                    background: isHover ? 'rgba(11,143,94,0.14)' : 'rgba(11,143,94,0.08)',
                    color: 'var(--t-signal)',
                  }}
                >
                  → {step.sub}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  </section>
  );
};

/* ============================================================
 * SYSTEM (the differentiator)
 * ============================================================ */
const SYSTEM_CARDS = [
  {
    icon: Cpu,
    title: 'AI Scoping',
    desc: 'Turns a raw idea into architecture, modules, timelines and price — in minutes, not weeks.',
    primary: true,
  },
  {
    icon: Workflow,
    title: 'Task System',
    desc: 'Every step decomposed, assigned and tracked. No tickets lost, no silent stalls.',
    primary: true,
  },
  {
    icon: ShieldCheck,
    title: 'QA Validation',
    desc: 'Every feature passes a structured QA gate before it ever reaches you for approval.',
    primary: true,
  },
  {
    icon: Boxes,
    title: 'Developer Network',
    desc: 'Vetted senior builders. Auto-matched to scope, capacity-balanced, reputation-tracked.',
  },
  {
    icon: FileSignature,
    title: 'Contract & Payments',
    desc: 'Scope is locked, escrow is staged, money releases on verified delivery — not on talk.',
  },
  {
    icon: Eye,
    title: 'Transparency Layer',
    desc: 'Live dashboard: what is being built right now, by whom, with which risks. No black box.',
  },
];

const SystemSection = () => (
  <section
    id="system"
    className="py-24 sm:py-28 border-t border-border bg-muted/40"
    data-testid="system-section"
  >
    <div className="max-w-7xl mx-auto px-6 sm:px-10">
      <SectionHeader
        eyebrow="The system"
        title="The execution layer behind every shipped product"
        sub="Not freelancers. Not agencies. A structured runtime that turns ideas into delivered software."
      />

      <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {SYSTEM_CARDS.map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.title}
              className="group relative rounded-2xl p-7 transition-all duration-200 hover:translate-y-[-3px]"
              style={
                c.primary
                  ? {
                      background: '#FFFFFF',
                      border: '1px solid rgba(15,23,42,0.08)',
                      boxShadow:
                        '0 14px 36px rgba(15,23,42,0.08), 0 2px 6px rgba(15,23,42,0.04)',
                    }
                  : {
                      background: '#F8FAFC',
                      border: '1px solid rgba(15,23,42,0.06)',
                      boxShadow: '0 1px 2px rgba(15,23,42,0.03)',
                    }
              }
              data-testid={`system-card-${c.title.toLowerCase().replace(/\s+/g, '-')}`}
            >
              {/* Hover glow accent — only here var(--t-signal) is allowed */}
              <div
                aria-hidden
                className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                style={{
                  background:
                    'radial-gradient(circle at 100% 0%, rgba(47,230,166,0.10) 0%, transparent 60%)',
                }}
              />
              <div
                className="relative w-11 h-11 rounded-xl flex items-center justify-center mb-5"
                style={{
                  background: 'rgba(11,143,94,0.10)',
                  color: 'var(--t-signal)',
                  border: '1px solid rgba(11,143,94,0.18)',
                }}
              >
                <Icon className="w-5 h-5" />
              </div>
              <h3 className="relative text-lg font-semibold text-foreground mb-2">{c.title}</h3>
              <p className="relative text-sm text-muted-foreground leading-relaxed">{c.desc}</p>
            </div>
          );
        })}
      </div>
    </div>
  </section>
);

/* ============================================================
 * CAPABILITIES — chip grid
 * ============================================================ */
const CAPABILITY_GROUPS = [
  {
    icon: Layers,
    title: 'Core stack',
    chips: ['React', 'Next.js', 'Vue', 'Node.js', 'NestJS', 'Express', 'Python', 'FastAPI'],
  },
  {
    icon: Smartphone,
    title: 'Mobile',
    chips: ['React Native', 'Expo', 'iOS', 'Android', 'Push notifications'],
  },
  {
    icon: Plug,
    title: 'APIs & infra',
    chips: ['REST', 'GraphQL', 'Stripe', 'PayPal', 'MongoDB', 'PostgreSQL', 'MySQL', 'Redis'],
  },
  {
    icon: Workflow,
    title: 'Automation & no-code',
    chips: ['n8n', 'Make', 'Zapier', 'Webflow', 'Bubble', 'Airtable'],
  },
];

const CapabilitiesSection = () => (
  <section
    id="capabilities"
    className="py-24 sm:py-28 border-t border-border"
    data-testid="capabilities-section"
  >
    <div className="max-w-7xl mx-auto px-6 sm:px-10">
      <SectionHeader
        eyebrow="Capabilities"
        title="What we can build"
        sub="One execution layer, every modern stack. We pick the right tool for the job — you ship."
      />

      <div className="mt-14 grid sm:grid-cols-2 gap-5">
        {CAPABILITY_GROUPS.map((g) => {
          const Icon = g.icon;
          return (
            <div
              key={g.title}
              className="rounded-2xl bg-card border border-border p-7 transition-all duration-200 hover:translate-y-[-2px]"
              style={{ boxShadow: '0 4px 12px rgba(15,23,42,0.04)' }}
              data-testid={`capability-${g.title.toLowerCase().replace(/\s+/g, '-')}`}
            >
              <div className="flex items-center gap-3 mb-5">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{
                    background: 'rgba(11,143,94,0.10)',
                    color: 'var(--t-signal)',
                  }}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">{g.title}</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {g.chips.map((chip) => (
                  <span
                    key={chip}
                    className="text-xs font-medium px-3 py-1.5 rounded-full bg-muted text-muted-foreground border border-border transition-all duration-150"
                    style={{ cursor: 'default' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(11,143,94,0.10)';
                      e.currentTarget.style.borderColor = 'rgba(11,143,94,0.35)';
                      e.currentTarget.style.color = 'var(--t-signal)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '';
                      e.currentTarget.style.borderColor = '';
                      e.currentTarget.style.color = '';
                    }}
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  </section>
);

/* ============================================================
 * METRICS — big numbers
 * ============================================================ */
const METRICS = [
  { value: '500+', label: 'Projects delivered' },
  { value: '98%', label: 'Success rate' },
  { value: '4 weeks', label: 'Average MVP time' },
  { value: '200+', label: 'Active developers' },
];

const MetricsSection = () => (
  <section
    className="py-24 sm:py-28 border-y border-border bg-muted/40"
    data-testid="metrics-section"
  >
    <div className="max-w-7xl mx-auto px-6 sm:px-10 grid grid-cols-2 lg:grid-cols-4 gap-6">
      {METRICS.map((m) => (
        <div
          key={m.label}
          className="rounded-2xl bg-card border border-border p-8 transition-all duration-200 hover:translate-y-[-2px]"
          style={{ boxShadow: '0 6px 18px rgba(15,23,42,0.05)' }}
        >
          <div
            className="font-semibold leading-none"
            style={{
              color: 'var(--t-signal)',
              fontSize: 'clamp(36px, 4vw, 48px)',
              fontWeight: 700,
              letterSpacing: '-0.02em',
            }}
          >
            {m.value}
          </div>
          <div className="text-sm text-muted-foreground mt-3 font-medium">{m.label}</div>
        </div>
      ))}
    </div>
  </section>
);

/* ============================================================
 * USE CASES
 * ============================================================ */
const USE_CASES = [
  { title: 'Startup MVPs', desc: 'From idea deck to live product in weeks.', sub: 'launch in 4 weeks' },
  { title: 'Internal tools', desc: 'Operations dashboards, admin panels, ops automations.', sub: 'automate operations' },
  { title: 'Marketplaces', desc: 'Two-sided platforms with payments and trust layers.', sub: 'scale + monetize' },
  { title: 'AI products', desc: 'LLM-powered apps with retrieval, agents and pipelines.', sub: 'LLM + workflows' },
  { title: 'Automation systems', desc: 'n8n / Make workflows wired into your stack.', sub: 'wire it together' },
  { title: 'Mobile apps', desc: 'React Native / Expo apps with push, billing and OTA updates.', sub: 'iOS + Android' },
];

const UseCasesSection = () => (
  <section
    id="use-cases"
    className="py-24 sm:py-28 border-t border-border"
    data-testid="use-cases-section"
  >
    <div className="max-w-7xl mx-auto px-6 sm:px-10">
      <SectionHeader
        eyebrow="Use cases"
        title="Built for teams that need to ship"
        sub="If it can be specified, the system can deliver it."
      />
      <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {USE_CASES.map((u) => (
          <div
            key={u.title}
            className="rounded-xl bg-card border border-border p-6 transition-all hover:translate-y-[-2px]"
            style={{ boxShadow: '0 4px 12px rgba(15,23,42,0.04)' }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--t-signal)' }} />
              <h3
                className="text-base font-semibold text-foreground"
                style={{ letterSpacing: '-0.01em' }}
              >
                {u.title}
              </h3>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{u.desc}</p>
            <div
              className="mt-3 text-xs font-mono font-semibold inline-flex items-center gap-1"
              style={{ color: 'var(--t-signal)' }}
            >
              → {u.sub}
            </div>
          </div>
        ))}
      </div>
    </div>
  </section>
);

/* ============================================================
 * FINAL CTA
 * ============================================================ */
const FinalCTA = ({ onStart }) => (
  <section
    className="py-28 sm:py-32 border-t border-border relative overflow-hidden"
    data-testid="final-cta"
    style={{
      background:
        'linear-gradient(180deg, hsl(var(--background)) 0%, hsl(var(--muted)) 100%)',
    }}
  >
    <div
      aria-hidden
      className="absolute inset-0 pointer-events-none"
      style={{
        background:
          'radial-gradient(700px circle at 50% 100%, rgba(11,143,94,0.10), transparent 60%)',
      }}
    />
    <div className="relative max-w-4xl mx-auto px-6 sm:px-10 text-center">
      <h2
        className="text-4xl sm:text-5xl lg:text-6xl font-semibold text-foreground"
        style={{ letterSpacing: '-0.02em', lineHeight: 1.05 }}
      >
        Get your product estimate
      </h2>
      <p className="mt-5 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto">
        Describe your idea. Get scope, timeline and cost before signing
        anything.
      </p>
      <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
        <button
          onClick={onStart}
          className="group inline-flex items-center gap-2 font-semibold px-9 py-[18px] rounded-xl text-white text-base transition-all hover:translate-y-[-2px]"
          style={{
            background: 'var(--t-signal)',
            boxShadow:
              '0 18px 40px rgba(11,143,94,0.32), 0 4px 12px rgba(11,143,94,0.20)',
          }}
          data-testid="final-cta-start"
        >
          Estimate my product
          <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
        </button>
        <span className="text-sm text-muted-foreground">
          No commitment · estimate is free
        </span>
      </div>
    </div>
  </section>
);

/* ============================================================
 * FOOTER
 * ============================================================ */
const Footer = () => (
  <footer className="border-t border-border bg-muted/40" data-testid="footer">
    <div className="max-w-7xl mx-auto px-6 sm:px-10 py-12 grid sm:grid-cols-2 gap-6 items-center">
      <div>
        <div className="flex items-center mb-3">
          <Logo height={28} className="h-7 w-auto" />
        </div>
        <p className="text-sm text-muted-foreground">
          DevOS — Execution layer for software. Real builders, structured delivery.
        </p>
      </div>
      <div className="flex flex-wrap gap-6 sm:justify-end text-sm text-muted-foreground">
        <a href="#flow" className="hover:text-foreground transition-colors">How it works</a>
        <a href="#system" className="hover:text-foreground transition-colors">System</a>
        <a href="#capabilities" className="hover:text-foreground transition-colors">Capabilities</a>
        <a href="#use-cases" className="hover:text-foreground transition-colors">Use cases</a>
      </div>
    </div>
    <div className="border-t border-border">
      <div className="max-w-7xl mx-auto px-6 sm:px-10 py-5 text-xs text-muted-foreground">
        © {new Date().getFullYear()} DevOS · Execution layer for software
      </div>
    </div>
  </footer>
);

/* ============================================================
 * TRUST SECTION — placed right after Hero. Tight layout, icon + numbers,
 * positioning subline. The job here is to disarm the price-anchor anxiety
 * before the visitor scrolls into the funnel.
 * ============================================================ */
const TRUST_ITEMS = [
  { value: '500+', label: 'Projects delivered', icon: Rocket },
  { value: '98%', label: 'Satisfaction rate', icon: ShieldCheck },
  { value: '4 weeks', label: 'Avg MVP time', icon: Zap },
  { value: '200+', label: 'Vetted developers', icon: Boxes },
];

const TrustSection = () => (
  <section
    className="py-16 sm:py-20 border-t border-border"
    data-testid="trust-section"
  >
    <div className="max-w-6xl mx-auto px-6 sm:px-10 text-center">
      <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase mb-3">
        Trusted execution system
      </p>
      <p className="text-base sm:text-lg text-foreground font-medium mb-10 max-w-2xl mx-auto">
        Real execution.{' '}
        <span className="text-muted-foreground">Not freelancers. Not agencies.</span>
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-5">
        {TRUST_ITEMS.map((t) => {
          const Icon = t.icon;
          return (
            <div
              key={t.label}
              className="rounded-2xl bg-card border border-border p-5 sm:p-6 text-left transition-all duration-200 hover:translate-y-[-2px]"
              style={{ boxShadow: '0 4px 14px rgba(15,23,42,0.04)' }}
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
                style={{ background: 'rgba(11,143,94,0.10)', color: 'var(--t-signal)' }}
              >
                <Icon className="w-4 h-4" />
              </div>
              <div
                className="font-bold leading-none"
                style={{
                  color: 'var(--t-signal)',
                  fontSize: 'clamp(24px, 2.4vw, 32px)',
                  letterSpacing: '-0.02em',
                }}
              >
                {t.value}
              </div>
              <div className="text-sm text-muted-foreground mt-2 font-medium">
                {t.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  </section>
);

/* ============================================================
 * POSITIONING — manifesto-like block right before the System section.
 * Single, declarative sentence. Reads like a product POV, not marketing.
 * ============================================================ */
const PositioningSection = () => (
  <section
    className="py-24 sm:py-28 border-t border-border relative overflow-hidden"
    data-testid="positioning-section"
  >
    <div
      aria-hidden
      className="absolute inset-0 pointer-events-none"
      style={{
        background:
          'radial-gradient(800px circle at 50% 50%, rgba(11,143,94,0.06), transparent 55%)',
      }}
    />
    <div className="relative max-w-4xl mx-auto px-6 sm:px-10 text-center">
      <h2
        className="text-3xl sm:text-5xl text-foreground"
        style={{ fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.15 }}
      >
        <span className="text-muted-foreground">Not freelancers.</span>
        <br />
        <span className="text-muted-foreground">Not agencies.</span>
        <br />
        <span className="text-muted-foreground">Not outsourcing.</span>
        <br />
        A <span style={{ color: 'var(--t-signal)' }}>structured execution system</span>.
      </h2>
      <p className="mt-7 text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
        AI defines the scope. Developers execute. QA verifies. Payments are tied
        to delivery — not promises.
      </p>
    </div>
  </section>
);

/* ============================================================
 * BUILD MODES — execution mode selector. NOT pricing tiers.
 * Customer chooses the WAY the product gets built; the system then
 * calculates the actual scope & price separately.
 * ============================================================ */
const BUILD_MODES = [
  {
    id: 'ai-build',
    name: 'AI Build',
    sub: 'Fastest path · prototypes & internal tools',
    icon: Sparkles,
    desc: 'AI generates scope, structure and most of the implementation. Engineering review is light, focused on integrations and ship.',
    points: [
      'Highest automation, lowest cost',
      'Best for prototypes, internal tools, MVPs to validate fast',
      'Engineering involvement: minimal review',
      'Fastest delivery cycle',
    ],
  },
  {
    id: 'ai-eng',
    name: 'AI + Engineering',
    sub: 'Recommended for most MVPs',
    icon: Workflow,
    desc: 'AI builds the scaffolding and the obvious parts. Engineers handle architecture, tricky logic, integrations and full QA.',
    points: [
      'Balanced: AI velocity + human review on critical paths',
      'Best for serious MVPs, B2B products, paid customer-facing apps',
      'Full QA gate, structured contract',
      'Recommended default mode',
    ],
    recommended: true,
  },
  {
    id: 'full-eng',
    name: 'Full Engineering',
    sub: 'Production-grade systems',
    icon: ShieldCheck,
    desc: 'Senior developers own architecture and implementation end-to-end. AI is used internally for speed, never as the final author.',
    points: [
      'Custom architecture, manual implementation, full QA',
      'Best for production systems, regulated domains, complex infra',
      'Dedicated team & launch control',
      'Highest delivery confidence',
    ],
  },
];

const BuildModesSection = ({ onStart }) => (
  <section
    id="build-modes"
    className="py-24 sm:py-28 border-t border-border relative"
    data-testid="build-modes-section"
    style={{
      background:
        'linear-gradient(180deg, hsl(var(--background)) 0%, hsl(var(--muted)) 100%)',
    }}
  >
    <div className="max-w-7xl mx-auto px-6 sm:px-10">
      <SectionHeader
        eyebrow="Build modes"
        title="Choose how your product gets built"
        sub="Every project is estimated dynamically. You select the execution mode — the system calculates the real scope and price."
      />

      <div className="mt-14 grid md:grid-cols-3 gap-5 items-stretch">
        {BUILD_MODES.map((mode) => {
          const Icon = mode.icon;
          const isRecommended = mode.recommended;
          return (
            <div
              key={mode.id}
              className="relative rounded-2xl p-7 transition-all duration-200 hover:translate-y-[-3px] flex flex-col"
              style={
                isRecommended
                  ? {
                      background: '#FFFFFF',
                      border: '2px solid var(--t-signal)',
                      boxShadow:
                        '0 24px 60px rgba(11,143,94,0.18), 0 4px 14px rgba(11,143,94,0.10)',
                    }
                  : {
                      background: '#FFFFFF',
                      border: '1px solid hsl(var(--border))',
                      boxShadow: '0 4px 14px rgba(15,23,42,0.04)',
                    }
              }
              data-testid={`build-mode-${mode.id}`}
            >
              {isRecommended && (
                <div
                  className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold tracking-[0.18em] uppercase px-3 py-1.5 rounded-full text-white"
                  style={{
                    background: 'var(--t-signal)',
                    boxShadow: '0 6px 16px rgba(11,143,94,0.30)',
                  }}
                >
                  Recommended
                </div>
              )}

              <div className="flex items-center gap-3 mb-2">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{
                    background: isRecommended ? 'var(--t-signal)' : 'rgba(11,143,94,0.10)',
                    color: isRecommended ? '#fff' : 'var(--t-signal)',
                  }}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <h3
                  className="text-xl font-semibold text-foreground"
                  style={{ letterSpacing: '-0.01em' }}
                >
                  {mode.name}
                </h3>
              </div>
              <p className="text-sm text-muted-foreground mb-5">{mode.sub}</p>
              <p className="text-[15px] text-foreground leading-relaxed mb-5">
                {mode.desc}
              </p>

              <ul className="space-y-2.5 mb-7 flex-1">
                {mode.points.map((p) => (
                  <li key={p} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                    <Check
                      className="w-4 h-4 mt-0.5 shrink-0"
                      style={{ color: 'var(--t-signal)', strokeWidth: 3 }}
                    />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={onStart}
                className="w-full inline-flex items-center justify-center gap-2 font-semibold py-3.5 rounded-xl transition-all hover:translate-y-[-1px]"
                style={
                  isRecommended
                    ? {
                        background: 'var(--t-signal)',
                        color: '#fff',
                        boxShadow: '0 12px 28px rgba(11,143,94,0.32)',
                      }
                    : {
                        background: 'transparent',
                        color: 'var(--t-signal)',
                        border: '1px solid rgba(11,143,94,0.35)',
                      }
                }
                data-testid={`build-mode-${mode.id}-cta`}
              >
                Estimate with {mode.name}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-center text-sm text-muted-foreground mt-10 max-w-2xl mx-auto">
        No fixed packages. No retainers. Every price is calculated from your
        actual project scope — once you describe it, the system gives you the
        number before any contract is signed.
      </p>
    </div>
  </section>
);

/* ============================================================
 * QUOTE — single-line social proof. Calm, big, no extra chrome.
 * ============================================================ */
const QuoteSection = () => (
  <section
    className="py-24 sm:py-28 border-t border-border"
    data-testid="quote-section"
  >
    <div className="max-w-3xl mx-auto px-6 sm:px-10 text-center">
      <QuoteIcon
        aria-hidden
        className="w-10 h-10 mx-auto mb-6 opacity-30"
        style={{ color: 'var(--t-signal)' }}
      />
      <p
        className="text-foreground"
        style={{
          fontSize: 'clamp(20px, 2.4vw, 30px)',
          fontWeight: 500,
          lineHeight: 1.4,
          letterSpacing: '-0.01em',
        }}
      >
        “We went from idea to production in under{' '}
        <span style={{ color: 'var(--t-signal)', fontWeight: 600 }}>3.5 weeks</span>. No
        chaos, no micromanagement — just execution.”
      </p>
      <div className="mt-8 flex items-center justify-center gap-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm"
          style={{
            background: 'rgba(11,143,94,0.12)',
            color: 'var(--t-signal)',
            border: '1px solid rgba(11,143,94,0.25)',
          }}
        >
          MR
        </div>
        <div className="text-left">
          <div className="text-sm font-semibold text-foreground">Mark R.</div>
          <div className="text-xs text-muted-foreground">Founder · SaaS startup</div>
        </div>
      </div>
    </div>
  </section>
);

/* ============================================================
 * MOBILE STICKY CTA — fixed bottom bar, mobile only. Always one tap away.
 * ============================================================ */
const MobileStickyCTA = ({ onStart }) => (
  <div
    className="md:hidden fixed bottom-0 inset-x-0 z-40 px-4 pb-4 pt-3"
    style={{
      background:
        'linear-gradient(180deg, transparent 0%, hsl(var(--background)) 35%)',
    }}
    data-testid="mobile-sticky-cta"
  >
    <button
      onClick={onStart}
      className="w-full inline-flex items-center justify-center gap-2 font-semibold py-4 rounded-xl text-white"
      style={{
        background: 'var(--t-signal)',
        boxShadow: '0 14px 32px rgba(11,143,94,0.34)',
      }}
    >
      Estimate my product
      <ArrowRight className="w-5 h-5" />
    </button>
  </div>
);

/* ============================================================
 * Shared section header
 * ============================================================ */
const SectionHeader = ({ eyebrow, title, sub }) => (
  <div className="max-w-3xl">
    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-card border border-border mb-6">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--t-signal)' }} />
      <span className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        {eyebrow}
      </span>
    </div>
    <h2
      className="text-3xl sm:text-4xl lg:text-[44px] text-foreground"
      style={{
        fontWeight: 600,
        letterSpacing: '-0.02em',
        lineHeight: 1.1,
      }}
    >
      {title}
    </h2>
    {sub && <p className="mt-5 text-base sm:text-lg text-muted-foreground max-w-2xl">{sub}</p>}
  </div>
);

export default LandingPage;
