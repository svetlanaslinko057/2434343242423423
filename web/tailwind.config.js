/**
 * Tailwind config — Phase 1 design-system bridge.
 *
 * Strategy:
 *   1. Drop `hsl()` wrapping for shadcn-style semantic colors. Our tokens
 *      are concrete hex values from /packages/design-system/tokens/palette.css.
 *   2. Override monochrome Tailwind palettes (emerald, teal, slate, gray,
 *      neutral, zinc) to point at canonical sage/graphite. This instantly
 *      heals 53+ pages that use `bg-emerald-500` etc., without page edits.
 *   3. DO NOT override semantic palettes (red, yellow, amber, blue, purple,
 *      pink). They must keep their meaning and will be migrated manually in
 *      Phase 3 (codemod or per-page review).
 *   4. Add new semantic utilities: `bg-app`, `bg-surface`, `text-signal`,
 *      `border-app`, etc. — the canonical naming going forward.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    './src/**/*.{js,jsx,ts,tsx}',
    './public/index.html',
  ],
  theme: {
    extend: {
      // ===== RADIUS — 5 ratchet system =====
      borderRadius: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '24px',
        // legacy aliases (some pages still use these)
        DEFAULT: '12px',
        full: '9999px',
      },

      // ===== SPACING — 4pt grid (extends Tailwind's default scale) =====
      spacing: {
        '1.5': '6px',
        '4.5': '18px',
      },

      // ===== COLORS =====
      colors: {
        /* --- Phase 1 canonical (recommended names) --- */
        app:             'var(--t-bg)',
        surface:         'var(--t-surface)',
        'surface-raised':'var(--t-surface-raised)',
        'surface-sunken':'var(--t-surface-sunken)',
        signal: {
          DEFAULT: 'var(--t-signal)',
          hover:   'var(--t-signal-hover)',
          active:  'var(--t-signal-active)',
          ink:     'var(--t-signal-ink)',
          soft:    'var(--t-signal-bg-soft)',
          strong:  'var(--t-signal-bg-strong)',
          border:  'var(--t-signal-border)',
        },
        'text-primary':   'var(--t-text-primary)',
        'text-secondary': 'var(--t-text-secondary)',
        'text-muted':     'var(--t-text-muted)',
        'text-inverse':   'var(--t-text-inverse)',

        /* --- shadcn-style semantic (existing pages depend on these) ---
           Hex-direct (not hsl) — matches deprecated.css mappings. */
        background:  'var(--t-bg)',
        foreground:  'var(--t-text-primary)',
        card: {
          DEFAULT:    'var(--t-surface)',
          foreground: 'var(--t-text-primary)',
        },
        popover: {
          DEFAULT:    'var(--t-surface-raised)',
          foreground: 'var(--t-text-primary)',
        },
        primary: {
          DEFAULT:    'var(--t-signal)',
          foreground: 'var(--t-signal-ink)',
        },
        secondary: {
          DEFAULT:    'var(--t-surface-raised)',
          foreground: 'var(--t-text-primary)',
        },
        muted: {
          DEFAULT:    'var(--t-surface-raised)',
          foreground: 'var(--t-text-secondary)',
        },
        accent: {
          DEFAULT:    'var(--t-signal-bg-soft)',
          foreground: 'var(--t-signal)',
        },
        destructive: {
          DEFAULT:    'var(--t-danger)',
          foreground: 'var(--t-danger-ink)',
        },
        border: 'var(--t-border-default)',
        input:  'var(--t-surface)',
        ring:   'var(--t-signal)',

        /* --- Status colors (semantic, keep separate from signal) --- */
        success: {
          DEFAULT: 'var(--t-success)',
          ink:     'var(--t-success-ink)',
          soft:    'var(--t-success-bg-soft)',
          border:  'var(--t-success-border)',
        },
        warning: {
          DEFAULT: 'var(--t-warning)',
          ink:     'var(--t-warning-ink)',
          soft:    'var(--t-warning-bg-soft)',
          border:  'var(--t-warning-border)',
        },
        danger: {
          DEFAULT: 'var(--t-danger)',
          ink:     'var(--t-danger-ink)',
          soft:    'var(--t-danger-bg-soft)',
          border:  'var(--t-danger-border)',
        },
        info: {
          DEFAULT: 'var(--t-info)',
          ink:     'var(--t-info-ink)',
          soft:    'var(--t-info-bg-soft)',
          border:  'var(--t-info-border)',
        },

        /* --- MONOCHROME FAMILY OVERRIDES ---
           These were used as substrate/brand-ish neutrals across 50+ pages.
           Map them to canonical sage / graphite so existing JSX stops
           rendering off-palette without any edit. */
        emerald: {
          50:  'var(--t-signal-bg-soft)',
          100: 'var(--t-signal-bg-soft)',
          200: 'var(--t-signal-bg-strong)',
          300: 'var(--t-signal-hover)',
          400: 'var(--t-signal)',
          500: 'var(--t-signal)',
          600: 'var(--t-signal-active)',
          700: 'var(--t-signal-active)',
          800: 'var(--t-signal-active)',
          900: 'var(--t-signal-active)',
        },
        teal: {
          50:  'var(--t-signal-bg-soft)',
          100: 'var(--t-signal-bg-soft)',
          200: 'var(--t-signal-bg-strong)',
          300: 'var(--t-signal-hover)',
          400: 'var(--t-signal)',
          500: 'var(--t-signal)',
          600: 'var(--t-signal-active)',
          700: 'var(--t-signal-active)',
          800: 'var(--t-signal-active)',
          900: 'var(--t-signal-active)',
        },
        slate: {
          50:  'var(--t-text-primary)',  // light-mode usage: text on dark
          100: 'var(--t-text-secondary)',
          200: 'var(--t-text-muted)',
          300: 'var(--t-border-strong)',
          400: 'var(--t-text-muted)',
          500: 'var(--t-text-secondary)',
          600: 'var(--t-surface-raised)',
          700: 'var(--t-surface-raised)',
          800: 'var(--t-surface)',
          900: 'var(--t-bg)',
          950: 'var(--t-surface-sunken)',
        },
        gray: {
          50:  'var(--t-text-primary)',
          100: 'var(--t-text-secondary)',
          200: 'var(--t-text-muted)',
          300: 'var(--t-border-strong)',
          400: 'var(--t-text-muted)',
          500: 'var(--t-text-secondary)',
          600: 'var(--t-surface-raised)',
          700: 'var(--t-surface-raised)',
          800: 'var(--t-surface)',
          900: 'var(--t-bg)',
          950: 'var(--t-surface-sunken)',
        },
        neutral: {
          50:  'var(--t-text-primary)',
          100: 'var(--t-text-secondary)',
          200: 'var(--t-text-muted)',
          300: 'var(--t-border-strong)',
          400: 'var(--t-text-muted)',
          500: 'var(--t-text-secondary)',
          600: 'var(--t-surface-raised)',
          700: 'var(--t-surface-raised)',
          800: 'var(--t-surface)',
          900: 'var(--t-bg)',
          950: 'var(--t-surface-sunken)',
        },
        zinc: {
          50:  'var(--t-text-primary)',
          100: 'var(--t-text-secondary)',
          200: 'var(--t-text-muted)',
          300: 'var(--t-border-strong)',
          400: 'var(--t-text-muted)',
          500: 'var(--t-text-secondary)',
          600: 'var(--t-surface-raised)',
          700: 'var(--t-surface-raised)',
          800: 'var(--t-surface)',
          900: 'var(--t-bg)',
          950: 'var(--t-surface-sunken)',
        },

        /* NOTE: red, yellow, amber, blue, purple, pink are NOT mapped.
           They retain their Tailwind defaults and will be migrated to
           semantic status tokens in Phase 3. */
      },

      // ===== TYPOGRAPHY =====
      fontFamily: {
        display: ['Space Grotesk', 'IBM Plex Sans', 'sans-serif'],
        sans:    ['IBM Plex Sans', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono:    ['IBM Plex Mono', 'JetBrains Mono', 'monospace'],
      },
      fontSize: {
        tiny:    ['11px', { lineHeight: '1.4' }],
        small:   ['13px', { lineHeight: '1.4' }],
        body:    ['15px', { lineHeight: '1.5' }],
        h3:      ['18px', { lineHeight: '1.4' }],
        h2:      ['22px', { lineHeight: '1.2' }],
        h1:      ['28px', { lineHeight: '1.2' }],
        display: ['40px', { lineHeight: '1.1' }],
      },

      // ===== SHADOWS =====
      boxShadow: {
        sm: 'var(--t-shadow-sm)',
        DEFAULT: 'var(--t-shadow-md)',
        md: 'var(--t-shadow-md)',
        lg: 'var(--t-shadow-lg)',
      },

      // ===== ANIMATIONS (preserved from previous config) =====
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up':   { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
        'slide-in-right': { from: { transform: 'translateX(100%)', opacity: '0' }, to: { transform: 'translateX(0)', opacity: '1' } },
        'fade-in':        { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up':   'accordion-up 0.2s ease-out',
        'slide-in-right': 'slide-in-right 0.3s ease-out',
        'fade-in':        'fade-in 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
