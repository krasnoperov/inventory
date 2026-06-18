import fs from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';

// Visual style-reference gallery helpers. The capture spec drives a built Ladle
// catalog (served via `ladle preview`), shooting each story across viewports ×
// color schemes, and writes a browsable HTML gallery. Adapted from usertold,
// trimmed to inventory's single Ladle-stories tier.

export const STYLE_REFERENCE_ROOT = path.resolve(process.cwd(), 'screenshots/style-reference');

export type StyleReferenceEntry = {
  file: string;
  title: string;
  caption?: string;
  tag?: string;
};

export type StyleReferenceIndexCard = {
  href: string;
  title: string;
  description?: string;
  count?: number;
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Navigate to a Ladle story in preview mode and wait for it to finish rendering. */
export async function mountStory(page: Page, storyId: string) {
  await page.goto(`/?story=${encodeURIComponent(storyId)}&mode=preview`);
  await page.waitForSelector('html[data-storyloaded]', { timeout: 15_000 });
  await page.locator('[data-style-reference-root]').waitFor({ state: 'visible', timeout: 15_000 });
}

export async function shotInto(
  target: Page | Locator,
  dir: string,
  name: string,
  entries: StyleReferenceEntry[],
  title: string,
  caption?: string,
  options: { tag?: string; fullPage?: boolean } = {},
) {
  await fs.mkdir(dir, { recursive: true });
  const file = `${slugify(name)}.png`;
  await target.screenshot({ path: path.join(dir, file), fullPage: options.fullPage });
  entries.push({ file, title, caption, tag: options.tag });
}

const GALLERY_CSS = `
  :root { color-scheme: light dark; font-family: Inter, system-ui, sans-serif; background: #f6f7f8; color: #17191c; }
  @media (prefers-color-scheme: dark) { :root { background: #111315; color: #f2f4f5; } }
  body { margin: 0; padding: 32px; }
  header { max-width: 960px; margin: 0 auto 28px; }
  h1 { margin: 0 0 8px; font-size: 28px; }
  p { margin: 0; color: color-mix(in srgb, currentColor 70%, transparent); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; max-width: 1440px; margin: 0 auto; }
  .card { overflow: hidden; border: 1px solid color-mix(in srgb, currentColor 14%, transparent); border-radius: 8px; background: light-dark(#fff, #181b1f); }
  img { display: block; width: 100%; height: auto; background: light-dark(#f0f1f3, #0e1012); border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent); }
  .card-body { display: grid; gap: 8px; padding: 14px; }
  h2 { margin: 0; font-size: 15px; }
  .tag { justify-self: start; border: 1px solid color-mix(in srgb, currentColor 16%, transparent); border-radius: 999px; padding: 2px 8px; font-size: 12px; }
  a.crumb { color: inherit; font-size: 13px; text-underline-offset: 3px; }
`;

export function renderAreaIndex({
  title,
  description,
  entries,
  rootHref = '../index.html',
}: {
  title: string;
  description: string;
  entries: StyleReferenceEntry[];
  rootHref?: string;
}) {
  const cards = entries.map((entry) => `
    <article class="card">
      <a href="${escapeHtml(entry.file)}"><img src="${escapeHtml(entry.file)}" alt="${escapeHtml(entry.title)}" loading="lazy"></a>
      <div class="card-body">
        <h2>${escapeHtml(entry.title)}</h2>
        ${entry.tag ? `<span class="tag">${escapeHtml(entry.tag)}</span>` : ''}
        ${entry.caption ? `<p>${escapeHtml(entry.caption)}</p>` : ''}
      </div>
    </article>
  `).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Style reference</title>
  <style>${GALLERY_CSS}</style>
</head>
<body>
  <header>
    <p><a class="crumb" href="${escapeHtml(rootHref)}">← All style references</a></p>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
  </header>
  <main class="grid">${cards}</main>
</body>
</html>`;
}

export function renderCollectionIndex({
  title,
  description,
  cards,
}: {
  title: string;
  description: string;
  cards: StyleReferenceIndexCard[];
}) {
  const cardMarkup = cards.map((card) => `
    <article class="card" style="padding:18px;display:grid;gap:10px;align-content:start">
      <h2><a href="${escapeHtml(card.href)}">${escapeHtml(card.title)}</a></h2>
      ${card.description ? `<p>${escapeHtml(card.description)}</p>` : ''}
      ${typeof card.count === 'number' ? `<span class="tag">${card.count} capture${card.count === 1 ? '' : 's'}</span>` : ''}
    </article>
  `).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${GALLERY_CSS}</style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
  </header>
  <main class="grid">${cardMarkup}</main>
</body>
</html>`;
}

export async function writeAreaIndex(area: string, html: string) {
  await fs.mkdir(path.join(STYLE_REFERENCE_ROOT, area), { recursive: true });
  await fs.writeFile(path.join(STYLE_REFERENCE_ROOT, area, 'index.html'), html);
}
