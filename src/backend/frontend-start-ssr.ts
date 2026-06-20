import type { Context } from 'hono';
// Virtual entry: the TanStack Start + @cloudflare/vite-plugin integration bundles
// the SSR server into this worker (dev and build), so the React app shares the
// worker runtime and bindings instead of being imported from a prebuilt artifact.
import startServer from '@tanstack/react-start/server-entry';
import { AuthHandler } from './features/auth/auth-handler';
import type { AppContext } from './routes/types';
import type { AuthSessionResponse } from '../shared/api/schemas';
import type { StartServerContext } from '../frontend/app-context';
import { isFeatureFlagEnabled } from '../shared/featureFlags';

function looksLikeStaticFile(pathname: string): boolean {
  return /\.[a-z0-9]+$/i.test(pathname);
}

function isDocumentNavigation(c: Context<AppContext>): boolean {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return false;
  const accept = c.req.header('accept') ?? '';
  return accept.includes('text/html');
}

async function resolveStartSession(c: Context<AppContext>): Promise<AuthSessionResponse> {
  const baseSession: AuthSessionResponse = {
    user: null,
    config: {
      googleClientId: c.env.GOOGLE_CLIENT_ID || '',
      environment: c.env.ENVIRONMENT || 'development',
      features: {
        rotation: isFeatureFlagEnabled(c.env.MAKEFX_ROTATION_ENABLED),
      },
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

export type StartRenderOptions = {
  forceDocument?: boolean;
};

/**
 * Catch-all document handler. Static-asset and non-HTML requests go straight to
 * the ASSETS binding; document navigations are server-rendered by TanStack Start
 * inside this worker. Start renders the full document (including per-route CSS
 * <link>s via <HeadContent/>), so there is no hand-rolled shell and no flash of
 * unstyled content. A redirect thrown by a route `beforeLoad` (e.g. auth guard →
 * /login) is emitted natively by Start as a real 3xx with its Location intact.
 */
export async function renderStartApp(
  c: Context<AppContext>,
  options: StartRenderOptions = {},
): Promise<Response> {
  const url = new URL(c.req.url);

  if (looksLikeStaticFile(url.pathname) || (!options.forceDocument && !isDocumentNavigation(c))) {
    return c.env.ASSETS.fetch(c.req.raw);
  }

  // Canonicalise trailing slashes (except root) before rendering.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    const canonical = url.pathname.replace(/\/+$/, '');
    return Response.redirect(`${url.origin}${canonical}${url.search}`, 301);
  }

  const session = await resolveStartSession(c);
  const serverFetch = c.get('serverFetch');

  const startContext: StartServerContext = {
    // In-process worker dispatch: SSR loaders call this instead of fetching the
    // public origin, which 500s under run_worker_first (self-subrequest).
    apiFetch: serverFetch,
    bootstrap: {
      session: {
        config: {
          googleClientId: session.config.googleClientId || '',
          environment: session.config.environment,
          features: session.config.features,
        },
        user: session.user ?? null,
      },
    },
    requestMeta: {
      origin: url.origin,
      pathname: url.pathname,
      search: url.search,
      cookieHeader: c.req.header('Cookie') ?? undefined,
    },
  };

  const response = await startServer.fetch(c.req.raw, {
    // The virtual server-entry types `context` as an opaque BaseContext; our
    // StartServerContext is the actual contract the root route reads back.
    context: startContext as unknown as Record<string, unknown>,
  });

  // Documents carry private session state — never cache.
  const out = new Response(response.body, response);
  if ((out.headers.get('content-type') ?? '').includes('text/html')) {
    out.headers.set('cache-control', 'private, no-store');
    out.headers.set('x-inventory-ssr', 'tanstack-start');
  }
  return out;
}
