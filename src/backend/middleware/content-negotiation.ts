import type { Context, MiddlewareHandler } from 'hono';
import { renderStartApp } from '../frontend-start-ssr';
import type { AppContext } from '../routes/types';

const PUBLIC_SITE_ORIGIN = 'https://makefx.app';
const AGENT_CARD_PATH = '/.well-known/agent-card.json';
const AGENT_SKILLS_PATH = '/.well-known/agent-skills/index.json';

const TEXT_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'public, max-age=300',
};

const MARKDOWN_HEADERS = {
  'Content-Type': 'text/markdown; charset=utf-8',
  'Cache-Control': 'public, max-age=300',
  'Vary': 'Accept',
  'X-Robots-Tag': 'noindex, nofollow',
};

function publicUrl(path: string): string {
  return path === '/' ? PUBLIC_SITE_ORIGIN : `${PUBLIC_SITE_ORIGIN}${path}`;
}

function markdownPath(path: string): string {
  return path === '/' ? '/index.md' : `${path}.md`;
}

function linkHeader(path: string, markdownRequest: boolean): string {
  return [
    markdownRequest
      ? `<${publicUrl(path)}>; rel="canonical"`
      : `<${publicUrl(markdownPath(path))}>; rel="alternate"; type="text/markdown"`,
    '</llms.txt>; rel="llms-txt"',
    '</llms-full.txt>; rel="llms-full-txt"',
    `<${publicUrl(AGENT_CARD_PATH)}>; rel="service-desc"; type="application/json"`,
    `<${publicUrl(AGENT_SKILLS_PATH)}>; rel="agent-skills"; type="application/json"`,
  ].join(', ');
}

async function loadContentMap() {
  return import('../content-map');
}

function jsonResponse(c: Context<AppContext>, value: unknown): Response {
  return c.json(value, 200, {
    'Cache-Control': 'public, max-age=300',
    'Link': linkHeader('/', false),
    'X-Llms-Txt': '/llms.txt',
  });
}

export function contentNegotiation(): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    const url = new URL(c.req.url);
    const rawPath = url.pathname;

    if (rawPath === AGENT_CARD_PATH) {
      return jsonResponse(c, {
        name: 'Make Effects',
        description: 'CLI-first media generation with project memory for variants, prompts, lineage, collaboration, and production handoff.',
        url: PUBLIC_SITE_ORIGIN,
        documentation_url: `${PUBLIC_SITE_ORIGIN}/docs`,
        llms_txt: `${PUBLIC_SITE_ORIGIN}/llms.txt`,
        llms_full_txt: `${PUBLIC_SITE_ORIGIN}/llms-full.txt`,
        skills_index_url: `${PUBLIC_SITE_ORIGIN}${AGENT_SKILLS_PATH}`,
        preferred_cli: 'makefx',
      });
    }

    if (rawPath === AGENT_SKILLS_PATH) {
      return jsonResponse(c, {
        name: 'Make Effects Agent Skills',
        description: 'Public surfaces an agent can use to understand and operate Make Effects projects.',
        skills: [
          {
            id: 'read-docs',
            name: 'Read public documentation',
            description: 'Use markdown docs and the LLM indexes to understand the product and CLI.',
            href: `${PUBLIC_SITE_ORIGIN}/llms.txt`,
            type: 'text/markdown',
          },
          {
            id: 'use-cli',
            name: 'Operate through the makefx CLI',
            description: 'Generate media, inspect assets, watch jobs, and export production handoff data with JSON-friendly commands.',
            href: `${PUBLIC_SITE_ORIGIN}/docs/cli.md`,
            type: 'text/markdown',
          },
        ],
      });
    }

    if (rawPath === '/llms.txt') {
      const { LLMS_TXT } = await loadContentMap();
      return c.text(LLMS_TXT, 200, TEXT_HEADERS);
    }

    if (rawPath === '/llms-full.txt') {
      const { LLMS_FULL_TXT } = await loadContentMap();
      return c.text(LLMS_FULL_TXT, 200, TEXT_HEADERS);
    }

    const markdownRequest = rawPath.endsWith('.md');
    const contentPath = markdownRequest
      ? rawPath === '/index.md'
        ? '/'
        : rawPath.slice(0, -3)
      : rawPath;

    if (!markdownRequest && !['/', '/docs'].includes(contentPath) && !contentPath.startsWith('/docs/')) {
      await next();
      return;
    }

    const { CONTENT_MAP } = await loadContentMap();
    const markdown = CONTENT_MAP[contentPath];
    if (!markdown) {
      await next();
      return;
    }

    if (markdownRequest) {
      return c.text(markdown, 200, {
        ...MARKDOWN_HEADERS,
        'Link': linkHeader(contentPath, true),
        'X-Llms-Txt': '/llms.txt',
      });
    }

    const res = await renderStartApp(c, { forceDocument: true });
    const out = new Response(res.body, res);
    out.headers.set('Link', linkHeader(contentPath, false));
    out.headers.set('X-Llms-Txt', '/llms.txt');
    return out;
  };
}
