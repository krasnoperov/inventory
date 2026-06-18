#!/usr/bin/env node
// Token guard — catches hardcoded color regressions in the frontend CSS.
//
// Three checks (color only — inventory's design-system.md bans hardcoded
// colors and nothing else, so the sibling repo's truncation / panel-spacing /
// shadow / motion / z-index rules are intentionally NOT ported):
//   1. Canonical CSS (global.css / theme.css) `:root` blocks must use
//      oklch / light-dark / var — never hex / rgb / hsl outside comments.
//   2. No hex fallbacks in `var(--token, #...)` anywhere in src/frontend.
//   3. Component module CSS may not introduce or change hardcoded color
//      values. Each tech-debt file is pinned to its current multiset of
//      hardcodes in `scripts/design-tokens-baseline.json`. The guard fails
//      on ANY mismatch — regression (extra value), partial sweep (missing
//      value), or value-swap (count unchanged but a value differs). This
//      defeats churn-style bypasses where a developer replaces one
//      hardcode with a token while adding a new hardcode elsewhere in the
//      same file: the count is unchanged, but the multiset isn't.
//
// To regenerate the baseline after an intentional sweep:
//   pnpm tokens:guard --update-baseline
//
// Run: `pnpm tokens:guard` (chained into `lint:tokens`).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const BASELINE_PATH = resolve(__dirname, 'design-tokens-baseline.json');

const CANONICAL_CSS = [
  'src/frontend/styles/global.css',
  'src/frontend/styles/theme.css',
];

// Two separate regexes per canonical-vs-module context:
//
// - In canonical CSS (`:root` blocks of theme.css / global.css)
//   `oklch(...)` IS the canonical color form for declaring tokens, so it is
//   allowed. Only hex / rgb / hsl are banned in canonical roots.
//
// - In module CSS, design-system.md "No hardcoded colors" disallows hex, rgb,
//   oklch, AND color-mix — those must come through tokens. So the module-CSS
//   regex adds `oklch(...)` and `color-mix(...)` to the catch list. Module CSS
//   that needs a tone blend reaches for an existing token; if no token fits,
//   declare a new one in theme.css and reference it via `var(--…)`.
//
// Both regexes capture FULL color expressions including ONE level of nested
// parens, so `oklch(var(--ring-l) var(--ring-c) var(--ring-h))` is captured
// in full instead of stopping at the first inner `)`. Without the nesting
// support a developer could replace e.g. `oklch(var(--l) var(--c) var(--h))`
// with `oklch(50% 0.2 120)` and the multiset diff would only see the
// truncated head `oklch(var(--l)` versus `oklch(50%`, missing the substantive
// drift. CSS doesn't go deeper than one level of nesting in color calls.
const FN_CALL = '\\([^()]*(?:\\([^()]*\\)[^()]*)*\\)';

// URL-encoded hex (`%23ffffff` = `#ffffff`) inside inline-SVG `url(data:...)`
// values. Authors sometimes encode the `#` so that the data URL parses
// correctly; without this match a `<path fill='%23fff'.../>` inside a
// background-image data URL would slip past the hex regex.
const URL_ENCODED_HEX_RE = /%23[0-9a-fA-F]{3,8}\b/g;

// Named CSS colors — the practical set developers actually reach for.
// Restricted to declared color contexts (`color:`, `background:`, `border-…`,
// `outline:`, `fill:`, `stroke:`, `box-shadow:`, etc.) so that property names
// like `outline: 2px solid black` register as a hardcode but utility words
// like `transparent` or `currentColor` do not. CSS exposes 148 named colors;
// here we list the dominant set (basic 16 + the modern keyword tier).
//
// Word boundaries (\b) prevent matching e.g. `red-text` as the named color
// `red`. The `(?<!--|var\()` lookbehind keeps custom property names like
// `--blue-soft` and `var(--blue)` from triggering.
// Full CSS named-color list (CSS Color Module Level 4). 148 entries. Includes
// the basic 16, the extended X11/SVG palette, and the modern alias `rebeccapurple`.
const NAMED_COLORS = [
  'aliceblue','antiquewhite','aqua','aquamarine','azure',
  'beige','bisque','black','blanchedalmond','blue','blueviolet','brown','burlywood',
  'cadetblue','chartreuse','chocolate','coral','cornflowerblue','cornsilk','crimson','cyan',
  'darkblue','darkcyan','darkgoldenrod','darkgray','darkgrey','darkgreen','darkkhaki',
  'darkmagenta','darkolivegreen','darkorange','darkorchid','darkred','darksalmon',
  'darkseagreen','darkslateblue','darkslategray','darkslategrey','darkturquoise',
  'darkviolet','deeppink','deepskyblue','dimgray','dimgrey','dodgerblue',
  'firebrick','floralwhite','forestgreen','fuchsia',
  'gainsboro','ghostwhite','gold','goldenrod','gray','grey','green','greenyellow',
  'honeydew','hotpink',
  'indianred','indigo','ivory',
  'khaki',
  'lavender','lavenderblush','lawngreen','lemonchiffon','lightblue','lightcoral',
  'lightcyan','lightgoldenrodyellow','lightgray','lightgrey','lightgreen','lightpink',
  'lightsalmon','lightseagreen','lightskyblue','lightslategray','lightslategrey',
  'lightsteelblue','lightyellow','lime','limegreen','linen',
  'magenta','maroon','mediumaquamarine','mediumblue','mediumorchid','mediumpurple',
  'mediumseagreen','mediumslateblue','mediumspringgreen','mediumturquoise','mediumvioletred',
  'midnightblue','mintcream','mistyrose','moccasin',
  'navajowhite','navy',
  'oldlace','olive','olivedrab','orange','orangered','orchid',
  'palegoldenrod','palegreen','paleturquoise','palevioletred','papayawhip','peachpuff',
  'peru','pink','plum','powderblue','purple',
  'rebeccapurple','red','rosybrown','royalblue',
  'saddlebrown','salmon','sandybrown','seagreen','seashell','sienna','silver','skyblue',
  'slateblue','slategray','slategrey','snow','springgreen','steelblue',
  'tan','teal','thistle','tomato','turquoise',
  'violet',
  'wheat','white','whitesmoke',
  'yellow','yellowgreen',
].join('|');
const NAMED_COLOR_RE = new RegExp(
  String.raw`(?<![-#a-zA-Z0-9_])(${NAMED_COLORS})(?![-a-zA-Z0-9_(])`,
  'gi',
);
// Detect a property assignment whose value contains a named color. Catches:
//   - direct color declarations:   `color: red`, `border: 2px solid black`
//   - gradient values:             `background: linear-gradient(red, ...)`
//   - inline-SVG via url():        `background-image: url("...stroke='white'...")`
//   - mask/border-image values:    `-webkit-mask-image: url("...fill='red'...")`
//   - custom-property staging:     `--my-color: red` consumed via var()
//
// The named-color regex below only flags actual color words inside the
// captured value, so non-color custom properties (`--padding: 1rem`,
// `--gap: 0.5rem`) and url(image.png) paths are silently passed.
//
// Value-capture is `(?:[^;{}]|url\([^)]*\))+` rather than `[^;{}]+` so a
// data URL like `url("data:image/svg+xml;utf8,...")` — which contains a
// literal `;` between the media type and the body — is captured whole
// instead of cut off at the media-type semicolon. Without this branch
// inline-SVG named colors (e.g. `stroke='white'` inside an SVG embedded
// as a `background-image`) slipped past the named-color check.
const COLOR_PROPERTY_RE = /(?:^|[\s;{])(?:--[a-z][-a-z0-9]*|color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block(?:-start|-end)?|inline(?:-start|-end)?)(?:-color)?|-color|-image)?|outline(?:-color)?|fill|stroke|box-shadow|caret-color|column-rule(?:-color)?|text-decoration(?:-color)?|text-shadow|accent-color|(?:-webkit-)?mask(?:-image)?)\s*:\s*((?:url\([^)]*\)|[^;{}])+)/gi;

const CANONICAL_HARDCODE_RE = new RegExp(
  `#[0-9a-fA-F]{3,8}\\b|\\brgba?${FN_CALL}|\\bhsla?${FN_CALL}`,
  'g',
);
const HARDCODE_RE = new RegExp(
  `#[0-9a-fA-F]{3,8}\\b|\\brgba?${FN_CALL}|\\bhsla?${FN_CALL}|\\boklch${FN_CALL}|\\bcolor-mix${FN_CALL}`,
  'g',
);
const HEX_FALLBACK_IN_VAR = /var\(\s*--[a-z][-a-z0-9]*\s*,\s*#[0-9a-fA-F]/g;

function listCssFiles() {
  const result = spawnSync(
    'git',
    ['ls-files', 'src/frontend/**/*.css', 'src/frontend/**/*.module.css'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr}`);
  }
  return result.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    // Design sketches under `src/frontend/__sketches__/` are dev-only
    // references mounted by the component harness, not production code.
    // They intentionally hardcode colors so a future designer can read the
    // snapshot as a frozen artefact; the guard scans production CSS only.
    .filter((file) => !file.includes('/__sketches__/'));
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Normalize so identical colors expressed slightly differently still compare
// equal: lowercase the whole token and collapse whitespace runs to a single
// space, so `rgba(0, 0, 0, 0.5)` and `rgba(0,0,0,0.5)` match. Preserve at
// least one delimiter between number tokens — collapsing whitespace
// completely would fuse `oklch(72% 0.15 155 / 0.35)` and
// `oklch(72% 0.151 55 / 0.35)` into the same normalized string, hiding a
// hue change behind decimal-shift drift.
function normalize(value) {
  return value
    .toLowerCase()
    .replace(/\s*([(,/)])\s*/g, '$1')  // tighten around `(`, `,`, `/`, `)`
    .replace(/\s+/g, ' ')                 // collapse remaining runs to one space
    .trim();
}

function findHardcodes(stripped) {
  const matches = [];
  let m;
  HARDCODE_RE.lastIndex = 0;
  while ((m = HARDCODE_RE.exec(stripped)) !== null) {
    const raw = m[0];
    // Structural-neutral `oklch(L 0 H / A)` (chroma=0) is grayscale-at-alpha
    // used for masks, shadows, translucent overlays. No brand decision is
    // encoded, so the rule that exists to push brand colors into tokens
    // shouldn't fight it.
    if (isNeutralOklch(raw)) continue;
    matches.push({
      raw,
      normalized: normalize(raw),
      line: stripped.slice(0, m.index).split('\n').length,
    });
  }
  // Named CSS colors (red, white, blue, …) and URL-encoded hex (`%23fff`)
  // inside color-property values. Scoped to color-bearing properties to
  // avoid false positives on words like "outline" or filenames like
  // "tomato.png" in url(...) contexts.
  COLOR_PROPERTY_RE.lastIndex = 0;
  let p;
  while ((p = COLOR_PROPERTY_RE.exec(stripped)) !== null) {
    const value = p[1];
    NAMED_COLOR_RE.lastIndex = 0;
    let nm;
    while ((nm = NAMED_COLOR_RE.exec(value)) !== null) {
      const raw = nm[0];
      const indexInFile = p.index + p[0].indexOf(value) + nm.index;
      matches.push({
        raw,
        normalized: raw.toLowerCase(),
        line: stripped.slice(0, indexInFile).split('\n').length,
      });
    }
    URL_ENCODED_HEX_RE.lastIndex = 0;
    while ((nm = URL_ENCODED_HEX_RE.exec(value)) !== null) {
      const raw = nm[0];
      const indexInFile = p.index + p[0].indexOf(value) + nm.index;
      matches.push({
        raw,
        normalized: raw.toLowerCase(),
        line: stripped.slice(0, indexInFile).split('\n').length,
      });
    }
  }
  return matches;
}

// Match `oklch( <L> <C> <H>[ / <A>])` and return true when chroma is exactly 0.
// `oklch(0 0 0)` and `oklch(100% 0 0 / 0.5)` and `oklch(20% 0.0 200)` all qualify.
function isNeutralOklch(raw) {
  if (!raw.startsWith('oklch')) return false;
  const inside = raw.slice(raw.indexOf('(') + 1, raw.lastIndexOf(')'));
  const args = inside.split('/')[0].trim().split(/\s+/);
  if (args.length < 2) return false;
  const chroma = parseFloat(args[1]);
  return Number.isFinite(chroma) && chroma === 0;
}

function loadBaseline() {
  const raw = readFileSync(BASELINE_PATH, 'utf8');
  const json = JSON.parse(raw);
  return {
    colors: json.files ?? {},
  };
}

function saveBaseline({ colors }) {
  // Re-read existing top-level keys so the comments/metadata survive.
  const raw = readFileSync(BASELINE_PATH, 'utf8');
  const json = JSON.parse(raw);
  const sortedColors = {};
  for (const key of [...Object.keys(colors)].sort()) {
    sortedColors[key] = [...colors[key]].sort();
  }
  json.files = sortedColors;
  writeFileSync(BASELINE_PATH, JSON.stringify(json, null, 2) + '\n');
}

// Multiset diff. Returns { missing, extra } both as sorted arrays.
function diffMultisets(baseline, current) {
  const baseCounts = new Map();
  for (const v of baseline) baseCounts.set(v, (baseCounts.get(v) ?? 0) + 1);
  const currCounts = new Map();
  for (const v of current) currCounts.set(v, (currCounts.get(v) ?? 0) + 1);
  const missing = [];
  const extra = [];
  const all = new Set([...baseCounts.keys(), ...currCounts.keys()]);
  for (const v of [...all].sort()) {
    const b = baseCounts.get(v) ?? 0;
    const c = currCounts.get(v) ?? 0;
    if (c < b) missing.push({ value: v, count: b - c });
    if (c > b) extra.push({ value: v, count: c - b });
  }
  return { missing, extra };
}

const errors = [];

function checkCanonicalRoots() {
  for (const rel of CANONICAL_CSS) {
    const abs = resolve(repoRoot, rel);
    let raw;
    try {
      raw = readFileSync(abs, 'utf8');
    } catch {
      errors.push(`Canonical CSS missing: ${rel}`);
      continue;
    }
    const stripped = stripComments(raw);
    // Match `:root { … }`, `:root:not(...) { … }`, `:root:foo(...) { … }`,
    // and `[data-theme='dark'] { … }`. The `:not()` form is what an OS-dark
    // override block would use (`:root:not([data-theme='light'])`), and a
    // literal `:root` regex without that branch would let dark-preference
    // hardcodes slip past the guard.
    const rootBlocks = stripped.matchAll(
      /(?::root(?::[a-z-]+\([^{}]*\))?|\[data-theme=['"]dark['"]\])\s*\{([\s\S]*?)\}/g,
    );
    for (const match of rootBlocks) {
      const body = match[1];
      const bodyOffset = match.index + match[0].indexOf(body);
      const lineOffset = stripped.slice(0, match.index).split('\n').length;

      // Per-line scan for hex/rgb/hsl in declarations of any kind. Cheap
      // and keeps line-precise error messages.
      body.split('\n').forEach((line, i) => {
        const hits = line.match(CANONICAL_HARDCODE_RE);
        if (hits) {
          errors.push(
            `[${rel}:${lineOffset + i}] hex / rgb / hsl in canonical :root — found ${hits.join(
              ', ',
            )}; use oklch() + light-dark() + a token`,
          );
        }
      });

      // Named CSS colors are banned in canonical token declarations too:
      // `--accent-brand: red` would otherwise pass because oklch() is the
      // only chromatic literal expected in :root. Use a multi-line scan so
      // declarations split across lines — `--token: light-dark(\n  red,\n
      // blue\n);` — are caught. Match `--name: <value>;` where <value>
      // can span newlines, then look up the named color inside the value.
      const DECL_RE = /(--[a-z][-a-z0-9]*)\s*:\s*([^;{}]+);/gi;
      let dm;
      while ((dm = DECL_RE.exec(body)) !== null) {
        const value = dm[2];
        NAMED_COLOR_RE.lastIndex = 0;
        const namedHits = value.match(NAMED_COLOR_RE);
        if (namedHits) {
          const declStart = bodyOffset + dm.index;
          const declLine = stripped.slice(0, declStart).split('\n').length;
          errors.push(
            `[${rel}:${declLine}] named CSS color in canonical :root — found ${namedHits.join(
              ', ',
            )} in ${dm[1]}; use oklch() + light-dark() + a token`,
          );
        }
      }
    }
  }
}

function checkHexFallbacks(files) {
  for (const rel of files) {
    const abs = resolve(repoRoot, rel);
    const raw = readFileSync(abs, 'utf8');
    const stripped = stripComments(raw);
    let m;
    HEX_FALLBACK_IN_VAR.lastIndex = 0;
    while ((m = HEX_FALLBACK_IN_VAR.exec(stripped)) !== null) {
      const line = stripped.slice(0, m.index).split('\n').length;
      errors.push(
        `[${rel}:${line}] hex fallback in var() — tokens are always defined; drop the fallback`,
      );
    }
  }
}

function checkComponentHardcodes(files, baseline) {
  const canonical = new Set(CANONICAL_CSS);
  for (const rel of files) {
    if (canonical.has(rel)) continue;
    const abs = resolve(repoRoot, rel);
    const raw = readFileSync(abs, 'utf8');
    const stripped = stripComments(raw);
    const matches = findHardcodes(stripped);
    const current = matches.map((h) => h.normalized);
    const baselineValues = baseline[rel];

    if (baselineValues === undefined) {
      // Not on the legacy list — must be clean.
      if (matches.length > 0) {
        const sample = matches.slice(0, 5)
          .map((h) => `${rel}:${h.line} → ${h.raw}`)
          .join('\n    ');
        errors.push(
          `[${rel}] hardcoded color${matches.length === 1 ? '' : 's'} in component CSS (${matches.length}) — use a token. Showing first ${Math.min(5, matches.length)}:\n    ${sample}`,
        );
      }
      continue;
    }

    const { missing, extra } = diffMultisets(baselineValues, current);
    if (missing.length === 0 && extra.length === 0) continue;

    const lines = [`[${rel}] hardcoded-color multiset drifted from baseline:`];
    if (extra.length > 0) {
      lines.push(`    + new / extra (use a token instead, or run \`pnpm tokens:guard --update-baseline\` to record):`);
      for (const { value, count } of extra) {
        // Locate the first occurrence in the file for a useful pointer.
        const hit = matches.find((h) => h.normalized === value);
        const where = hit ? ` (first at ${rel}:${hit.line})` : '';
        lines.push(`        ${value}${count > 1 ? ` ×${count}` : ''}${where}`);
      }
    }
    if (missing.length > 0) {
      lines.push(`    − removed / swept (re-run with --update-baseline so the baseline reflects the cleanup):`);
      for (const { value, count } of missing) {
        lines.push(`        ${value}${count > 1 ? ` ×${count}` : ''}`);
      }
    }
    errors.push(lines.join('\n'));
  }
}

function checkBaselineOrphans(files, baseline) {
  const present = new Set(files);
  for (const rel of Object.keys(baseline)) {
    if (!present.has(rel)) {
      errors.push(
        `[${rel}] listed in design-tokens-baseline.json but file no longer exists. Re-run with --update-baseline.`,
      );
    }
  }
}

function regenerateBaseline(files) {
  const canonical = new Set(CANONICAL_CSS);
  const colors = {};
  for (const rel of files) {
    if (canonical.has(rel)) continue;
    const abs = resolve(repoRoot, rel);
    const raw = readFileSync(abs, 'utf8');
    const stripped = stripComments(raw);
    const colorMatches = findHardcodes(stripped);
    if (colorMatches.length > 0) {
      colors[rel] = colorMatches.map((h) => h.normalized).sort();
    }
  }
  saveBaseline({ colors });
  const totalColors = Object.values(colors).reduce((a, arr) => a + arr.length, 0);
  console.log(
    `Baseline regenerated: ${Object.keys(colors).length} legacy color files / ${totalColors} hardcodes → ${BASELINE_PATH.replace(repoRoot + '/', '')}`,
  );
}

function main() {
  const args = process.argv.slice(2);
  const files = listCssFiles();

  if (args.includes('--update-baseline')) {
    regenerateBaseline(files);
    return;
  }

  const baseline = loadBaseline();

  checkCanonicalRoots();
  checkHexFallbacks(files);
  checkComponentHardcodes(files, baseline.colors);
  checkBaselineOrphans(files, baseline.colors);

  if (errors.length > 0) {
    console.error(`\nDesign-token guard failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
    for (const e of errors) console.error(`  ${e}`);
    console.error(
      `\nFor new code, replace the hardcoded value with a token in src/frontend/styles/theme.css.\nFor a deliberate sweep that legitimately changes the legacy multiset, re-run \`pnpm tokens:guard --update-baseline\` to record the new state.`,
    );
    process.exit(1);
  }
  const totalColors = Object.values(baseline.colors).reduce((a, arr) => a + arr.length, 0);
  console.log(
    `Design-token guard passed (${files.length} files scanned; ${Object.keys(baseline.colors).length} legacy color files / ${totalColors} hardcodes).`,
  );
}

main();
