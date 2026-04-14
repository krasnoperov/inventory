/**
 * Document-navigation middleware.
 *
 * The frontend is served as a SPA behind the Cloudflare Assets binding.
 * By default every unknown path resolves to `index.html` with HTTP 200,
 * which means:
 *   - Crawlers/unfurlers see the landing page's canonical + OG tags for
 *     every URL on the site.
 *   - Truly unknown routes never produce a 404 status.
 *
 * This middleware takes over document navigations (Accept: text/html) by
 * fetching `index.html` from the ASSETS binding, rewriting the per-route
 * metadata, and returning 200 for known SPA routes / 404 otherwise.
 * Non-document requests (JS, CSS, images, public files) pass through to
 * ASSETS unchanged.
 */

import type { Context } from 'hono';
import type { AppContext } from '../routes/types';

interface RouteMeta {
  title: string;
  description: string;
  robots?: string;
}

interface RouteDef {
  pattern: RegExp;
  meta: RouteMeta;
}

const SITE_NAME = 'Inventory Forge';
const LANDING_DESCRIPTION =
  'Inventory Forge is a collaborative web application for creating, refining, and composing AI-generated image assets. Track every variant\'s lineage and forge new assets from existing ones.';

// Patterns are intentionally strict (no optional trailing slash) so the
// server's notion of "known route" matches the client routeStore
// parseRoute exactly. Trailing-slash variants are canonicalised via 301
// redirect before this table is consulted.
const SPA_ROUTES: RouteDef[] = [
  {
    pattern: /^\/$/,
    meta: { title: SITE_NAME, description: LANDING_DESCRIPTION },
  },
  {
    pattern: /^\/login$/,
    meta: {
      title: `Sign in | ${SITE_NAME}`,
      description: 'Sign in to Inventory Forge with your Google account.',
    },
  },
  {
    pattern: /^\/dashboard$/,
    meta: {
      title: `Dashboard | ${SITE_NAME}`,
      description: 'Your Inventory Forge dashboard.',
      robots: 'noindex,nofollow',
    },
  },
  {
    pattern: /^\/profile$/,
    meta: {
      title: `Profile | ${SITE_NAME}`,
      description: 'Your Inventory Forge profile.',
      robots: 'noindex,nofollow',
    },
  },
  {
    pattern: /^\/oauth\/approve$/,
    meta: {
      title: `Authorize App | ${SITE_NAME}`,
      description: 'Authorize an application to access your Inventory Forge account.',
      robots: 'noindex,nofollow',
    },
  },
  {
    pattern: /^\/spaces\/[^/]+$/,
    meta: {
      title: `Space | ${SITE_NAME}`,
      description: 'Collaborative asset space in Inventory Forge.',
      robots: 'noindex,nofollow',
    },
  },
  {
    pattern: /^\/spaces\/[^/]+\/assets\/[^/]+$/,
    meta: {
      title: `Asset | ${SITE_NAME}`,
      description: 'Asset detail in Inventory Forge.',
      robots: 'noindex,nofollow',
    },
  },
];

const NOT_FOUND_META: RouteMeta = {
  title: `Not found | ${SITE_NAME}`,
  description: 'The page you were looking for does not exist.',
  robots: 'noindex,nofollow',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function replaceTagContent(html: string, tag: string, newContent: string): string {
  const re = new RegExp(`(<${tag}\\b[^>]*>)[\\s\\S]*?(<\\/${tag}>)`, 'i');
  return html.replace(re, `$1${newContent}$2`);
}

function replaceAttr(
  html: string,
  tag: string,
  attrMatch: string,
  newAttr: string,
  newValue: string,
): string {
  const re = new RegExp(
    `<${tag}\\b[^>]*\\b${attrMatch}[^>]*>`,
    'i',
  );
  return html.replace(re, (full) => {
    const withoutValue = full.replace(
      new RegExp(`\\b${newAttr}="[^"]*"`, 'i'),
      `${newAttr}="${escapeHtml(newValue)}"`,
    );
    return withoutValue;
  });
}

function rewriteMeta(html: string, meta: RouteMeta, canonicalUrl: string): string {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);

  let out = replaceTagContent(html, 'title', title);

  out = replaceAttr(out, 'meta', 'name="description"', 'content', meta.description);
  out = replaceAttr(out, 'meta', 'property="og:title"', 'content', meta.title);
  out = replaceAttr(out, 'meta', 'property="og:description"', 'content', meta.description);
  out = replaceAttr(out, 'meta', 'property="og:url"', 'content', canonicalUrl);
  out = replaceAttr(out, 'meta', 'name="twitter:title"', 'content', meta.title);
  out = replaceAttr(out, 'meta', 'name="twitter:description"', 'content', meta.description);
  out = replaceAttr(out, 'link', 'rel="canonical"', 'href', canonicalUrl);

  if (meta.robots) {
    // Replace existing robots meta or inject one before </head>.
    if (/<meta[^>]*\bname="robots"/i.test(out)) {
      out = replaceAttr(out, 'meta', 'name="robots"', 'content', meta.robots);
    } else {
      out = out.replace(
        /<\/head>/i,
        `    <meta name="robots" content="${escapeHtml(meta.robots)}" />\n  </head>`,
      );
    }
  }

  // Signal a rewrite to the upstream for debugging.
  void description;
  return out;
}

function isDocumentNavigation(c: Context<AppContext>): boolean {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return false;
  const accept = c.req.header('accept') ?? '';
  // Browsers send text/html first for document navigations. Asset requests
  // (fetch/XHR for JS, CSS, images, data) don't include text/html.
  return accept.includes('text/html');
}

/**
 * Heuristic: does the pathname target a concrete static file rather than
 * a client-routed page? Any trailing `.<ext>` segment counts as a file
 * (e.g. /robots.txt, /llms.txt, /assets/app.js, /favicon.ico). SPA routes
 * like `/login`, `/spaces/abc`, `/` don't hit this branch.
 */
function looksLikeStaticFile(pathname: string): boolean {
  return /\.[a-z0-9]+$/i.test(pathname);
}

export async function handleDocumentNavigation(c: Context<AppContext>): Promise<Response> {
  const url = new URL(c.req.url);
  const origin = url.origin;

  // Static files (including publicly served /robots.txt, /llms.txt, JS
  // chunks, images) must pass through to ASSETS regardless of the Accept
  // header — browsers direct-navigating to a .txt file send text/html too,
  // and we still want them to receive the actual file, not a rewritten
  // HTML shell.
  if (looksLikeStaticFile(url.pathname)) {
    return c.env.ASSETS.fetch(c.req.raw);
  }

  if (!isDocumentNavigation(c)) {
    // Non-document request for a non-file path (e.g. fetch('/api/...')
    // is handled by an earlier route; anything that falls through here
    // is delegated to ASSETS unchanged).
    return c.env.ASSETS.fetch(c.req.raw);
  }

  // Canonicalise trailing slashes on non-root document paths with a 301
  // so server + client agree on the effective path before we decide
  // known vs 404. Preserves query string.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    const canonical = url.pathname.replace(/\/+$/, '');
    return Response.redirect(`${origin}${canonical}${url.search}`, 301);
  }

  const match = SPA_ROUTES.find((r) => r.pattern.test(url.pathname));
  const meta = match ? match.meta : NOT_FOUND_META;
  const status = match ? 200 : 404;

  const shellRes = await c.env.ASSETS.fetch(new Request(`${origin}/index.html`));
  if (!shellRes.ok) {
    // Asset binding couldn't produce the shell — surface whatever it returned.
    return shellRes;
  }

  const html = await shellRes.text();
  const rewritten = rewriteMeta(html, meta, `${origin}${url.pathname}`);

  return new Response(rewritten, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=0, must-revalidate',
    },
  });
}
