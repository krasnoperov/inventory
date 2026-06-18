# Make Effects component conventions

These are real React components from the Make Effects app, compiled as-is. They
are **token-styled** via CSS custom properties — there are no utility classes and
no style props. Style your own layout glue with the same `var(--*)` tokens.

## Setup
- No provider/wrapper is required for these components to be styled — the design
  tokens live in `styles.css` (already loaded) and resolve globally.
- Light/dark is automatic: every color token is a CSS `light-dark()` pair driven
  by `color-scheme`. Don't hand-pick light vs dark values.
- **Surface gotcha:** a few controls are "glass" — white text on translucent
  white, meant to sit on the brand gradient, NOT a bare white page. `Pagination`
  is the main one. Place such controls on a branded surface:
  `background: linear-gradient(135deg, var(--brand-gradient-start), var(--brand-gradient-end))`.
  `AppHeader` / `WorkspaceChrome` / forms are light chrome and read fine on any background.

## Token vocabulary (define nothing new — reuse these)
Read `styles.css` for the full set. The families you'll reach for:

|-|-|
| Surfaces / text | `--color-bg` `--color-surface` `--color-surface-elevated` `--color-text` `--color-text-muted` `--color-border` |
| Brand | `--gradient-brand` `--brand-gradient-start` `--brand-gradient-end` `--button-primary-bg` |
| Semantic | `--color-primary` `--color-success` `--color-error` `--color-danger` `--color-star` |
| Asset types | `--color-type-character|item|scene|composite` (+ `-bg`) |
| Roles | `--color-role-owner|admin|member` (+ `-bg` `-border`) |
| Job status | `--color-status-pending|processing|completed|failed` (+ `-bg`) |
| Glass / ghost | `--surface-glass` `--chip-bg` `--chip-text` `--button-ghost-bg` `--button-ghost-text` `--button-ghost-border` |
| Type scale | `--font-size-display|h2|h3|body|body-sm|small|small-sm|micro` |
| Radius | `--radius-xs|sm|md|lg|xl|2xl|full` |
| Elevation | `--shadow-header|elevated|floating|player` `--focus-ring` |
| Layout | `--header-height` `--layout-gap` `--panel-spacing` |

## Build snippet
```tsx
import { AppHeader, HeaderNav } from '<this DS>';

<AppHeader
  leftSlot={<strong style={{ fontSize: 'var(--font-size-h3)' }}>Make Effects</strong>}
  centerSlot={<span style={{ color: 'var(--color-text-muted)' }}>My Space</span>}
  rightSlot={<HeaderNav userName="Ada Lovelace" userEmail="ada@example.com" />}
/>
```

Read each component's `.prompt.md` and `.d.ts` for its exact props before composing.
