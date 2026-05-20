# Phase 1 Token Map — old → canonical

Reference for Phase 2 migration. Old variables are bridged in
`/app/packages/design-system/tokens/deprecated.css` and continue to work,
but new code MUST use the canonical names on the right.

## Legacy DEV OS namespace

| Old | New canonical | Notes |
|-----|---------------|-------|
| `--background` | `--t-bg` | substrate |
| `--surface` | `--t-surface` | card surface |
| `--surface-hover` | `--t-surface-raised` | hover state of card |
| `--surface-active` | `--t-surface-raised` | active state |
| `--border` | `--t-border-default` | |
| `--border-hover` | `--t-border-strong` | |
| `--border-active` | `--t-border-strong` | |
| `--text-primary` | `--t-text-primary` | |
| `--text-secondary` | `--t-text-secondary` | |
| `--text-muted` | `--t-text-muted` | |
| `--status-success` | `--t-success` | now olive-shifted, NOT identical to signal |
| `--status-warning` | `--t-warning` | now muted ochre, not amber |
| `--status-error` | `--t-danger` | now restrained oxide, not red-700 |

## Tailwind HSL namespace (shadcn-style)

| Old (HSL triple) | New (hex) | Notes |
|------------------|-----------|-------|
| `--background` | `--t-bg` | hex now, drop hsl() wrap |
| `--foreground` | `--t-text-primary` | |
| `--card` | `--t-surface` | |
| `--popover` | `--t-surface-raised` | |
| `--muted` | `--t-surface-raised` | |
| `--muted-foreground` | `--t-text-secondary` | |
| `--input` | `--t-surface` | |
| `--ring` | `--t-signal` | |
| `--primary` | `--t-signal` | now sage, not mint #2FE6A6 |
| `--primary-foreground` | `--t-signal-ink` | |
| `--secondary` | `--t-surface-raised` | |
| `--accent` | `--t-signal-bg-soft` | |
| `--destructive` | `--t-danger` | |
| `--border` | `--t-border-default` | |
| `--trust` | `--t-signal` | |
| `--trust-2` | `--t-info` | |
| `--risk` | `--t-warning` | |
| `--warning` | `--t-warning` | |
| `--success` | `--t-success` | now separate from signal |
| `--info` | `--t-info` | |

## Token v3 namespace

| Old | New canonical |
|-----|---------------|
| `--token-bg` | `--t-bg` |
| `--token-surface` | `--t-surface` |
| `--token-surface-secondary` | `--t-surface-raised` |
| `--token-surface-elevated` | `--t-surface-raised` |
| `--token-text-primary` | `--t-text-primary` |
| `--token-text-secondary` | `--t-text-secondary` |
| `--token-text-muted` | `--t-text-muted` |
| `--token-primary` | `--t-signal` |
| `--token-primary-hover` | `--t-signal-hover` |
| `--token-primary-active` | `--t-signal-active` |
| `--token-primary-ink` | `--t-signal-ink` |
| `--token-primary-accent` | `--t-signal` |
| `--token-primary-accent-soft` | `--t-signal-bg-soft` |
| `--token-success` | `--t-success` (NEW: separated from primary) |
| `--token-warning` | `--t-warning` |
| `--token-danger` | `--t-danger` |
| `--token-info` | `--t-info` |
| `--token-border` | `--t-border-default` |
| `--token-border-strong` | `--t-border-strong` |
| `--token-divider` | `--t-border-subtle` |
| `--token-card-bg` | `--t-surface` |
| `--token-card-hover` | `--t-surface-raised` |
| `--token-shadow-card` | `--t-shadow-md` |
| `--token-shadow-hover` | `--t-shadow-lg` |

## Admin scope namespace

| Old | New canonical |
|-----|---------------|
| `--bg-admin` | `--t-bg` |
| `--bg-admin-2` | `--t-surface-raised` |
| `--surface-admin-1` | `--t-surface` |
| `--surface-admin-2` | `--t-surface-raised` |
| `--surface-admin-3` | `--t-surface-raised` |
| `--border-admin` | `--t-border-default` |
| `--border-admin-strong` | `--t-border-strong` |
| `--text-admin` | `--t-text-primary` |
| `--text-admin-secondary` | `--t-text-secondary` |
| `--text-admin-muted` | `--t-text-muted` |
| `--shadow-elev-1` | `--t-shadow-md` |
| `--shadow-elev-2` | `--t-shadow-lg` |

## Mobile theme (`T.*` keys)

| Old `T.key` | Canonical (DARK) | Canonical (LIGHT) |
|------------|------------------|--------------------|
| `T.bg`              | `#0F0F11` | `#FAF8F4` |
| `T.surface`         | `#16161A` | `#FFFFFF` |
| `T.surface2`        | `#1E1E22` | `#F1EEE7` |
| `T.surface3`        | `#1E1E22` | `#E9E4DA` |
| `T.text`            | `#EBEAE5` | `#1A1714` |
| `T.textSecondary`   | `#9C9B95` | `#5C544D` |
| `T.textMuted`       | `#73716C` | `#8C8278` |
| `T.primary`         | `#8C9B90` (sage) | `#4A6B5C` (deep sage) |
| `T.primaryAccent`   | `#8C9B90` | `#4A6B5C` |
| `T.success`         | `#7E9684` (olive sage) | `#3E5F4F` |
| `T.warning` `T.risk`| `#C9A961` (ochre) | `#8A6925` (bronze) |
| `T.danger`          | `#B86A6A` (oxide) | `#8E3E3E` (deep oxide) |
| `T.info`            | `#788491` (slate-info) | `#4B6074` |
| `T.role`            | → warning (alias) | → warning (alias) |

## Tailwind class overrides (auto-mapped, no code change needed)

These Tailwind utilities continue to compile but now render the canonical
sage/graphite palette via Tailwind's color extension. Will be removed
in Phase 3 via codemod.

| Old class | Compiles to |
|-----------|-------------|
| `bg-emerald-{50..900}` | `var(--t-signal-*)` (sage) |
| `text-emerald-{50..900}` | sage variants |
| `bg-teal-{50..900}` | sage |
| `bg-slate-{50..950}` | graphite substrate variants |
| `bg-gray-{50..950}` | graphite |
| `bg-neutral-{50..950}` | graphite |
| `bg-zinc-{50..950}` | graphite |

**NOT mapped** (retain Tailwind defaults — semantic meaning):
`red`, `yellow`, `amber`, `blue`, `purple`, `pink`. Migration plan: pages
using these for status/expression will be reviewed and rewritten in Phase 3.
