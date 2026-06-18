# Design system — inventory

This is the narrative, designer-facing companion to inventory's design tokens. It
explains **how** to use the tokens — their intent, tiers, and pairings — so an
external designer can compose inventory's UI without guessing.

The **canonical values** live in `src/frontend/styles/theme.css` (every token name
and value cited here is defined there) and `src/frontend/styles/global.css` (base
element styles only — no custom properties). When this doc and the CSS disagree,
**the CSS wins — fix the doc.**

There is no Tailwind. The stack is React 19 + TanStack, styled with CSS Modules
(`*.module.css`) that consume tokens via `var(--token)`. Colors are OKLCH, authored
as `light-dark()` pairs so light and dark themes resolve automatically.

## Principles

1. **Three token tiers.** Tokens flow in one direction:
   - **Primitive** (`--palette-*`) — raw palette hues plus their tints. Never used
     directly by components; they exist only to be aliased.
   - **Semantic** — purpose-named tokens (`--color-bg`, `--color-type-character`,
     `--status-info-bg`, …), mostly aliasing a primitive. This is the layer
     components reach for.
   - **Component** — tokens scoped to one UI surface (`--forge-*`, `--thumb-*`).
   Non-color scales (type, spacing, radius, shadow) sit alongside these.
2. **Dual theme via `light-dark()`.** Every color token is a
   `light-dark(<light>, <dark>)` pair. The theme follows the OS
   (`color-scheme: light dark` in `global.css`); there is no runtime switcher.
   A `:root` reader sees both branches at once.
3. **OKLCH everywhere.** Colors are authored as `oklch(L C H)` (or
   `oklch(L C H / alpha)`), so lightness and chroma stay perceptually even across
   the light/dark pair. The brand hue band is roughly **250–308**.
4. **No hardcoded colors.** Components never inline a hex/rgb/oklch value. If a
   color is missing, **add or extend a token** in `theme.css` rather than
   hardcoding in a `.module.css`.

## Color system

### Primitive palette (`--palette-*`)

Raw hues. Most ship a base color plus a `-bg` tint (~15% alpha fill) and some a
`-border` tint (30–50% alpha). Never consume these directly — use the semantic
alias instead.

| Primitive | Hue | Variants present |
|-|-|-|
| `--palette-blue` | 250 | `--palette-blue-bg`, `--palette-blue-border` |
| `--palette-purple` | 300 | `--palette-purple-bg`, `--palette-purple-border` |
| `--palette-green` | 145 | `--palette-green-bg`, `--palette-green-border` |
| `--palette-orange` | 55 | `--palette-orange-bg` |
| `--palette-amber` | 75 | `--palette-amber-bg`, `--palette-amber-border` |
| `--palette-red` | 25 | `--palette-red-bg` |

### Core surfaces & text

| Token | Role |
|-|-|
| `--color-bg` | page background (also `--gradient-brand`, see below) |
| `--color-surface` | default card / panel surface |
| `--color-surface-elevated` | raised surface (menus, popovers) |
| `--color-text` | primary text |
| `--color-text-muted` | secondary / metadata text |
| `--color-border` | default hairline border |
| `--color-primary` | primary brand color (actions, focus) |
| `--color-primary-hover` | primary hover state |
| `--color-error` | error text/icon — aliases `--palette-red` |
| `--color-success` | success text/icon (green, hue 145) |

### Brand gradient

| Token | Role |
|-|-|
| `--gradient-brand` | app background — aliases `--color-bg` (solid, matches app style) |
| `--brand-gradient-start` | violet gradient stop (hue 277) for brand fills/buttons |
| `--brand-gradient-end` | indigo gradient stop (hue 308) |
| `--gradient-player` | 135° violet→indigo glass gradient for the media player surface |

Text placed on brand/glass surfaces uses the on-brand text ramp:
`--text-on-brand-strong`, `--text-on-brand-muted`, `--text-on-brand-subtle`.

### Glass surfaces & borders

inventory uses translucent glass over the brand background. Pair a glass surface
with a glass border and a per-component `backdrop-filter: blur(...)`.

| Token | Role |
|-|-|
| `--surface-glass` | base glass fill (white at ~12%) |
| `--surface-glass-strong` | elevated glass |
| `--surface-glass-intense` | most prominent glass (floating) |
| `--surface-glass-background` | secondary glass panel |
| `--surface-code-bg` | inline / block code background |
| `--border-glass` | default glass border |
| `--border-glass-strong` | emphatic glass border |

Chips reuse this language via `--chip-bg`, `--chip-border`, `--chip-text`.

### Semantic role colors (membership badges)

Each role aliases a primitive with its `-bg` and `-border` variants.

| Role | Base | Aliases |
|-|-|-|
| `--color-role-owner` | blue | `--palette-blue` (+ `-bg`, `-border`) |
| `--color-role-admin` | purple | `--palette-purple` (+ `-bg`, `-border`) |
| `--color-role-member` | green | `--palette-green` (+ `-bg`, `-border`) |

### Asset-type colors

Each asset type aliases a primitive plus its `-bg` tint.

| Type | Base | Aliases |
|-|-|-|
| `--color-type-character` | blue | `--palette-blue` (+ `--color-type-character-bg`) |
| `--color-type-item` | purple | `--palette-purple` (+ `--color-type-item-bg`) |
| `--color-type-scene` | green | `--palette-green` (+ `--color-type-scene-bg`) |
| `--color-type-composite` | orange | `--palette-orange` (+ `--color-type-composite-bg`) |

### Status colors

**Job / process status** — each has a base color and a ~10% `-bg` tint:

| Status | Base alias | Tint |
|-|-|-|
| `--color-status-pending` | `--color-text-muted` | `--color-status-pending-bg` |
| `--color-status-processing` | `--color-primary` | `--color-status-processing-bg` |
| `--color-status-completed` | `--color-success` | `--color-status-completed-bg` |
| `--color-status-failed` | `--color-error` | `--color-status-failed-bg` |

**Status pills** — self-contained `bg` / `border` / `text` trios for external-state
banners:

| Pill | Tokens |
|-|-|
| Info | `--status-info-bg`, `--status-info-border`, `--status-info-text` (hue ~230) |
| Warning | `--status-warning-bg`, `--status-warning-border`, `--status-warning-text` (amber, hue 75–95) |

### Accent colors

| Accent | Tokens |
|-|-|
| Star / favorite | `--color-star` (amber), `--color-star-bg`, `--color-star-border` |
| Danger | `--color-danger` (red), `--color-danger-bg` |

### Buttons & scrollbars

Buttons ship full recipes: primary (`--button-primary-bg` gradient,
`--button-primary-bg-hover`, `--button-primary-text`, `--button-primary-border`,
`--button-primary-shadow`, `--button-primary-shadow-hover`) and ghost
(`--button-ghost-bg`, `--button-ghost-bg-hover`, `--button-ghost-border`,
`--button-ghost-text`). Scrollbars use `--scroll-track`, `--scroll-thumb`,
`--scroll-thumb-hover` where custom scrollbars are needed (native is the default).

## Typography

System font stack (set in `global.css`); there is no custom webfont. The size
scale is one ramp of `rem` values; px equivalents are noted in `theme.css`.

| Token | rem | px | Usage |
|-|-|-|-|
| `--font-size-display` | 2rem | 32 | page titles |
| `--font-size-h2` | 1.5rem | 24 | modal titles |
| `--font-size-h3` | 1.25rem | 20 | section titles |
| `--font-size-body` | 1rem | 16 | UI text |
| `--font-size-body-sm` | 0.9375rem | 15 | UI text alt |
| `--font-size-small` | 0.875rem | 14 | metadata |
| `--font-size-small-sm` | 0.8125rem | 13 | labels |
| `--font-size-micro` | 0.75rem | 12 | badges, timestamps |
| `--font-size-micro-sm` | 0.6875rem | 11 | small labels |

## Spacing & layout

| Token | Value | Usage |
|-|-|-|
| `--header-height` | 90px | fixed app header height |
| `--layout-gap` | 20px | gap between layout regions |
| `--panel-spacing` | 1.5rem | panel padding (default) |
| `--panel-spacing-sm` | 1rem | panel padding (compact) |

Thumbnail sizing scale:

| Token | Value |
|-|-|
| `--thumb-size-lg` | 150px |
| `--thumb-size-md` | 100px |
| `--thumb-size-sm` | 75px |
| `--thumb-size-xs` | 48px |

## Shape — radius

| Token | Value |
|-|-|
| `--radius-xs` | 4px |
| `--radius-sm` | 6px |
| `--radius-md` | 8px |
| `--radius-lg` | 12px |
| `--radius-xl` | 16px |
| `--radius-2xl` | 20px |
| `--radius-full` | 9999px |

Thumbnails have their own corner tokens: `--thumb-radius` (10px) and
`--thumb-radius-sm` (6px).

## Elevation — shadows & focus

Shadows encode depth and direction; pick by the surface's role.

| Token | Recipe | Use for |
|-|-|-|
| `--shadow-header` | `0 12px 24px` | sticky header / top chrome |
| `--shadow-elevated` | `0 24px 40px` | cards, popovers, menus |
| `--shadow-floating` | `0 30px 50px` | dialogs, floating panels |
| `--shadow-player` | `0 -12px 24px` (upward) | bottom-anchored media player |

`--focus-ring` (`0 0 0 3px`, primary hue at low alpha) is the standard
`:focus-visible` ring for interactive controls.

## Component tokens

These are scoped to a single surface. Don't reuse them outside their component;
reach for the semantic layer instead.

### Forge tray (`--forge-*`)

The glossy-glass generation bar. Bar shell: `--forge-bar-bg` (vertical glass
gradient), `--forge-bar-border`, `--forge-bar-border-inner`, `--forge-bar-shadow`.
Input: `--forge-input-bg`, `--forge-input-border`, `--forge-input-focus-glow`.
Action button: `--forge-button-bg`, `--forge-button-border`, `--forge-button-shadow`,
`--forge-button-hover-bg`. Slots: `--forge-slot-size` (aliases `--thumb-size-sm`),
`--forge-slot-radius` (aliases `--thumb-radius-sm`), `--forge-slot-border`
(aliases `--border-glass`), `--forge-slot-bg`.

### Thumbnail action buttons (`--thumb-action-*`)

Small overlay buttons on thumbnails: `--thumb-action-size` (24px),
`--thumb-action-size-sm` (18px), `--thumb-action-bg`, `--thumb-action-bg-hover`,
`--thumb-action-shadow`, `--thumb-action-border`.

### Selection badge (`--thumb-badge-*`)

The selection count badge: `--thumb-badge-size` (20px),
`--thumb-badge-bg` (aliases `--color-primary`), `--thumb-badge-shadow`.

## Consuming tokens

Tokens are plain CSS custom properties read with `var(--token)` inside a CSS
Module. There is no Tailwind, no theme provider, and no JS color objects.

```css
/* AssetCard.module.css */
.card {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-elevated);
}

.characterBadge {
  color: var(--color-type-character);
  background: var(--color-type-character-bg);
  border-radius: var(--radius-full);
  font-size: var(--font-size-micro);
}
```

PostCSS (postcss-preset-env stage 2 + the `light-dark()` polyfill, see
`postcss.config.js`) compiles OKLCH and `light-dark()` for browser support; the
light/dark branch is chosen automatically from `prefers-color-scheme`.

**The rule:** never hardcode a color in component CSS. If you need a color the
system doesn't expose, add a semantic token (aliasing a primitive where possible)
to `theme.css`, then consume it.

## For designers

**`src/frontend/styles/theme.css` is the source of truth.** Copy token names from
this guide and from that file when proposing UI.

The tokens are also mirrored to **DTCG JSON under `design/tokens/`** for tooling
handoff (Figma, Claude Design, and similar) — a generated, read-only artifact
produced by the companion token-snapshot tooling (`pnpm tokens:snapshot`). Once
that mirror is present, tools may read the JSON, but `theme.css` still wins: when
the JSON and the CSS disagree, regenerate from the CSS.

Practical guidance when proposing UI:

- Map every color to a **semantic** token, not a `--palette-*` primitive.
- Reuse existing `--surface-*`, `--color-*`, `--button-*`, and `--chip-*` families
  before inventing a new one.
- Respect the dual-theme contract: anything you specify must read correctly in both
  light and dark, because every token is a `light-dark()` pair.
- Keep type, spacing, radius, and shadow on the published scales above — no one-off
  values.
