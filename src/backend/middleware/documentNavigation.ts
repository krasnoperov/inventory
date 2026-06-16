import type { Context } from 'hono';
import { AuthHandler } from '../features/auth/auth-handler';
import type { AppContext } from '../routes/types';
import type { AuthSessionResponse } from '../../shared/api/schemas';

interface RenderedRoute {
  html: string;
  status: number;
}

export type RouteRenderer = (
  request: Request,
  session: AuthSessionResponse,
) => Promise<RenderedRoute>;

export function documentResponseHeaders(): HeadersInit {
  return {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'private, no-store',
    'x-inventory-ssr': 'tanstack-router',
  };
}

function serializeJsonForInlineScript(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => {
    switch (char) {
      case '<':
        return '\\u003c';
      case '>':
        return '\\u003e';
      case '&':
        return '\\u0026';
      case '\u2028':
        return '\\u2028';
      case '\u2029':
        return '\\u2029';
      default:
        return char;
    }
  });
}

async function resolveStartSession(c: Context<AppContext>): Promise<AuthSessionResponse> {
  const baseSession: AuthSessionResponse = {
    user: null,
    config: {
      googleClientId: c.env.GOOGLE_CLIENT_ID || '',
      environment: c.env.ENVIRONMENT || 'development',
    },
  };

  if (!c.req.header('Cookie')) {
    return baseSession;
  }

  const container = c.get('container');
  if (!container) {
    return baseSession;
  }

  const authHandler = container.get(AuthHandler);
  const response = await authHandler.getSession(c);
  return (response as unknown as Response).json<AuthSessionResponse>();
}

async function loadBuiltRouteRenderer(): Promise<RouteRenderer> {
  // Built by `pnpm run build:frontend-ssr`; imported lazily so unit tests can
  // inject a renderer without requiring build artifacts.
  // @ts-expect-error generated build output is absent before `pnpm run build`
  const { renderTanStackStartRoute } = await import('../../../dist/frontend-ssr/ssr.js') as typeof import('../../frontend/ssr');
  return renderTanStackStartRoute;
}

async function renderSsrDocument(
  c: Context<AppContext>,
  shellHtml: string,
  renderRoute: RouteRenderer,
): Promise<RenderedRoute> {
  const session = await resolveStartSession(c);
  const rendered = await renderRoute(c.req.raw, session);
  const sessionScript = `<script>window.__INVENTORY_START_SESSION__=${serializeJsonForInlineScript(session)};</script>`;

  let html = shellHtml.replace(
    /<html\b([^>]*)>/i,
    (full, attrs: string) => (
      /\bdata-inventory-ssr=/i.test(full)
        ? full
        : `<html${attrs} data-inventory-ssr="tanstack-router">`
    ),
  );

  html = html.replace(/<div id="root"><\/div>/, `<div id="root">${rendered.html}</div>`);
  html = html.replace(/<\/body>/i, `    ${sessionScript}\n  </body>`);

  return {
    html,
    status: rendered.status,
  };
}

function isDocumentNavigation(c: Context<AppContext>): boolean {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return false;
  const accept = c.req.header('accept') ?? '';
  return accept.includes('text/html');
}

function looksLikeStaticFile(pathname: string): boolean {
  return /\.[a-z0-9]+$/i.test(pathname);
}

export function createDocumentNavigationHandler(
  loadRouteRenderer: () => Promise<RouteRenderer> = loadBuiltRouteRenderer,
) {
  return async function handleDocumentNavigation(c: Context<AppContext>): Promise<Response> {
    const url = new URL(c.req.url);
    const origin = url.origin;

    if (looksLikeStaticFile(url.pathname) || !isDocumentNavigation(c)) {
      return c.env.ASSETS.fetch(c.req.raw);
    }

    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      const canonical = url.pathname.replace(/\/+$/, '');
      return Response.redirect(`${origin}${canonical}${url.search}`, 301);
    }

    const shellRes = await c.env.ASSETS.fetch(new Request(`${origin}/index.html`));
    if (!shellRes.ok) {
      return shellRes;
    }

    const renderRoute = await loadRouteRenderer();
    const rendered = await renderSsrDocument(c, await shellRes.text(), renderRoute);

    return new Response(rendered.html, {
      status: rendered.status,
      headers: documentResponseHeaders(),
    });
  };
}

export const handleDocumentNavigation = createDocumentNavigationHandler();
