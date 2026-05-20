# Design System (Phase 1)

**Status**: Substrate locked, May 2026. Phase 1 complete.

**Philosophy**: One operational OS, rendered in two luminance environments.
NOT "dark = operational, light = editorial". The light mode IS the dark
mode in different light. Same anatomy, same density, same typography —
only substrate, contrast, elevation intensity, and signal saturation change.

## Folder map

```
packages/design-system/
├── tokens/
│   ├── palette.js         ← single source of truth for hex values
│   ├── palette.ts         ← typed re-export of palette.js
│   ├── palette.css        ← CSS variables (--t-*) — MUST stay in sync with palette.js
│   ├── semantic.css       ← role-based aliases (--ds-*)
│   ├── spacing.css        ← 4pt grid + radius scale + component dimensions
│   ├── typography.css     ← font families + type scale
│   ├── deprecated.css     ← Phase 2 bridge for 4 legacy namespaces
│   ├── spacing.ts         ← JS twin of spacing.css
│   └── index.css          ← single import entry for web
├── theme/
│   ├── ThemeEngine.ts     ← platform-agnostic state machine
│   ├── adapter.web.ts     ← localStorage + DOM
│   └── adapter.native.ts  ← AsyncStorage + Appearance
├── typography/index.ts
├── motion/
│   ├── index.ts
│   └── motion.css
├── primitives/            ← Phase 2: shared component primitives
└── index.ts               ← public surface
```

## Architectural invariants (DO NOT VIOLATE)

1. **Single source of truth for hex values**: `tokens/palette.js`. Every CSS file
   that declares a hex MUST also live in `tokens/`. Page CSS, component
   CSS, and JSX inline styles MUST NOT contain `#hex` literals.
2. **signal ≠ success**. Signal is operational gravity (active state, CTA,
   focus). Success is a status. They look adjacent but never identical.
3. **No marketing/brand expressive palettes**. Emerald, teal, neon mint,
   violet, bronze, parchment — all rejected. Sage + graphite + warm paper
   is the entire visual identity.
4. **Status colors are de-saturated**, never neon. Warning is muted ochre,
   danger is restrained oxide, info is slate-information.
5. **Structural tokens are luminance-invariant**. Spacing, radius,
   typography, density, animation timing — identical in dark and light.

## Token naming convention

| Layer | Prefix | Example | Usage |
|-------|--------|---------|-------|
| Raw values | `--t-*` | `--t-bg`, `--t-signal` | direct in CSS, mobile bridge |
| Semantic aliases | `--ds-*` | `--ds-action`, `--ds-text` | role-based naming for pages |
| Tailwind utility | `bg-*`, `text-*` | `bg-app`, `text-signal` | JSX class usage |
| Legacy (Phase 2 only) | various | `--background`, `--token-bg` | DO NOT use in new code |

## How to add a new token

1. Edit `tokens/palette.js` — add hex values for both `DARK` and `LIGHT`.
2. Edit `tokens/palette.css` — add `--t-newname` to both `.theme-dark`/`.dark`
   block and `.theme-light`/`.light` block (with proper dark/light values).
3. Edit `tokens/semantic.css` — add semantic alias `--ds-foo: var(--t-newname);`
   if the token has a role-based meaning.
4. Optionally extend `web/tailwind.config.js` with a new utility.
5. Run `bash audit/scan_tokens.sh` to verify both halves are in sync.

## How to change an existing token

1. Edit `tokens/palette.js` AND `tokens/palette.css`.
2. Run `bash audit/scan_tokens.sh` to verify sync.
3. Visual diff: take dark + light screenshots of landing, auth, admin
   dashboard, client dashboard, developer dashboard — compare with previous.

## Mobile note

Metro can't see `/app/packages/` (project root is `/app/frontend/`). Mobile
imports a MIRROR at `/app/frontend/src/design-system/palette.{js,ts}` which
MUST be byte-identical to the canonical files. `audit/scan_tokens.sh`
diffs them and fails CI on drift.

To resync: `cp /app/packages/design-system/tokens/palette.js /app/frontend/src/design-system/palette.js`.

## Phase 2 (next)

- Mount `<ThemeToggle>` in `ClientLayout`, `DeveloperLayout`, `TesterLayout`.
- Add Settings → Appearance theme toggle in mobile.
- Migrate the 9 token-v3 web pages to read `--ds-*` semantic aliases.

## Phase 3 (eventually)

- Codemod 53+ web pages from `bg-emerald-*` etc. to `bg-signal-*` / `bg-app-elevated`.
- Rewrite `app/admin/execution-console.tsx` (mobile) — has full local palette.
- Delete `tokens/deprecated.css` once no legacy namespace usage remains.
- Delete `frontend/src/design-tokens.ts` once `app/index.tsx` and
  `gravity-cta.tsx` are rewritten on `T`.
- Align mobile radius scale (10/14/18) with web's 4/8/12/16/24.
