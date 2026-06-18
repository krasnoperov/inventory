import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Orchestrates the visual style-reference gallery:
//   1. build the Ladle catalog (build/ladle)
//   2. run the Playwright capture spec (story × viewport × theme -> PNGs + area index)
//   3. write a master index linking each area
//   4. optionally mirror the whole tree somewhere shareable
//
// Usage:
//   pnpm style-reference                 # full run
//   pnpm style-reference:rebuild         # regenerate indexes from existing PNGs (no capture)
//   node scripts/export-style-reference.mjs --smoke      # capture a small subset
//   node scripts/export-style-reference.mjs --mirror     # also copy to ~/Desktop/inventory-style-reference
//   node scripts/export-style-reference.mjs --dest=/path # explicit mirror target

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(repoRoot, 'screenshots/style-reference');
const defaultMirror = path.join(process.env.HOME ?? repoRoot, 'Desktop/inventory-style-reference');

const args = process.argv.slice(2);
const rebuildOnly = args.includes('--rebuild');
const smoke = args.includes('--smoke');
const mirror = args.includes('--mirror');
const destArg = args.find((a) => a.startsWith('--dest='));
const mirrorDest = destArg ? path.resolve(destArg.slice('--dest='.length)) : mirror ? defaultMirror : null;

function run(command, commandArgs, env = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${result.status ?? 1}`);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function countPngs(dir) {
  if (!(await pathExists(dir))) return 0;
  let n = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += await countPngs(path.join(dir, entry.name));
    else if (entry.name.endsWith('.png')) n += 1;
  }
  return n;
}

const AREAS = [
  { key: 'components', title: 'Components', description: 'Ladle component stories across viewports and light/dark.' },
];

async function renderMasterIndex() {
  const cards = [];
  for (const area of AREAS) {
    const indexPath = path.join(outputRoot, area.key, 'index.html');
    const exists = await pathExists(indexPath);
    const count = exists ? await countPngs(path.join(outputRoot, area.key)) : 0;
    cards.push(`
    <article class="card${exists ? '' : ' muted'}">
      <h2>${escapeHtml(area.title)}</h2>
      <p>${escapeHtml(area.description)}</p>
      ${exists ? `<a href="./${area.key}/index.html">Open ${escapeHtml(area.title)} (${count})</a>` : '<span>Not generated yet</span>'}
    </article>`);
  }

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Inventory · Style reference</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, system-ui, sans-serif; background: #f6f7f8; color: #17191c; }
    @media (prefers-color-scheme: dark) { :root { background: #111315; color: #f2f4f5; } }
    body { margin: 0; padding: 40px; }
    main, header { max-width: 960px; margin: 0 auto; }
    header { margin-bottom: 28px; }
    h1 { margin: 0 0 8px; font-size: 32px; }
    p { color: color-mix(in srgb, currentColor 70%, transparent); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
    .card { display: grid; gap: 12px; border: 1px solid color-mix(in srgb, currentColor 14%, transparent); border-radius: 8px; padding: 18px; background: light-dark(#fff, #181b1f); }
    .card h2 { margin: 0; font-size: 18px; }
    .card a, .card span { justify-self: start; font-weight: 700; color: inherit; }
    .muted { opacity: 0.55; }
  </style>
</head>
<body>
  <header>
    <h1>Inventory Style Reference</h1>
    <p>Live component catalog captured from Ladle — the visual companion to the design tokens.</p>
  </header>
  <main class="grid">${cards.join('\n')}</main>
</body>
</html>`;

  await fs.mkdir(outputRoot, { recursive: true });
  await fs.writeFile(path.join(outputRoot, 'index.html'), html);
}

async function mirrorOutput(destination) {
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(outputRoot, destination, { recursive: true });
  console.log(`[style-reference] mirrored ${outputRoot} -> ${destination}`);
}

if (!rebuildOnly) {
  await fs.rm(outputRoot, { recursive: true, force: true });
  run('pnpm', ['stories:build']);
  run('pnpm', ['exec', 'playwright', 'test', '--config', 'playwright.style-reference.config.ts'], {
    STYLE_REFERENCE_SMOKE: smoke ? '1' : (process.env.STYLE_REFERENCE_SMOKE ?? ''),
  });
}

await renderMasterIndex();

if (mirrorDest) {
  await mirrorOutput(mirrorDest);
}

const total = await countPngs(outputRoot);
console.log(`[style-reference] ${total} captures · open ${path.join(outputRoot, 'index.html')}`);
