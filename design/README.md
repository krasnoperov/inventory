# design/

Machine-readable mirror of the Inventory app's design system. Intended as a handoff surface for [claude.ai/design](https://claude.ai), Figma, and any other tool that speaks W3C [DTCG](https://www.designtokens.org/tr/2025.10/format/) tokens.

## Source of truth

The CSS is canonical. Inventory keeps **all** design tokens in a single file:

- `src/frontend/styles/theme.css` — the entire token set: primitive palette, semantic colours/surfaces/borders/text, gradients, status pills, buttons, scrollbars, shadows, radius, the type scale, layout spacing, thumbnail sizing, and the component-scoped forge / thumbnail tokens. Dual-theme values are authored with the `light-dark(light, dark)` CSS function.

`src/frontend/styles/global.css` carries resets and base styles only — it declares **no** custom properties, so it is not a token source.

## What's in this folder

- `tokens/core.tokens.json` — primitive palette (`--palette-*`) plus non-colour scales: radius, type scale, layout spacing, panel spacing, thumbnail sizing, shadows, focus ring
- `tokens/semantic.tokens.json` — purpose-named tokens: colours, surfaces, borders, text-on-brand, gradients, chips, status pills, buttons, scrollbars
- `tokens/component.tokens.json` — component-scoped tokens: forge tray, thumbnail action buttons, selection badge
- `tokens/_excluded.json` — sidecar listing canonical CSS tokens deliberately omitted from the DTCG snapshot, each with a `reason` and (where useful) a `recommendation` for graduating it in

All four files are **generated** from `theme.css` by `scripts/snapshot-design-tokens.mjs`. Do not edit them by hand.

Each declaration is routed to one of the three tiers by CSS-variable prefix: `--palette-*` / scale prefixes → core, `--forge-*` / `--thumb-action-*` / `--thumb-badge-*` → component, everything else → semantic.

## Why a token gets excluded

DTCG 2025.10 requires every token's `$value` to match the structural shape of its `$type`. The snapshot resolves `light-dark(L, D)` by lifting the **light** branch into `$value` and preserving the pair in the `com.inventory.lightDark` extension — so gradients, borders, and single-layer shadows whose colours use `light-dark()` still serialize cleanly.

A token is excluded only when its value uses a CSS construct with no DTCG analog and cannot be cleanly structured — e.g. multi-layer box-shadows that include an `inset` layer, `color-mix(...)`, `clamp(...)`, `calc(...)`, or gradients with non-uniform stop positions. Such tokens stay authoritative in `theme.css` and surface in `tokens/_excluded.json`.

Today only the two multi-layer forge shadows (`--forge-bar-shadow`, `--forge-button-shadow`) are excluded, both because they include an `inset` highlight layer.

## Round-trip

```bash
pnpm run tokens:snapshot         # regenerate after editing theme.css
pnpm run tokens:snapshot:check   # CI guard — fails on drift
pnpm run tokens:roundtrip        # CI guard — re-emit CSS from DTCG, re-snapshot, diff
```

The pipeline is **CSS → DTCG → CSS → DTCG**, and the second DTCG must equal the first. That contract is what `tokens:roundtrip` enforces — it proves the snapshot + sidecar pair is a complete, lossless mirror of the canonical `:root` block. Both guards are chained into `pnpm lint:tokens` (run as part of `pnpm lint`).

Each token entry carries vendor extensions that make this work:

- `com.inventory.cssVar` — the original CSS custom-property name
- `com.inventory.sourceFile` — the canonical file the token lives in (always `theme.css`)
- `com.inventory.cssValue` — the original whitespace-collapsed CSS expression, used by the inverse generator
- `com.inventory.lightDark` — `[light, dark]` pair for tokens declared via `light-dark(a, b)`. DTCG consumers that ignore extensions render the light branch (which is also the `$value`); tools that understand the extension round-trip both.
- `com.inventory.gradientDirection` — `linear-gradient` direction (e.g. `135deg`) preserved alongside the DTCG `gradient` `$value` (which is just the stops array per spec)
