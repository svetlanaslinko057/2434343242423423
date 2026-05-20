import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Plus, ChevronRight } from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';
import Logo from '@/components/Logo';
import DescribeWidget from '@/components/DescribeWidget';

/**
 * LandingPageLight — operational light variant.
 *
 * Direction: serious operational system in a warm-paper light aesthetic.
 * References: Stripe Press, Notion Calendar (light), early Vercel docs,
 * Raycast marketing site.
 *
 * Hard rules:
 *   - No "var(--t-signal)" startup-green anywhere. No bright mint. No marketing gradients.
 *   - Warm parchment substrate (#F5F2EC), never pure white.
 *   - Real depth via layered warm-paper surfaces, not glassmorphism.
 *   - Editorial grotesk display (Instrument Sans) + IBM Plex Mono operational labels.
 *   - SEQ-NN sequence typography, not numbered green circles.
 *   - Operational language, not marketing bullets.
 *   - CTA is a heavy graphite material on the warm paper, with real shadow physics.
 *
 * Palette (locked, light-only):
 *   bg-0      #F5F2EC    warm parchment substrate
 *   bg-1      #EDE9DF    operational layer
 *   bg-2      #E3DECF    focus layer
 *   bg-3      #FFFFFF    sharp / inset surface
 *   border-1  rgba(26,23,20,0.08)
 *   border-2  rgba(26,23,20,0.14)
 *   border-3  rgba(26,23,20,0.22)
 *   text-1    #1A1714    warm dark ink
 *   text-2    #5C544D    warm secondary
 *   text-3    #8C8278    warm muted
 *   signal    #A07A2E    bronze, ONLY for live/pulse signals
 *   cta-bg    #1A1714    heavy graphite material
 *   cta-ink   #F5F2EC    paper text on heavy material
 */

const C = {
  bg0: '#F5F2EC',
  bg1: '#EDE9DF',
  bg2: '#E3DECF',
  bg3: '#FFFFFF',
  border1: 'rgba(26,23,20,0.08)',
  border2: 'rgba(26,23,20,0.14)',
  border3: 'rgba(26,23,20,0.22)',
  text1: '#1A1714',
  text2: '#5C544D',
  text3: '#8C8278',
  signal: '#A07A2E',
  ctaBg: '#1A1714',
  ctaInk: '#F5F2EC',
};

const FONT_DISPLAY =
  "'Instrument Sans', 'Inter Tight', 'Inter', ui-sans-serif, system-ui, sans-serif";
const FONT_BODY =
  "'Inter', 'Inter Tight', ui-sans-serif, system-ui, sans-serif";
const FONT_MONO =
  "'IBM Plex Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace";

const LandingPageLight = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const id = 'instrument-sans-font';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&display=swap';
    document.head.appendChild(link);
  }, []);

  return (
    <div
      data-testid="landing-page"
      style={{
        background: C.bg0,
        color: C.text1,
        fontFamily: FONT_BODY,
        minHeight: '100vh',
        // Very subtle warm radial substrate cue — not a marketing glow.
        backgroundImage:
          'radial-gradient(1200px 600px at 50% -20%, rgba(160,122,46,0.04), transparent 60%)',
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
      }}
    >
      <Header
        onLogin={() => navigate('/builder/auth')}
        onStart={() => navigate('/client/auth')}
      />

      <main>
        <Hero onStart={() => navigate('/client/auth')} />
        <SequenceSection />
        <BuildModesSection onStart={() => navigate('/client/auth')} />
        <SystemSection />
        <CapabilitiesSection />
        <UseCasesSection />
        <ProofRow />
        <FinalCTA onStart={() => navigate('/client/auth')} />
      </main>

      <Footer />
    </div>
  );
};

/* ============================================================ HEADER */
const Header = ({ onLogin, onStart }) => (
  <header
    data-testid="landing-header"
    style={{
      position: 'sticky',
      top: 0,
      zIndex: 50,
      background: `${C.bg0}E6`,
      borderBottom: `1px solid ${C.border1}`,
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
    }}
  >
    <div
      style={{
        maxWidth: 1240,
        margin: '0 auto',
        padding: '0 32px',
        height: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 24,
      }}
    >
      <a
        href="/"
        data-testid="landing-logo"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          textDecoration: 'none',
        }}
      >
        <Logo height={36} testId="landing-logo-mark" />
      </a>

      <nav
        className="landing-nav-desktop"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 28,
          fontSize: 13,
          color: C.text2,
        }}
      >
        <HeaderLink href="#sequence" testid="nav-flow">How it works</HeaderLink>
        <HeaderLink href="#modes" testid="nav-build-modes">Build modes</HeaderLink>
        <HeaderLink href="#system" testid="nav-system">System</HeaderLink>
        <HeaderLink href="#capabilities" testid="nav-capabilities">Capabilities</HeaderLink>
        <HeaderLink href="#use-cases" testid="nav-use-cases">Use cases</HeaderLink>
      </nav>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <ThemeToggle />
        <button
          onClick={onLogin}
          data-testid="nav-login"
          style={{
            background: 'transparent',
            border: 'none',
            color: C.text2,
            fontSize: 13,
            padding: '6px 10px',
            cursor: 'pointer',
            fontFamily: FONT_BODY,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = C.text1)}
          onMouseLeave={(e) => (e.currentTarget.style.color = C.text2)}
        >
          Log in
        </button>
        <HeavyButton onClick={onStart} testid="nav-start" size="sm">
          Start project
        </HeavyButton>
      </div>
    </div>

    <style>{`
      @media (max-width: 880px) {
        .landing-nav-desktop { display: none !important; }
      }
    `}</style>
  </header>
);

const HeaderLink = ({ href, children, testid }) => (
  <a
    href={href}
    data-testid={testid}
    style={{
      color: 'inherit',
      textDecoration: 'none',
      transition: 'color 120ms ease',
    }}
    onMouseEnter={(e) => (e.currentTarget.style.color = C.text1)}
    onMouseLeave={(e) => (e.currentTarget.style.color = C.text2)}
  >
    {children}
  </a>
);

/* ============================================================ HEAVY BUTTON
 * Tactile dark material on warm paper. Inset light + real shadow + press deflection.
 */
const HeavyButton = ({ children, onClick, testid, size = 'md' }) => {
  const [pressed, setPressed] = useState(false);
  const padding =
    size === 'sm' ? '8px 14px' : size === 'lg' ? '16px 24px' : '12px 20px';
  const fontSize = size === 'sm' ? 13 : size === 'lg' ? 15 : 14;
  const drop = pressed
    ? '0 1px 0 rgba(0,0,0,0.20), 0 2px 4px rgba(0,0,0,0.10)'
    : '0 1px 0 rgba(0,0,0,0.22), 0 10px 24px rgba(26,23,20,0.20), 0 2px 4px rgba(26,23,20,0.10)';
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      onBlur={() => setPressed(false)}
      style={{
        background: C.ctaBg,
        color: C.ctaInk,
        border: `1px solid ${C.ctaBg}`,
        borderRadius: 8,
        padding,
        fontSize,
        fontWeight: 600,
        fontFamily: FONT_BODY,
        letterSpacing: '-0.005em',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -1px 0 rgba(0,0,0,0.40), ${drop}`,
        transform: pressed ? 'translateY(1px)' : 'translateY(0)',
        transition: 'transform 60ms ease, box-shadow 120ms ease',
      }}
    >
      {children}
    </button>
  );
};

/* ============================================================ HERO */
const Hero = ({ onStart }) => (
  <section
    data-testid="hero"
    style={{
      position: 'relative',
      padding: '120px 32px 96px',
      overflow: 'hidden',
    }}
  >
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        background:
          'radial-gradient(820px 500px at 12% 16%, rgba(160,122,46,0.07), transparent 60%)',
      }}
    />
    <div
      className="hero-grid"
      style={{
        position: 'relative',
        maxWidth: 1240,
        margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 1fr)',
        gap: 64,
        alignItems: 'center',
      }}
    >
      <div>
        <div data-testid="hero-eyebrow" style={kickerStyle}>
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: C.signal,
              display: 'inline-block',
              marginRight: 8,
              boxShadow: '0 0 0 3px rgba(160,122,46,0.14)',
            }}
          />
          OPERATIONAL · EXECUTION SUBSTRATE
        </div>

        <h1
          data-testid="hero-title"
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 600,
            fontSize: 'clamp(48px, 6.4vw, 84px)',
            lineHeight: 0.98,
            letterSpacing: '-0.035em',
            color: C.text1,
            margin: '24px 0 0',
          }}
        >
          Software,
          <br />
          actually shipped.
        </h1>

        <p
          data-testid="hero-subtitle"
          style={{
            color: C.text2,
            marginTop: 28,
            fontSize: 18,
            lineHeight: 1.55,
            maxWidth: 540,
          }}
        >
          Describe what you need. The system scopes it, prices it, assigns
          builders, runs QA and locks delivery against a contract — without
          retainers, packages or back-and-forth.
        </p>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            marginTop: 36,
            maxWidth: 560,
          }}
          data-testid="hero-describe"
        >
          {/* Inline describe widget — paste link, write text, or attach file. No voice. */}
          <DescribeWidget mode="inline" />
          <a
            href="#sequence"
            data-testid="hero-join-button"
            style={{ ...ghostButton, alignSelf: 'flex-start' }}
          >
            See the operational flow
            <ChevronRight size={14} strokeWidth={2} />
          </a>
        </div>

        <div
          style={{
            marginTop: 56,
            paddingTop: 24,
            borderTop: `1px solid ${C.border1}`,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 24,
            maxWidth: 540,
          }}
        >
          <TrustItem k="Live runtime" v="500+ projects executed" />
          <TrustItem k="Delivery rate" v="98% contract-met" />
          <TrustItem k="Median MVP" v="4 weeks · scope-locked" />
        </div>
      </div>

      <PipelinePanel />
    </div>

    <style>{`
      @media (max-width: 980px) {
        .hero-grid { grid-template-columns: 1fr !important; gap: 48px !important; }
      }
    `}</style>
  </section>
);

const TrustItem = ({ k, v }) => (
  <div>
    <div style={{ ...kickerStyle, marginBottom: 6 }}>{k}</div>
    <div style={{ color: C.text1, fontSize: 13 }}>{v}</div>
  </div>
);

/* ============================================================ PIPELINE PANEL */
const PIPELINE_ROWS = [
  { seq: '01', name: 'Intake', meta: 'idea · structured', state: 'done' },
  { seq: '02', name: 'Scope', meta: '6 modules · $4,200', state: 'done' },
  { seq: '03', name: 'Contract', meta: 'escrow staged', state: 'done' },
  { seq: '04', name: 'Build', meta: '3 builders · live', state: 'active' },
  { seq: '05', name: 'QA', meta: '12 / 12 verified', state: 'pending' },
  { seq: '06', name: 'Delivery', meta: 'release locked', state: 'pending' },
];

const PipelinePanel = () => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1400);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      data-testid="pipeline-ui"
      style={{
        background: C.bg3,
        border: `1px solid ${C.border2}`,
        borderRadius: 12,
        boxShadow:
          '0 1px 0 rgba(255,255,255,0.6), 0 24px 60px rgba(26,23,20,0.10), 0 4px 14px rgba(26,23,20,0.06)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${C.border1}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: C.bg1,
          fontFamily: FONT_MONO,
          fontSize: 11,
          color: C.text3,
          letterSpacing: '0.04em',
        }}
      >
        <span>devos · execution.pipeline</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: C.signal,
              opacity: tick % 2 === 0 ? 1 : 0.45,
              transition: 'opacity 600ms ease',
            }}
          />
          LIVE
        </span>
      </div>

      <div>
        {PIPELINE_ROWS.map((r, i) => (
          <div
            key={r.seq}
            style={{
              display: 'grid',
              gridTemplateColumns: '64px 1fr auto',
              gap: 16,
              alignItems: 'center',
              padding: '14px 16px',
              borderTop: i === 0 ? 'none' : `1px solid ${C.border1}`,
              background:
                r.state === 'active' ? 'rgba(160,122,46,0.06)' : 'transparent',
            }}
          >
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: r.state === 'pending' ? C.text3 : C.text2,
                letterSpacing: '0.06em',
              }}
            >
              SEQ-{r.seq}
            </span>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14,
                  color: C.text1,
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 500,
                  letterSpacing: '-0.005em',
                }}
              >
                {r.name}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: C.text2,
                  fontFamily: FONT_MONO,
                  marginTop: 2,
                }}
              >
                {r.meta}
              </div>
            </div>
            <StatePill state={r.state} />
          </div>
        ))}
      </div>

      <div
        style={{
          padding: '10px 16px',
          borderTop: `1px solid ${C.border1}`,
          background: C.bg1,
          fontFamily: FONT_MONO,
          fontSize: 11,
          color: C.text3,
          display: 'flex',
          justifyContent: 'space-between',
          letterSpacing: '0.04em',
        }}
      >
        <span>auto-orchestrated · contract-bound · qa-gated</span>
        <span>v1.0</span>
      </div>
    </div>
  );
};

const StatePill = ({ state }) => {
  const map = {
    done: { label: 'DONE', color: C.text2, bg: C.bg1, border: C.border1 },
    active: {
      label: 'RUNNING',
      color: '#7A5A1F',
      bg: 'rgba(160,122,46,0.10)',
      border: 'rgba(160,122,46,0.38)',
    },
    pending: { label: 'QUEUED', color: C.text3, bg: 'transparent', border: C.border1 },
  };
  const m = map[state];
  return (
    <span
      style={{
        fontFamily: FONT_MONO,
        fontSize: 10,
        letterSpacing: '0.08em',
        color: m.color,
        background: m.bg,
        border: `1px solid ${m.border}`,
        padding: '4px 8px',
        borderRadius: 4,
      }}
    >
      {m.label}
    </span>
  );
};

/* ============================================================ SEQUENCE */
const SEQUENCE = [
  {
    seq: '01',
    title: 'Describe what you want',
    body: 'Plain text. Goals, users, constraints. The system parses it into a structured intake.',
    meta: 'intake.structured',
  },
  {
    seq: '02',
    title: 'Pick the execution mode',
    body: 'AI Build, AI + Engineering, or Full Engineering. The mode adjusts who actually writes the code.',
    meta: 'mode.selected',
  },
  {
    seq: '03',
    title: 'Receive scope and price',
    body: 'Modules, timeline and a real number derived from your project. No fixed packages, no estimate-by-feel.',
    meta: 'scope.computed',
  },
  {
    seq: '04',
    title: 'Sign a scope-locked contract',
    body: 'Escrow is staged. Payments release only against verified delivery. Nothing starts before this.',
    meta: 'contract.bound',
  },
  {
    seq: '05',
    title: 'Watch execution run',
    body: 'Builders work, QA verifies, the dashboard streams state in real time. Money releases on done — not on talk.',
    meta: 'runtime.live',
  },
];

const SequenceSection = () => (
  <section
    id="sequence"
    data-testid="flow-section"
    style={{ padding: '120px 32px', borderTop: `1px solid ${C.border1}` }}
  >
    <div style={{ maxWidth: 1240, margin: '0 auto' }}>
      <SectionHeader
        kicker="HOW IT RUNS"
        title="An operational sequence, not a sales funnel."
        sub="From a plain-text idea to a contract-bound, QA-gated delivery — without sales calls between steps."
      />

      <div
        style={{
          marginTop: 56,
          border: `1px solid ${C.border1}`,
          borderRadius: 14,
          background: C.bg3,
          overflow: 'hidden',
          boxShadow:
            '0 1px 0 rgba(255,255,255,0.6), 0 12px 40px rgba(26,23,20,0.08)',
        }}
      >
        {SEQUENCE.map((s, i) => (
          <SequenceRow key={s.seq} step={s} first={i === 0} />
        ))}
      </div>
    </div>
  </section>
);

const SequenceRow = ({ step, first }) => {
  const [hover, setHover] = useState(false);
  return (
    <div
      data-testid={`flow-step-${step.seq}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: '110px 1fr 160px',
        gap: 32,
        padding: '32px 32px',
        alignItems: 'start',
        borderTop: first ? 'none' : `1px solid ${C.border1}`,
        background: hover ? C.bg1 : 'transparent',
        transition: 'background 150ms ease',
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 12,
          letterSpacing: '0.1em',
          color: hover ? C.signal : C.text3,
          transition: 'color 150ms ease',
          paddingTop: 4,
        }}
      >
        SEQ-{step.seq}
      </div>
      <div>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 22,
            fontWeight: 500,
            letterSpacing: '-0.015em',
            color: C.text1,
            lineHeight: 1.2,
          }}
        >
          {step.title}
        </div>
        <p
          style={{
            color: C.text2,
            fontSize: 14.5,
            lineHeight: 1.6,
            marginTop: 8,
            maxWidth: 620,
          }}
        >
          {step.body}
        </p>
      </div>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 11.5,
          letterSpacing: '0.04em',
          color: C.text3,
          textAlign: 'right',
          paddingTop: 6,
        }}
      >
        → {step.meta}
      </div>
    </div>
  );
};

/* ============================================================ BUILD MODES */
const BUILD_MODES = [
  {
    id: 'ai-build',
    name: 'AI Build',
    sub: 'Fastest path · prototypes & internal tools',
    desc: 'AI generates the structure and most of the implementation. Engineering review is light, scoped to integrations and release.',
    points: [
      'Highest automation, lowest cost',
      'Prototypes, internal tools, validation MVPs',
      'Light engineering oversight',
    ],
  },
  {
    id: 'ai-eng',
    name: 'AI + Engineering',
    sub: 'Recommended for most MVPs',
    desc: 'AI builds the scaffolding and the obvious parts. Engineers own architecture, critical logic, integrations and full QA.',
    points: [
      'Balanced velocity and review',
      'Customer-facing MVPs, B2B products',
      'Full QA gate, scope-locked contract',
    ],
    recommended: true,
  },
  {
    id: 'full-eng',
    name: 'Full Engineering',
    sub: 'Production-grade systems',
    desc: 'Senior developers own architecture and implementation end-to-end. AI is used internally for speed, never as the final author.',
    points: [
      'Custom architecture, manual implementation',
      'Production systems, regulated domains',
      'Dedicated team, full delivery control',
    ],
  },
];

const BuildModesSection = ({ onStart }) => (
  <section
    id="modes"
    data-testid="build-modes-section"
    style={{ padding: '120px 32px', borderTop: `1px solid ${C.border1}` }}
  >
    <div style={{ maxWidth: 1240, margin: '0 auto' }}>
      <SectionHeader
        kicker="EXECUTION MODES"
        title="Choose how it gets built."
        sub="The mode decides who writes the code. The system then computes the actual scope and price from your project — once, before you commit."
      />

      <div
        className="modes-grid"
        style={{
          marginTop: 56,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 16,
        }}
      >
        {BUILD_MODES.map((m) => (
          <ModePanel key={m.id} mode={m} onStart={onStart} />
        ))}
      </div>

      <p
        style={{
          textAlign: 'center',
          color: C.text3,
          fontSize: 13,
          fontFamily: FONT_MONO,
          marginTop: 40,
          letterSpacing: '0.04em',
        }}
      >
        — no packages · no retainers · price computed from your scope —
      </p>
    </div>

    <style>{`
      @media (max-width: 920px) {
        .modes-grid { grid-template-columns: 1fr !important; }
      }
    `}</style>
  </section>
);

const ModePanel = ({ mode, onStart }) => {
  const [hover, setHover] = useState(false);
  return (
    <div
      data-testid={`build-mode-${mode.id}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        background: C.bg3,
        border: `1px solid ${mode.recommended ? 'rgba(160,122,46,0.40)' : C.border1}`,
        borderRadius: 14,
        padding: 32,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: mode.recommended
          ? '0 1px 0 rgba(255,255,255,0.7), 0 14px 36px rgba(26,23,20,0.10)'
          : '0 1px 0 rgba(255,255,255,0.6), 0 8px 24px rgba(26,23,20,0.06)',
        transform: hover ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease',
      }}
    >
      {mode.recommended && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: '0.12em',
            color: '#7A5A1F',
            padding: '3px 8px',
            border: '1px solid rgba(160,122,46,0.40)',
            borderRadius: 4,
            background: 'rgba(160,122,46,0.08)',
          }}
        >
          RECOMMENDED
        </div>
      )}

      <div style={{ ...kickerStyle, marginBottom: 14 }}>
        {mode.id.toUpperCase().replace('-', ' / ')}
      </div>
      <h3
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 500,
          fontSize: 26,
          letterSpacing: '-0.02em',
          color: C.text1,
          margin: 0,
        }}
      >
        {mode.name}
      </h3>
      <div
        style={{
          color: C.text3,
          fontSize: 13,
          marginTop: 6,
          fontFamily: FONT_MONO,
        }}
      >
        {mode.sub}
      </div>

      <p
        style={{
          color: C.text2,
          fontSize: 14.5,
          lineHeight: 1.6,
          marginTop: 22,
        }}
      >
        {mode.desc}
      </p>

      <div
        style={{
          marginTop: 22,
          borderTop: `1px solid ${C.border1}`,
          paddingTop: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          flex: 1,
        }}
      >
        {mode.points.map((p) => (
          <div
            key={p}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              fontSize: 13.5,
              color: C.text2,
              lineHeight: 1.5,
            }}
          >
            <Plus
              size={12}
              strokeWidth={2}
              style={{ color: C.text3, marginTop: 4 }}
            />
            <span>{p}</span>
          </div>
        ))}
      </div>

      <button
        onClick={onStart}
        data-testid={`build-mode-${mode.id}-cta`}
        style={{
          marginTop: 28,
          background: 'transparent',
          color: C.text1,
          border: `1px solid ${C.border2}`,
          borderRadius: 8,
          padding: '12px 16px',
          fontFamily: FONT_BODY,
          fontSize: 13.5,
          fontWeight: 500,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          transition: 'background 120ms ease, border-color 120ms ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = C.bg1;
          e.currentTarget.style.borderColor = C.border3;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.borderColor = C.border2;
        }}
      >
        Estimate with {mode.name}
        <ArrowUpRight size={14} strokeWidth={2.25} />
      </button>
    </div>
  );
};

/* ============================================================ SYSTEM */
const SYSTEM_CARDS = [
  {
    code: 'SCOPE.AI',
    title: 'AI Scoping',
    desc: 'Turns a raw idea into architecture, modules, timeline and price — in minutes, not weeks.',
  },
  {
    code: 'TASKS.RUNTIME',
    title: 'Task System',
    desc: 'Every step decomposed, assigned and tracked. No tickets lost, no silent stalls.',
  },
  {
    code: 'QA.GATE',
    title: 'QA Validation',
    desc: 'Every feature passes a structured QA gate before it ever reaches you for approval.',
  },
  {
    code: 'BUILDERS.NET',
    title: 'Developer Network',
    desc: 'Vetted senior builders. Auto-matched to scope, capacity-balanced, reputation-tracked.',
  },
  {
    code: 'CONTRACT.BIND',
    title: 'Contract & Payments',
    desc: 'Scope is locked, escrow is staged, money releases on verified delivery — not on talk.',
  },
  {
    code: 'OBSERV.LIVE',
    title: 'Transparency Layer',
    desc: 'Live dashboard: what is being built right now, by whom, with which risks. No black box.',
  },
];

const SystemSection = () => (
  <section
    id="system"
    data-testid="system-section"
    style={{ padding: '120px 32px', borderTop: `1px solid ${C.border1}` }}
  >
    <div style={{ maxWidth: 1240, margin: '0 auto' }}>
      <SectionHeader
        kicker="THE SUBSTRATE"
        title="The execution layer that runs underneath."
        sub="Not freelancers. Not agencies. A structured runtime that turns ideas into delivered software."
      />

      <div
        className="system-grid"
        style={{
          marginTop: 56,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 1,
          background: C.border1,
          border: `1px solid ${C.border1}`,
          borderRadius: 14,
          overflow: 'hidden',
        }}
      >
        {SYSTEM_CARDS.map((c) => (
          <SystemCard key={c.code} card={c} />
        ))}
      </div>
    </div>

    <style>{`
      @media (max-width: 920px) {
        .system-grid { grid-template-columns: 1fr !important; }
      }
    `}</style>
  </section>
);

const SystemCard = ({ card }) => {
  const [hover, setHover] = useState(false);
  return (
    <div
      data-testid={`system-card-${card.title.toLowerCase().replace(/\s+/g, '-')}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? C.bg1 : C.bg3,
        padding: 28,
        minHeight: 180,
        transition: 'background 180ms ease',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          ...kickerStyle,
          color: hover ? C.signal : C.text3,
          transition: 'color 180ms ease',
        }}
      >
        {card.code}
      </div>
      <h3
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 500,
          fontSize: 20,
          letterSpacing: '-0.015em',
          color: C.text1,
          margin: '14px 0 10px',
        }}
      >
        {card.title}
      </h3>
      <p
        style={{
          color: C.text2,
          fontSize: 14,
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        {card.desc}
      </p>
    </div>
  );
};

/* ============================================================ CAPABILITIES */
const CAPABILITY_GROUPS = [
  {
    code: 'STACK.CORE',
    title: 'Core stack',
    chips: ['React', 'Next.js', 'Vue', 'Node.js', 'NestJS', 'Express', 'Python', 'FastAPI'],
  },
  {
    code: 'STACK.MOBILE',
    title: 'Mobile',
    chips: ['React Native', 'Expo', 'iOS', 'Android', 'Push notifications'],
  },
  {
    code: 'STACK.INFRA',
    title: 'APIs & infra',
    chips: ['REST', 'GraphQL', 'Stripe', 'PayPal', 'MongoDB', 'PostgreSQL', 'MySQL', 'Redis'],
  },
  {
    code: 'STACK.AUTOM',
    title: 'Automation & no-code',
    chips: ['n8n', 'Make', 'Zapier', 'Webflow', 'Bubble', 'Airtable'],
  },
];

const CapabilitiesSection = () => (
  <section
    id="capabilities"
    data-testid="capabilities-section"
    style={{ padding: '120px 32px', borderTop: `1px solid ${C.border1}` }}
  >
    <div style={{ maxWidth: 1240, margin: '0 auto' }}>
      <SectionHeader
        kicker="CAPABILITIES"
        title="What the system can ship."
        sub="One execution layer, every modern stack. The system picks the right tool for the job — you take delivery."
      />

      <div
        className="cap-grid"
        style={{
          marginTop: 56,
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 16,
        }}
      >
        {CAPABILITY_GROUPS.map((g) => (
          <div
            key={g.title}
            data-testid={`capability-${g.title.toLowerCase().replace(/\s+/g, '-')}`}
            style={{
              background: C.bg3,
              border: `1px solid ${C.border1}`,
              borderRadius: 14,
              padding: 28,
            }}
          >
            <div style={kickerStyle}>{g.code}</div>
            <h3
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 500,
                fontSize: 20,
                letterSpacing: '-0.015em',
                color: C.text1,
                margin: '10px 0 18px',
              }}
            >
              {g.title}
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {g.chips.map((chip) => (
                <span
                  key={chip}
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 12,
                    letterSpacing: '0.02em',
                    color: C.text2,
                    background: C.bg1,
                    border: `1px solid ${C.border1}`,
                    padding: '5px 10px',
                    borderRadius: 6,
                  }}
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>

    <style>{`
      @media (max-width: 720px) {
        .cap-grid { grid-template-columns: 1fr !important; }
      }
    `}</style>
  </section>
);

/* ============================================================ USE CASES */
const USE_CASES = [
  { tag: 'USE.STARTUP', title: 'Startup MVPs', body: 'From idea deck to live product in weeks.' },
  { tag: 'USE.INTERNAL', title: 'Internal tools', body: 'Operations dashboards, admin panels, ops automations.' },
  { tag: 'USE.MARKET', title: 'Marketplaces', body: 'Two-sided platforms with payments and trust layers.' },
  { tag: 'USE.AI', title: 'AI products', body: 'LLM-powered apps with retrieval, agents and pipelines.' },
  { tag: 'USE.AUTOM', title: 'Automation systems', body: 'n8n / Make workflows wired into your stack.' },
  { tag: 'USE.MOBILE', title: 'Mobile apps', body: 'React Native / Expo apps with push, billing and OTA updates.' },
];

const UseCasesSection = () => (
  <section
    id="use-cases"
    data-testid="use-cases-section"
    style={{ padding: '120px 32px', borderTop: `1px solid ${C.border1}` }}
  >
    <div style={{ maxWidth: 1240, margin: '0 auto' }}>
      <SectionHeader
        kicker="WHAT IT EXECUTES"
        title="Built for teams that need to ship."
        sub="If it can be specified, the system can deliver it."
      />

      <div
        style={{
          marginTop: 56,
          border: `1px solid ${C.border1}`,
          borderRadius: 14,
          background: C.bg3,
          overflow: 'hidden',
        }}
      >
        {USE_CASES.map((u, i) => (
          <UseCaseRow key={u.tag} u={u} first={i === 0} />
        ))}
      </div>
    </div>
  </section>
);

const UseCaseRow = ({ u, first }) => {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: '160px 1fr auto',
        gap: 32,
        padding: '22px 32px',
        alignItems: 'center',
        borderTop: first ? 'none' : `1px solid ${C.border1}`,
        background: hover ? C.bg1 : 'transparent',
        transition: 'background 150ms ease',
        cursor: 'default',
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 11.5,
          letterSpacing: '0.08em',
          color: hover ? C.signal : C.text3,
          transition: 'color 150ms ease',
        }}
      >
        {u.tag}
      </span>
      <div>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 17,
            fontWeight: 500,
            letterSpacing: '-0.01em',
            color: C.text1,
          }}
        >
          {u.title}
        </div>
        <div
          style={{
            color: C.text2,
            fontSize: 13.5,
            marginTop: 4,
            lineHeight: 1.5,
          }}
        >
          {u.body}
        </div>
      </div>
      <ChevronRight
        size={16}
        strokeWidth={1.75}
        style={{
          color: hover ? C.text1 : C.text3,
          transition: 'color 150ms ease, transform 150ms ease',
          transform: hover ? 'translateX(2px)' : 'translateX(0)',
        }}
      />
    </div>
  );
};

/* ============================================================ PROOF ROW */
const PROOF = [
  { k: 'projects executed', v: '500+' },
  { k: 'contract-met delivery', v: '98%' },
  { k: 'median MVP time', v: '4 wk' },
  { k: 'vetted builders', v: '200+' },
];

const ProofRow = () => (
  <section
    data-testid="trust-section"
    style={{ padding: '80px 32px', borderTop: `1px solid ${C.border1}` }}
  >
    <div
      className="proof-grid"
      style={{
        maxWidth: 1240,
        margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: 1,
        background: C.border1,
        border: `1px solid ${C.border1}`,
        borderRadius: 14,
        overflow: 'hidden',
      }}
    >
      {PROOF.map((p) => (
        <div
          key={p.k}
          style={{
            background: C.bg3,
            padding: '32px 28px',
          }}
        >
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 500,
              fontSize: 36,
              letterSpacing: '-0.03em',
              color: C.text1,
              lineHeight: 1,
            }}
          >
            {p.v}
          </div>
          <div style={{ ...kickerStyle, marginTop: 12 }}>{p.k}</div>
        </div>
      ))}
    </div>

    <style>{`
      @media (max-width: 760px) {
        .proof-grid { grid-template-columns: repeat(2, 1fr) !important; }
      }
    `}</style>
  </section>
);

/* ============================================================ FINAL CTA */
const FinalCTA = ({ onStart }) => (
  <section
    data-testid="final-cta"
    style={{ padding: '120px 32px', borderTop: `1px solid ${C.border1}` }}
  >
    <div
      style={{
        maxWidth: 1080,
        margin: '0 auto',
        background: C.bg3,
        border: `1px solid ${C.border2}`,
        borderRadius: 16,
        padding: '64px 48px',
        textAlign: 'center',
        boxShadow:
          '0 1px 0 rgba(255,255,255,0.7), 0 24px 60px rgba(26,23,20,0.10)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(600px 240px at 50% 0%, rgba(160,122,46,0.06), transparent 60%)',
        }}
      />
      <div style={{ ...kickerStyle, position: 'relative' }}>
        READY WHEN YOU ARE
      </div>
      <h2
        style={{
          position: 'relative',
          fontFamily: FONT_DISPLAY,
          fontWeight: 500,
          fontSize: 'clamp(36px, 4.6vw, 56px)',
          letterSpacing: '-0.025em',
          lineHeight: 1.05,
          color: C.text1,
          margin: '18px 0 16px',
        }}
      >
        Estimate your product
        <br />
        before you sign anything.
      </h2>
      <p
        style={{
          position: 'relative',
          color: C.text2,
          fontSize: 16,
          lineHeight: 1.55,
          maxWidth: 580,
          margin: '0 auto',
        }}
      >
        Describe what you need. Get the scope, the timeline and the real
        number. No retainers, no packages, no commitment.
      </p>
      <div
        style={{
          position: 'relative',
          marginTop: 36,
          display: 'flex',
          gap: 16,
          alignItems: 'center',
          justifyContent: 'center',
          flexWrap: 'wrap',
        }}
      >
        <HeavyButton onClick={onStart} testid="final-cta-start" size="lg">
          Estimate my product
          <ArrowUpRight size={16} strokeWidth={2.25} />
        </HeavyButton>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 12,
            color: C.text3,
            letterSpacing: '0.04em',
          }}
        >
          → estimate is free · no contact required
        </span>
      </div>
    </div>
  </section>
);

/* ============================================================ FOOTER */
const Footer = () => (
  <footer
    data-testid="footer"
    style={{ borderTop: `1px solid ${C.border1}` }}
  >
    <div
      className="footer-grid"
      style={{
        maxWidth: 1240,
        margin: '0 auto',
        padding: '48px 32px 32px',
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 24,
        alignItems: 'center',
      }}
    >
      <div>
        <Logo height={28} testId="landing-footer-logo" />
        <p
          style={{
            color: C.text3,
            fontSize: 12.5,
            marginTop: 14,
            fontFamily: FONT_MONO,
            letterSpacing: '0.02em',
          }}
        >
          Execution substrate for software · real builders · scope-locked delivery
        </p>
      </div>
      <div style={{ display: 'flex', gap: 20, fontSize: 13, color: C.text2 }}>
        <HeaderLink href="#sequence">How it works</HeaderLink>
        <HeaderLink href="#system">System</HeaderLink>
        <HeaderLink href="#capabilities">Capabilities</HeaderLink>
        <HeaderLink href="#use-cases">Use cases</HeaderLink>
      </div>
    </div>
    <div style={{ borderTop: `1px solid ${C.border1}` }}>
      <div
        style={{
          maxWidth: 1240,
          margin: '0 auto',
          padding: '16px 32px',
          fontFamily: FONT_MONO,
          fontSize: 11.5,
          color: C.text3,
          letterSpacing: '0.04em',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>© {new Date().getFullYear()} ATLAS / devos</span>
        <span>v1.0 · operational</span>
      </div>
    </div>

    <style>{`
      @media (max-width: 720px) {
        .footer-grid { grid-template-columns: 1fr !important; }
      }
    `}</style>
  </footer>
);

/* ============================================================ PRIMITIVES */
const kickerStyle = {
  fontFamily: FONT_MONO,
  fontSize: 11,
  letterSpacing: '0.14em',
  color: C.text3,
  textTransform: 'uppercase',
  display: 'inline-flex',
  alignItems: 'center',
};

const ghostButton = {
  background: 'transparent',
  color: C.text1,
  border: `1px solid ${C.border2}`,
  borderRadius: 8,
  padding: '16px 22px',
  fontFamily: FONT_BODY,
  fontSize: 14,
  fontWeight: 500,
  textDecoration: 'none',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  transition: 'background 120ms ease, border-color 120ms ease',
};

const SectionHeader = ({ kicker, title, sub }) => (
  <div style={{ maxWidth: 760 }}>
    <div style={kickerStyle}>{kicker}</div>
    <h2
      style={{
        fontFamily: FONT_DISPLAY,
        fontWeight: 500,
        fontSize: 'clamp(32px, 4vw, 48px)',
        letterSpacing: '-0.025em',
        lineHeight: 1.05,
        color: C.text1,
        margin: '14px 0 0',
      }}
    >
      {title}
    </h2>
    {sub && (
      <p
        style={{
          color: C.text2,
          fontSize: 16,
          lineHeight: 1.55,
          marginTop: 18,
          maxWidth: 620,
        }}
      >
        {sub}
      </p>
    )}
  </div>
);

export default LandingPageLight;
