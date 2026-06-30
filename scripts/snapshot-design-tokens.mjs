#!/usr/bin/env node
// Snapshot the canonical CSS design tokens to W3C DTCG-formatted JSON files
// under design/tokens/. The CSS in src/frontend/styles/ remains the source of
// truth; this script only mirrors it so external tools (Claude Design, Figma,
// Style Dictionary consumers) have a machine-readable surface to read from.
//
// Usage:
//   pnpm run tokens:snapshot           # write design/tokens/*.tokens.json
//   pnpm run tokens:snapshot:check     # fail if files are out of date
//
// Inventory keeps ALL design tokens in a single canonical file,
// src/frontend/styles/theme.css. global.css carries no custom properties.
// Within theme.css the tokens span three conceptual tiers (core primitives /
// scales, semantic, component); this script routes each declaration to the
// matching output file by CSS-variable prefix (see TIER_PREFIXES).
//
// The light-dark() CSS function is preserved through a vendor extension:
//   { "$value": "<light-branch>", "$extensions": { "com.inventory.lightDark": ["<light>", "<dark>"] } }
// DTCG consumers that ignore extensions still get a renderable light value.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stylesDir = join(repoRoot, 'src/frontend/styles');
const outDir = join(repoRoot, 'design/tokens');

// Inventory authors every token in theme.css. Each declaration is routed to one
// of three output tiers by CSS-variable prefix. `core` = primitives + non-color
// scales, `component` = surface-scoped tokens, everything else falls through to
// `semantic`. The first matching prefix list wins; order is core, then
// component, then semantic-as-default.
const TIER_PREFIXES = {
  core: [
    '--palette-',
    '--radius-',
    '--shadow-',
    '--focus-ring',
    '--header-height',
    '--layout-gap',
    '--panel-spacing',
    '--thumb-size-',
    '--thumb-radius',
    '--font-size-',
  ],
  component: [
    '--forge-',
    '--thumb-action-',
    '--thumb-badge-',
    '--thumb-video-',
    '--landing-',
    '--terminal-',
    '--canvas-',
  ],
};

function tierFor(cssVar) {
  if (TIER_PREFIXES.core.some((p) => cssVar.startsWith(p))) return 'core';
  if (TIER_PREFIXES.component.some((p) => cssVar.startsWith(p))) return 'component';
  return 'semantic';
}

// Per-token guidance for the excluded sidecar. The exclusion itself is
// determined by parser conformance — these notes explain the path forward
// for designers/engineers who want a token to graduate into the DTCG
// snapshot. Keyed by cssVar; absent entries get no recommendation.
const EXCLUSION_RECOMMENDATIONS = {
  // The two forge box-shadows below are the only tokens the conformance check
  // actually rejects today: each is a multi-layer shadow that includes an
  // `inset` keyword layer, and the shadow parser only structures bare
  // `<offset> <offset> <blur> [<spread>] <colour>` layers. Composite gradient /
  // border / single-layer-shadow tokens whose colours use light-dark() DO
  // serialize — the snapshot lifts the light branch and preserves the pair in
  // the com.inventory.lightDark extension (see --button-primary-bg/-shadow,
  // --gradient-player, --forge-bar-bg, etc.).
  '--forge-bar-shadow':
    'Three-layer box-shadow including an `inset` highlight layer. DTCG `shadow` here only structures non-inset `offset offset blur [spread] colour` layers, so the inset layer blocks lifting. Stays authoritative in CSS; if DTCG introspection is needed, split the inset highlight into its own non-inset token or wait for inset-aware shadow lifting.',
  '--forge-button-shadow':
    'Two-layer box-shadow including an `inset` highlight layer. Same path as --forge-bar-shadow: the inset layer has no DTCG-conformant shadow shape here. Stays authoritative in CSS.',
};

// CSS declaration parser. Captures `--name: value;` inside `:root { ... }`.
// Handles multi-line values (light-dark(...) often spans 4 lines). Strips
// comments so they don't fold into a value.
function parseRoot(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const decls = [];

  // Find the first top-level `:root` selector and extract its body using a
  // brace-depth counter. A regex either greedy-eats following rules or trips
  // over inner braces. Subsequent `:root` blocks (e.g. a `@media` override or
  // `[data-theme]` swap) are intentionally ignored — a snapshot mirrors the
  // light-mode default; dark-mode-only single-value swaps live in canonical
  // CSS but don't appear in the DTCG snapshot.
  const rootIdx = stripped.search(/:root\s*\{/);
  if (rootIdx === -1) return decls;
  const openIdx = stripped.indexOf('{', rootIdx);
  let braceDepth = 1;
  let closeIdx = openIdx + 1;
  for (; closeIdx < stripped.length && braceDepth > 0; closeIdx++) {
    const c = stripped[closeIdx];
    if (c === '{') braceDepth++;
    else if (c === '}') braceDepth--;
  }
  const body = stripped.slice(openIdx + 1, closeIdx - 1);

  // Walk the body declaration-by-declaration. Split on top-level `;` (paren-
  // depth aware so `light-dark(a, b);` doesn't fragment), then for each
  // statement keep only the ones whose left side is a CSS custom property.
  // This excludes regular property assignments like `font-family: var(...)`
  // and var() references inside other RHS expressions.
  const statements = splitTopLevel(body, ';');
  const declRe = /^\s*(--[a-zA-Z][a-zA-Z0-9_-]*)\s*:\s*([\s\S]+?)\s*$/;
  for (const stmt of statements) {
    const m = stmt.match(declRe);
    if (!m) continue;
    const cssVar = m[1];
    const value = m[2].replace(/\s+/g, ' ').trim();
    decls.push({ cssVar, value });
  }
  return decls;
}

// Split a string on a single-character separator at the top paren depth.
function splitTopLevel(input, sep) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === sep && depth === 0) {
      out.push(input.slice(start, i));
      start = i + 1;
    }
  }
  if (start < input.length) out.push(input.slice(start));
  return out;
}

// Expand any `light-dark(a, b)` calls in `value` into a [lightForm, darkForm]
// pair. Handles values where light-dark() is the whole expression
// AND values where one or more light-dark() calls are nested inside a larger
// composite (`--gradient-player` puts two of them inside `linear-gradient(...)`).
// Returns null when the value contains no light-dark() at all.
function expandLightDark(value) {
  if (!value.includes('light-dark(')) return null;

  function walk(s, branch) {
    let out = '';
    let i = 0;
    while (i < s.length) {
      const idx = s.indexOf('light-dark(', i);
      if (idx === -1) {
        out += s.slice(i);
        break;
      }
      out += s.slice(i, idx);
      let depth = 1;
      let j = idx + 'light-dark('.length;
      for (; j < s.length && depth > 0; j++) {
        if (s[j] === '(') depth++;
        else if (s[j] === ')') depth--;
      }
      const inner = s.slice(idx + 'light-dark('.length, j - 1);
      const parts = splitTopLevel(inner, ',').map((p) => p.trim());
      const chosen = parts[branch === 'light' ? 0 : 1] ?? parts[0];
      out += walk(chosen, branch);
      i = j;
    }
    return out;
  }

  const light = walk(value, 'light').replace(/\s+/g, ' ').trim();
  const dark = walk(value, 'dark').replace(/\s+/g, ' ').trim();
  return [light, dark];
}

// Detect a single var(--x) alias with no surrounding text. We do NOT alias when
// var() is embedded in a larger expression — that's a composed value, not an
// alias.
function pureVarRef(value) {
  const m = value.match(/^var\(\s*(--[a-z0-9-]+(?:\.\d+)?)\s*\)$/i);
  return m ? m[1] : null;
}

// Inventory uses flat, purpose-named CSS variables with no shared per-file
// prefix to strip. (theme.css is the only source file.)
const PREFIX_STRIP = {
  'theme.css': null,
};

// Group inference. Maps a CSS variable name to a [groupPath, leafName] tuple.
// Rules are tried top-to-bottom; the first match wins. More-specific patterns
// (dimension scales, composite shadows) must precede broader colour catch-alls
// so the correct $type sticks.
const GROUPS = [
  // ---- core: primitive palette (raw hues + tints). ----
  { match: /^--palette-(.+)$/, group: 'palette', leaf: ($1) => kebabToCamel($1), type: 'color' },

  // ---- core: structural / non-colour scales. ----
  { match: /^--radius-(.+)$/, group: 'radius', leaf: ($1) => kebabToCamel($1), type: 'dimension' },
  { match: /^--font-size-(.+)$/, group: 'fontSize', leaf: ($1) => kebabToCamel($1), type: 'dimension' },
  { match: /^--header-height$/, group: 'layout', leaf: () => 'headerHeight', type: 'dimension' },
  { match: /^--layout-gap$/, group: 'layout', leaf: () => 'gap', type: 'dimension' },
  { match: /^--panel-spacing(?:-(.+))?$/, group: 'layout.panelSpacing', leaf: ($1) => $1 ? kebabToCamel($1) : 'default', type: 'dimension' },
  { match: /^--thumb-size-(.+)$/, group: 'thumb.size', leaf: ($1) => kebabToCamel($1), type: 'dimension' },
  { match: /^--thumb-radius(?:-(.+))?$/, group: 'thumb.radius', leaf: ($1) => $1 ? kebabToCamel($1) : 'default', type: 'dimension' },
  // --focus-ring is a spread-only box-shadow (focus outline).
  { match: /^--focus-ring$/, group: '', leaf: () => 'focusRing', type: 'shadow' },
  // theme.css core shadows. Single- and multi-layer box-shadows; the parser's
  // conformance check excludes any whose colour is a light-dark() pair.
  { match: /^--shadow-(.+)$/, group: 'shadow', leaf: ($1) => kebabToCamel($1), type: 'shadow' },

  // ---- semantic: core surfaces & text. ----
  // --color-status-* (job/process status) must precede the broad --color-*
  // rule so it nests under colorStatus.<name> instead of a flat colorStatus*.
  { match: /^--color-status-(\w+)(?:-(.+))?$/, group: ($1) => `colorStatus.${$1}`, leaf: ($1, $2) => $2 ? kebabToCamel($2) : 'base', type: 'color' },
  // --color-role-* / --color-type-* families (badges & indicators).
  { match: /^--color-role-(\w+)(?:-(.+))?$/, group: ($1) => `colorRole.${$1}`, leaf: ($1, $2) => $2 ? kebabToCamel($2) : 'base', type: 'color' },
  { match: /^--color-type-(\w+)(?:-(.+))?$/, group: ($1) => `colorType.${$1}`, leaf: ($1, $2) => $2 ? kebabToCamel($2) : 'base', type: 'color' },
  { match: /^--color-(.+)$/, group: 'color', leaf: ($1) => kebabToCamel($1), type: 'color' },

  // ---- semantic: brand & gradients. ----
  // --brand-gradient-{start,end} are the brand gradient endpoints (colours).
  { match: /^--brand-gradient-(.+)$/, group: 'gradient', leaf: ($1) => `brand${capitalize(kebabToCamel($1))}`, type: 'color' },
  // --gradient-brand aliases a solid colour; --gradient-player is a true
  // linear-gradient. Leave type undefined so inferTypeFromValue decides per
  // token (colour-alias vs gradient).
  { match: /^--gradient-(.+)$/, group: 'gradient', leaf: ($1) => kebabToCamel($1), type: undefined },

  // ---- semantic: text on brand surfaces. ----
  { match: /^--text-on-brand-(.+)$/, group: 'text.onBrand', leaf: ($1) => kebabToCamel($1), type: 'color' },

  // ---- semantic: surfaces & borders. ----
  { match: /^--surface-(.+)$/, group: 'surface', leaf: ($1) => kebabToCamel($1), type: 'color' },
  { match: /^--border-(.+)$/, group: 'border', leaf: ($1) => kebabToCamel($1), type: 'color' },

  // ---- semantic: chips. ----
  { match: /^--chip-(.+)$/, group: 'chip', leaf: ($1) => kebabToCamel($1), type: 'color' },

  // ---- semantic: status pills. ----
  { match: /^--status-(\w+)-(.+)$/, group: ($1) => `status.${$1}`, leaf: ($1, $2) => kebabToCamel($2), type: 'color' },

  // ---- semantic: buttons. Heterogeneous types — -bg may be a gradient,
  // -border a CSS border shorthand, -shadow a shadow, -text a colour. Leave
  // type undefined so inferTypeFromValue classifies per token. ----
  { match: /^--button-(\w+)-(.+)$/, group: ($1) => `button.${$1}`, leaf: ($1, $2) => kebabToCamel($2), type: undefined },

  // ---- semantic: scrollbars. ----
  { match: /^--scroll-(.+)$/, group: 'scroll', leaf: ($1) => kebabToCamel($1), type: 'color' },

  // ---- component: forge tray. Heterogeneous (gradients, borders, shadows,
  // colours, dimension aliases). Type undefined → inferTypeFromValue / alias. ----
  { match: /^--forge-(.+)$/, group: 'forge', leaf: ($1) => kebabToCamel($1), type: undefined },

  // ---- component: thumbnail action buttons & selection badge. ----
  { match: /^--thumb-action-(.+)$/, group: 'thumbAction', leaf: ($1) => kebabToCamel($1), type: undefined },
  { match: /^--thumb-badge-(.+)$/, group: 'thumbBadge', leaf: ($1) => kebabToCamel($1), type: undefined },
  { match: /^--thumb-video-(.+)$/, group: 'thumbVideo', leaf: ($1) => kebabToCamel($1), type: 'color' },

  // ---- component: landing / marketing surfaces. Heterogeneous (colours,
  // shadows, gradients). Type undefined → inferTypeFromValue per token. ----
  { match: /^--landing-(.+)$/, group: 'landing', leaf: ($1) => kebabToCamel($1), type: undefined },

  // ---- component: terminal (fixed dark). Colours + one shadow. ----
  { match: /^--terminal-(.+)$/, group: 'terminal', leaf: ($1) => kebabToCamel($1), type: undefined },

  // ---- component: relations canvas (asset graph). Edge-thread + star colours. ----
  { match: /^--canvas-(.+)$/, group: 'canvas', leaf: ($1) => kebabToCamel($1), type: undefined },
];

function kebabToCamel(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Heuristic type inference from a resolved CSS value. Used as a fallback when
// the GROUPS rule deliberately leaves `type` undefined. Conservative — only
// emits a type when the value pattern is unambiguous.
function inferTypeFromValue(value) {
  const trimmed = value.trim();
  // CSS-length atom: a number with a unit, OR a bare `0` (CSS treats unitless
  // 0 as 0 of any length unit). Used by border + shadow detection because
  // shadow values like `0 4px 12px oklch(...)` and `0 -12px 24px ...` start
  // with the unitless form, and parseDimension already canonicalises bare 0
  // to {value: 0, unit: 'px'}.
  const dim = '-?(?:[\\d.]+(?:px|rem|em|%)|0(?:\\.0+)?)';
  // Border shorthand `<dim> <style> <color>` must precede shadow detection
  // (which would otherwise claim it via the dim+oklch test).
  if (new RegExp(`^${dim}\\s+(?:solid|dotted|dashed|double|none|hidden)\\s+`).test(trimmed)) return 'border';
  // Shadow: starts with `<dim> <dim>` and includes a color() call.
  if (new RegExp(`^${dim}\\s+${dim}`).test(trimmed) && /(?:oklch|rgb|hsl|color)/i.test(trimmed)) return 'shadow';
  if (/^linear-gradient\(/i.test(trimmed)) return 'gradient';
  if (/^(?:light-dark\(\s*)?(?:oklch|hsl|rgb|color|color-mix)\(/i.test(trimmed)) return 'color';
  if (/^[\d.]+(?:px|rem|em|%)$/.test(trimmed)) return 'dimension';
  if (/^[\d.]+(?:ms|s)$/.test(trimmed)) return 'duration';
  if (/^[\d.]+$/.test(trimmed)) return 'number';
  return undefined;
}

function classify(cssVar, value) {
  for (const rule of GROUPS) {
    const m = cssVar.match(rule.match);
    if (!m) continue;
    const groupVal = typeof rule.group === 'function' ? rule.group(...m.slice(1)) : rule.group;
    const leaf = rule.leaf(...m.slice(1));
    let type = rule.type;
    if (type === undefined) type = inferTypeFromValue(value);
    if (type === undefined) type = inferTypeFromName(cssVar);
    return { groupPath: groupVal, leaf, type };
  }
  return null;
}

function inferTypeFromName(cssVar) {
  if (/(?:-padding|-margin|-gap|-size|-width|-height|-radius|-space|-spacing|-offset|-inset)(?:-[a-z]+)?$/i.test(cssVar)) return 'dimension';
  if (/(?:-color|-bg|-foreground|-fg)(?:-[a-z]+)?$/i.test(cssVar)) return 'color';
  if (/-weight$/i.test(cssVar)) return 'fontWeight';
  if (/-family$/i.test(cssVar)) return 'fontFamily';
  return undefined;
}

function buildPathMap(decls) {
  const map = new Map();
  for (const d of decls) {
    const cls = classify(d.normalisedCssVar, d.value);
    if (!cls) continue;
    const path = cls.groupPath ? `${cls.groupPath}.${cls.leaf}` : cls.leaf;
    map.set(d.cssVar, path);
  }
  return map;
}

function valueToDtcg(value, pathMap) {
  const aliasTo = pureVarRef(value);
  if (aliasTo) {
    const path = pathMap.get(aliasTo);
    if (path) return { value: `{${path}}`, lightDark: null, isAlias: true };
  }
  const ld = expandLightDark(value);
  if (ld) {
    const [lightForm, darkForm] = ld;
    if (lightForm === darkForm) return { value: lightForm, lightDark: null };
    return { value: lightForm, lightDark: [lightForm, darkForm] };
  }
  return { value, lightDark: null };
}

function parseDimension(s) {
  const t = String(s).trim();
  if (/^-?0(?:\.0+)?$/.test(t)) return { value: 0, unit: 'px' };
  const m = t.match(/^(-?\d*\.?\d+)(px|rem|em|%)$/);
  if (!m) return null;
  return { value: Number(m[1]), unit: m[2] };
}

function parseNumber(s) {
  const t = String(s).trim();
  if (!/^-?\d*\.?\d+$/.test(t)) return null;
  return Number(t);
}

function parseDuration(s) {
  const t = String(s).trim();
  const m = t.match(/^(-?\d*\.?\d+)(ms|s)$/);
  if (!m) return null;
  return { value: Number(m[1]), unit: m[2] };
}

function parseCubicBezier(s) {
  const t = String(s).trim();
  const m = t.match(/^cubic-bezier\(\s*([0-9.-]+)\s*,\s*([0-9.-]+)\s*,\s*([0-9.-]+)\s*,\s*([0-9.-]+)\s*\)$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

function parseFontFamily(s) {
  const parts = splitTopLevel(String(s), ',')
    .map((p) => p.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0] : parts;
}

function parseOklchColor(s) {
  const m = String(s).trim().match(/^oklch\(\s*([0-9.]+)(%?)\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*([0-9.]+))?\s*\)$/);
  if (!m) return null;
  const lRaw = Number(m[1]);
  const lPercent = m[2] === '%';
  const L = lPercent ? lRaw / 100 : lRaw;
  const C = Number(m[3]);
  const H = Number(m[4]);
  const alpha = m[5] !== undefined ? Number(m[5]) : 1;
  const out = { colorSpace: 'oklch', components: [L, C, H] };
  if (alpha !== 1) out.alpha = alpha;
  return out;
}

function parseShadowLayer(s) {
  const trimmed = String(s).trim();
  const colorIdx = trimmed.search(/\b(?:oklch|rgb|hsl)\s*\(/i);
  if (colorIdx === -1) return null;
  const lengths = trimmed.slice(0, colorIdx).trim().split(/\s+/);
  if (lengths.length < 3 || lengths.length > 4) return null;
  const color = parseOklchColor(trimmed.slice(colorIdx).trim());
  if (!color) return null;
  const dims = lengths.map(parseDimension);
  if (dims.some((d) => d === null)) return null;
  return {
    offsetX: dims[0],
    offsetY: dims[1],
    blur: dims[2],
    spread: dims[3] ?? { value: 0, unit: 'px' },
    color,
  };
}

function parseLinearGradient(s, pathMap) {
  const trimmed = String(s).trim();
  const m = trimmed.match(/^linear-gradient\(\s*([\s\S]+)\s*\)$/);
  if (!m) return null;
  const parts = splitTopLevel(m[1], ',').map((p) => p.trim());
  if (parts.length < 2) return null;
  let direction;
  let stopsStart = 0;
  if (/^(?:-?\d*\.?\d+(?:deg|rad|grad|turn)|to\s+\w+)/i.test(parts[0])) {
    direction = parts[0].replace(/\s+/g, ' ');
    stopsStart = 1;
  }
  const stopsRaw = parts.slice(stopsStart);
  if (stopsRaw.length < 2) return null;
  const stops = [];
  for (let i = 0; i < stopsRaw.length; i++) {
    // Strip explicit position (e.g. "oklch(...) 20%") — DTCG positions are
    // implicit-uniform; if a real position differs we fail to lift and the
    // token gets excluded with a recommendation.
    const raw = stopsRaw[i];
    const lastSpace = raw.lastIndexOf(' ');
    const tail = lastSpace > 0 ? raw.slice(lastSpace + 1).trim() : '';
    const expectedPos = i / (stopsRaw.length - 1);
    let colorPart = raw;
    if (/^[\d.]+%$/.test(tail)) {
      const declared = Number(tail.slice(0, -1)) / 100;
      // Allow small rounding; otherwise reject — non-uniform stops aren't
      // representable in the simple stops[] array.
      if (Math.abs(declared - expectedPos) > 0.01) return null;
      colorPart = raw.slice(0, lastSpace).trim();
    }
    const color = parseColorOrAlias(colorPart, pathMap);
    if (color === null) return null;
    stops.push({ color, position: expectedPos });
  }
  return { stops, direction };
}

function parseBorder(s, pathMap) {
  const tokens = splitTopLevel(String(s).trim(), ' ').map((t) => t.trim()).filter(Boolean);
  if (tokens.length !== 3) return null;
  const width = parseDimension(tokens[0]);
  if (!width) return null;
  const style = tokens[1];
  if (!/^(?:none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset)$/.test(style)) return null;
  const color = parseColorOrAlias(tokens[2], pathMap);
  if (color === null) return null;
  return { width, style, color };
}

function parseColorOrAlias(s, pathMap) {
  const aliasTo = pureVarRef(s);
  if (aliasTo && pathMap?.has(aliasTo)) return `{${pathMap.get(aliasTo)}}`;
  return parseOklchColor(s);
}

function parseShadow(s) {
  if (String(s).trim() === 'none') return null;
  const layers = splitTopLevel(String(s), ',').map((l) => parseShadowLayer(l));
  if (layers.some((l) => l === null)) return null;
  return layers.length === 1 ? layers[0] : layers;
}

function liftValueByType(rawString, type, pathMap) {
  switch (type) {
    case 'dimension': {
      const v = parseDimension(rawString);
      return v ? { ok: true, value: v } : { ok: false };
    }
    case 'number': {
      const v = parseNumber(rawString);
      return v !== null ? { ok: true, value: v } : { ok: false };
    }
    case 'duration': {
      const v = parseDuration(rawString);
      return v ? { ok: true, value: v } : { ok: false };
    }
    case 'cubicBezier': {
      const v = parseCubicBezier(rawString);
      return v ? { ok: true, value: v } : { ok: false };
    }
    case 'fontFamily': {
      const v = parseFontFamily(rawString);
      return v !== null ? { ok: true, value: v } : { ok: false };
    }
    case 'color': {
      const v = parseOklchColor(rawString);
      return v ? { ok: true, value: v } : { ok: false };
    }
    case 'shadow': {
      const v = parseShadow(rawString);
      return v ? { ok: true, value: v } : { ok: false };
    }
    case 'gradient': {
      const g = parseLinearGradient(rawString, pathMap);
      if (!g) return { ok: false };
      return { ok: true, value: g.stops, extras: g.direction ? { gradientDirection: g.direction } : undefined };
    }
    case 'border': {
      const v = parseBorder(rawString, pathMap);
      return v ? { ok: true, value: v } : { ok: false };
    }
    default:
      return { ok: false };
  }
}

function setNested(root, pathParts, leafKey, entry) {
  let node = root;
  for (const part of pathParts.filter(Boolean)) {
    if (!(part in node)) node[part] = {};
    node = node[part];
  }
  node[leafKey] = entry;
}

function buildJson(decls, pathMap) {
  const root = {};
  const excluded = [];
  for (const d of decls) {
    const cls = classify(d.normalisedCssVar, d.value);
    if (!cls) continue;
    const dtcg = valueToDtcg(d.value, pathMap);

    let finalValue = dtcg.value;
    let extrasFromLift;
    if (!dtcg.isAlias && cls.type) {
      const lifted = liftValueByType(dtcg.value, cls.type, pathMap);
      if (lifted.ok) {
        finalValue = lifted.value;
        extrasFromLift = lifted.extras;
      } else {
        excluded.push({
          cssVar: d.cssVar,
          sourceFile: d.sourceFile,
          inferredType: cls.type,
          // Store the original CSS declaration (the full light-dark() value),
          // not the light-lifted dtcg.value — generate-css-from-tokens rebuilds
          // excluded tokens from rawValue, so a light-only value would drop the
          // canonical dark-mode branch and make the sidecar lossy.
          rawValue: d.value,
          reason: 'CSS construct has no DTCG-conformant shape (color-mix, clamp/calc, shorthand, gradient/border/shadow over light-dark() colours, multi-layer with `none`).',
          recommendation: EXCLUSION_RECOMMENDATIONS[d.cssVar],
        });
        continue;
      }
    }

    const entry = { $value: finalValue };
    if (!dtcg.isAlias && cls.type) entry.$type = cls.type;
    entry.$extensions = { 'com.inventory.cssVar': d.cssVar };
    if (d.sourceFile) entry.$extensions['com.inventory.sourceFile'] = d.sourceFile;
    if (dtcg.lightDark) entry.$extensions['com.inventory.lightDark'] = dtcg.lightDark;
    if (extrasFromLift?.gradientDirection) {
      entry.$extensions['com.inventory.gradientDirection'] = extrasFromLift.gradientDirection;
    }
    entry.$extensions['com.inventory.cssValue'] = d.value;
    const groupParts = (cls.groupPath || '').split('.').filter(Boolean);
    setNested(root, groupParts, cls.leaf, entry);
  }
  return { root, excluded };
}

function parseDeclsFromCss(css, prefixStrip) {
  return parseRoot(css).map((d) => ({
    ...d,
    normalisedCssVar: prefixStrip ? d.cssVar.replace(prefixStrip, '--') : d.cssVar,
  }));
}

// Inventory routes a single source file (theme.css) into three tiers by
// CSS-variable prefix. Mirrors the reference's pickThemeCoreSplit, generalised
// to three buckets.
function splitTiers(decls) {
  const core = [];
  const semantic = [];
  const component = [];
  for (const d of decls) {
    const tier = tierFor(d.cssVar);
    if (tier === 'core') core.push(d);
    else if (tier === 'component') component.push(d);
    else semantic.push(d);
  }
  return { core, semantic, component };
}

export function snapshotFromCss({ themeCss }) {
  const themeDecls = parseDeclsFromCss(themeCss, PREFIX_STRIP['theme.css']);

  const seen = new Map();
  for (const d of themeDecls) {
    if (seen.has(d.cssVar)) {
      throw new Error(
        `snapshot: ${d.cssVar} declared twice in theme.css. ` +
        `Each cssVar must be declared once — remove the redundant declaration.`
      );
    }
    seen.set(d.cssVar, 'theme.css');
  }

  const { core: coreDecls, semantic: semanticDecls, component: componentDecls } = splitTiers(themeDecls);

  const allDecls = themeDecls;
  const pathMap = buildPathMap(allDecls);

  const tag = (decls) => decls.map((d) => ({ ...d, sourceFile: 'theme.css' }));
  const core = buildJson(tag(coreDecls), pathMap);
  const semantic = buildJson(tag(semanticDecls), pathMap);
  const component = buildJson(tag(componentDecls), pathMap);

  pruneDanglingAliases([core, semantic, component]);

  const excludedAll = [...core.excluded, ...semantic.excluded, ...component.excluded];

  const captured = new Set();
  for (const r of [core.root, semantic.root, component.root]) collectCssVars(r, captured);
  for (const e of excludedAll) captured.add(e.cssVar);
  const declared = allDecls.map((d) => d.cssVar);
  const uncaptured = declared.filter((name) => !captured.has(name));

  return { core, semantic, component, excludedAll, uncaptured };
}

function main({ checkOnly }) {
  const themeCss = readFileSync(join(stylesDir, 'theme.css'), 'utf8');

  const { core, semantic, component, excludedAll, uncaptured } = snapshotFromCss({ themeCss });

  if (uncaptured.length > 0) {
    console.error('snapshot-design-tokens: the following CSS variables are not classified by any GROUPS rule:');
    for (const name of uncaptured) console.error(`  ${name}`);
    console.error('Add a rule to GROUPS in scripts/snapshot-design-tokens.mjs.');
    process.exit(2);
  }

  const outputs = [
    ['core.tokens.json', core.root, 'theme.css', 'Primitive palette and non-colour scales (radius, type scale, layout spacing, thumbnail sizing, shadows, focus ring). Mirrors the core slice of src/frontend/styles/theme.css.'],
    ['semantic.tokens.json', semantic.root, 'theme.css', 'Purpose-named tokens: colours, surfaces, borders, text, gradients, chips, status pills, buttons, scrollbars. Mirrors the semantic slice of src/frontend/styles/theme.css.'],
    ['component.tokens.json', component.root, 'theme.css', 'Component-scoped tokens (forge tray, thumbnail action buttons, selection badge). Mirrors the component slice of src/frontend/styles/theme.css.'],
  ];

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  let drift = 0;
  for (const [fname, json, source, description] of outputs) {
    const wrapped = {
      $description: description,
      $extensions: {
        'com.inventory.source': source,
        'com.inventory.generatedBy': 'scripts/snapshot-design-tokens.mjs',
        'com.inventory.note': 'Generated from CSS. Do not edit by hand. Run `pnpm run tokens:snapshot` after changing the canonical CSS.',
      },
      ...json,
    };
    const serialized = JSON.stringify(wrapped, null, 2) + '\n';
    const target = join(outDir, fname);
    if (checkOnly) {
      const existing = existsSync(target) ? readFileSync(target, 'utf8') : '';
      if (existing !== serialized) {
        console.error(`drift: ${relative(repoRoot, target)} is out of date.`);
        drift++;
      }
    } else {
      writeFileSync(target, serialized);
      console.log(`wrote ${relative(repoRoot, target)}`);
    }
  }

  const excludedJson = {
    description: 'Canonical CSS tokens whose source value uses CSS constructs with no DTCG-conformant shape (color-mix, clamp, calc, CSS shorthand, gradients/borders/shadows over light-dark() colours, multi-layer values). They remain authoritative in src/frontend/styles/theme.css and are deliberately omitted from the DTCG snapshot.',
    generatedBy: 'scripts/snapshot-design-tokens.mjs',
    tokens: excludedAll,
  };
  const excludedSerialized = JSON.stringify(excludedJson, null, 2) + '\n';
  const excludedTarget = join(outDir, '_excluded.json');
  if (checkOnly) {
    const existing = existsSync(excludedTarget) ? readFileSync(excludedTarget, 'utf8') : '';
    if (existing !== excludedSerialized) {
      console.error(`drift: ${relative(repoRoot, excludedTarget)} is out of date.`);
      drift++;
    }
  } else {
    writeFileSync(excludedTarget, excludedSerialized);
    console.log(`wrote ${relative(repoRoot, excludedTarget)}`);
  }

  if (checkOnly && drift > 0) {
    console.error(`\n${drift} file(s) out of date. Run \`pnpm run tokens:snapshot\` to refresh.`);
    process.exit(1);
  }
}

function collectCssVars(node, out) {
  if (!node || typeof node !== 'object') return;
  for (const key of Object.keys(node)) {
    if (key.startsWith('$')) continue;
    const v = node[key];
    if (v && typeof v === 'object') {
      if ('$value' in v && v.$extensions && v.$extensions['com.inventory.cssVar']) {
        out.add(v.$extensions['com.inventory.cssVar']);
      } else {
        collectCssVars(v, out);
      }
    }
  }
}

function collectPaths(node, prefix, out) {
  if (!node || typeof node !== 'object') return;
  for (const key of Object.keys(node)) {
    if (key.startsWith('$')) continue;
    const v = node[key];
    const here = prefix ? `${prefix}.${key}` : key;
    if (v && typeof v === 'object') {
      if ('$value' in v) out.add(here);
      else collectPaths(v, here, out);
    }
  }
}

function pruneDanglingAliases(buckets) {
  let changed = true;
  while (changed) {
    changed = false;
    const validPaths = new Set();
    for (const b of buckets) collectPaths(b.root, '', validPaths);
    for (const bucket of buckets) {
      pruneOne(bucket.root, '', bucket, validPaths, () => { changed = true; });
    }
  }
}

function pruneOne(node, prefix, bucket, validPaths, onChange) {
  if (!node || typeof node !== 'object') return;
  for (const key of Object.keys(node)) {
    if (key.startsWith('$')) continue;
    const v = node[key];
    if (!v || typeof v !== 'object') continue;
    const here = prefix ? `${prefix}.${key}` : key;
    if ('$value' in v) {
      const val = v.$value;
      if (typeof val === 'string') {
        const m = val.match(/^\{([^}]+)\}$/);
        if (m && !validPaths.has(m[1])) {
          const cssVar = v.$extensions?.['com.inventory.cssVar'] ?? here;
          bucket.excluded.push({
            cssVar,
            sourceFile: v.$extensions?.['com.inventory.sourceFile'],
            inferredType: v.$type ?? '(alias)',
            rawValue: v.$extensions?.['com.inventory.cssValue'] ?? val,
            reason: `alias target {${m[1]}} was excluded (transitive exclusion).`,
            recommendation: EXCLUSION_RECOMMENDATIONS[cssVar],
          });
          delete node[key];
          onChange();
        }
      }
    } else {
      pruneOne(v, here, bucket, validPaths, onChange);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checkOnly = process.argv.includes('--check');
  main({ checkOnly });
}
