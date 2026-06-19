# design-sync notes — makefx (Make Effects)

## Repo shape
- This is a full-stack TanStack Start app, NOT a packaged component library. No `main`/`module`/`exports` in package.json, no component `dist/` entry.
- A library barrel is hand-authored at `.design-sync/ds-entry.tsx` exporting the synced components; pass it via `--entry .design-sync/ds-entry.tsx`.
- Shape pinned to `package` (no Storybook; Ladle is used for the in-repo style-reference gallery but design-sync doesn't read it).

## Scope (first sync)
- Scoped to the 10 components that have Ladle stories + isolation groundwork:
  Pagination, TopLoadingBar, HeaderNav, AppHeader, WorkspaceChrome, Thumbnail,
  AssetCard, forms/{ErrorMessage, FormTitle, FormContainer}.
- These were chosen because they render standalone (no useSpaceWebSocket hook calls; only types/pure helpers).

## Tokens / CSS
- Token source = `src/frontend/styles/theme.css` (cssEntry). Uses `light-dark()` + oklch; NO PostCSS runs in the esbuild path, so it ships raw — fine for the design tool's modern Chromium.
- Component styles are CSS Modules, bundled by esbuild into `_ds_bundle.css`.

## Re-sync risks
- ds-entry.tsx is hand-maintained: adding/removing a synced component means editing it.
- theme.css ships without PostCSS transforms; if the design tool's browser ever lacks light-dark()/oklch, tokens won't resolve.

## Verify-loop learnings (first sync, 2026-06)
- **Playwright/chromium:** repo playwright (1.59.1) pins chromium build 1217 which isn't cached. Installed `playwright@1.58.2` into `.ds-sync/` (pins build 1208, which IS cached) so validate's render check uses a cached browser with no download. Network download of browsers appears blocked in this env.
- **Discovery:** `--entry .design-sync/ds-entry.tsx` (a hand-authored barrel) yields `[ZERO_MATCH]` because discovery is `.d.ts`-export-based. Fix = list every component in `cfg.componentSrcMap` with its src path (already in config).
- **GRID_OVERFLOW:** Pagination, Thumbnail, FormContainer render wider than a grid cell → `cfg.overrides.<Name>.cardMode = "column"` (in config).
- **Surface gotcha (important for previews):** Pagination's non-active buttons are white-glass (`--button-ghost-text` = white) meant for the app's branded gradient surface — they're invisible on a bare white preview card. `previews/Pagination.tsx` wraps each story in a `linear-gradient(135deg, var(--brand-gradient-start), var(--brand-gradient-end))` surface. AppHeader/WorkspaceChrome/forms/Thumbnail render fine on white.
- **Completed media:** Thumbnail/AssetCard completed-image variants resolve to `/api/images/…` which the design tool can't serve (no mock there, unlike the in-repo style-reference capture). Previews use loading/failed/audio states which render without a media server.

## Re-sync risks
- `ds-entry.tsx` + `componentSrcMap` are hand-maintained: adding/removing a synced component means editing BOTH.
- Preview data objects (Variant/Asset) are inlined in `previews/*.tsx`; if those types gain required fields, the inline objects may need updating.
- theme.css ships without PostCSS; relies on the design tool's browser supporting `light-dark()` + oklch.

## CRITICAL: ship global.css base, not just tokens (fixed after first upload)
- First upload set cssEntry=theme.css (tokens only). Designs in the tool then
  rendered UNSTYLED — browser-default serif, no reset — because global.css
  (font-family, `color-scheme: light dark`, box-sizing reset, button/a/input
  resets) never reached the styles.css closure. Preview cards masked it (they
  carry their own base); designs the agent builds get ONLY the styles.css closure.
- Fix: cssEntry = `.design-sync/ds-styles.css` = global.css + theme.css concatenated.
  REGENERATE on every re-sync BEFORE building:
  `{ cat src/frontend/styles/global.css; echo; cat src/frontend/styles/theme.css; } > .design-sync/ds-styles.css`
  (the file carries a header comment with this command).
- Theme default: "follow system" — left `color-scheme: light dark`; the design
  tool's own light/dark setting decides. Site is dark (system dark); tool may show light.

## Dark default + per-preview surfaces (user wanted it to match the dark site)
- ds-styles.css appends `:root { color-scheme: dark }` so the whole DS renders dark
  (the app's primary look). Regenerate command in the file header includes this line.
- WorkspaceChrome preview = rich "SpaceHeader" (space name + OWNER badge + counts +
  Live pill + view/action icons) matching the production header — bare WorkspaceChrome
  looked empty because the page fills its slots.
- Bare-text previews (FormTitle, HeaderNav, ErrorMessage) wrap in a dark
  `var(--color-bg)` surface so they don't render light-on-white in the DS pane.
- ForgeTray DROPPED: it's a stateful, store/config-driven docked tray; standalone it
  collapses to its bottom toolbar (no prompt/options row). Not design-system material.
  To retry: seed its zustand stores + unpick getMediaGroup/getForgeMediaModeConfig gating.
