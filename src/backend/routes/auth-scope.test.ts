import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Handler } from 'hono';
import { registerRoutes } from './index';
import type { AppContext } from './types';
import { createOpenApiRouter } from './openapi';

// Stub document handler standing in for the real TanStack Start SSR renderer:
// it reproduces only the static-vs-document split (documents → 200 HTML,
// everything else → ASSETS) so these tests exercise route auth scoping without
// booting the SSR bundle.
const documentStub: Handler<AppContext> = async (c) => {
  const url = new URL(c.req.url);
  const accept = c.req.header('accept') ?? '';
  const isDocument =
    (c.req.method === 'GET' || c.req.method === 'HEAD') &&
    accept.includes('text/html') &&
    !/\.[a-z0-9]+$/i.test(url.pathname);

  if (!isDocument) {
    return c.env.ASSETS.fetch(c.req.raw);
  }

  return new Response(`<main>${url.pathname}</main>`, {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
};

// Build the real app exactly as the worker wires it: a container + ASSETS
// binding, then every route group via registerRoutes. The container only ever
// needs to answer `.get()` without throwing — auth middleware rejects on the
// missing token before it touches any service.
function buildApp() {
  const app = createOpenApiRouter();
  app.use('*', async (c, next) => {
    const fakeAssets = {
      fetch: async (req: Request) => {
        const u = new URL(req.url);
        if (u.pathname === '/favicon.ico') {
          return new Response('icon', {
            status: 200,
            headers: { 'content-type': 'image/x-icon' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    };
    c.env = { ASSETS: fakeAssets } as unknown as AppContext['Bindings'];
    c.set('container', { get: () => ({}) } as never);
    await next();
  });
  registerRoutes(app, documentStub);
  return app;
}

function get(app: ReturnType<typeof createOpenApiRouter>, path: string, accept = 'text/html') {
  return app.fetch(new Request(`https://app.example${path}`, { headers: { accept } }));
}

describe('route auth scoping', () => {
  // Regression: auth middleware registered as `.use('*', authMiddleware)` on a
  // sub-app mounted at '/' leaks onto every path, so the landing page,
  // document routes and static assets all returned 401 and the whole site went dark.
  it('does not gate the landing page', async () => {
    const res = await get(buildApp(), '/');
    assert.notStrictEqual(res.status, 401);
    assert.strictEqual(res.status, 200);
  });

  it('does not gate public document routes (/login)', async () => {
    const res = await get(buildApp(), '/login');
    assert.notStrictEqual(res.status, 401);
    assert.strictEqual(res.status, 200);
  });

  it('does not gate static assets (/favicon.ico)', async () => {
    const res = await get(buildApp(), '/favicon.ico', 'image/x-icon');
    assert.notStrictEqual(res.status, 401);
    assert.strictEqual(res.status, 200);
  });

  // The flip side: protected API routes must still require a token, including
  // the bare `/api/spaces` collection endpoint (no trailing segment).
  for (const path of [
    '/api/user/profile',
    '/api/users/me/preferences',
    '/api/spaces',
    '/api/spaces/abc',
    '/api/spaces/abc/access',
    '/api/spaces/abc/sharing',
    '/api/spaces/abc/access-requests',
    '/api/spaces/abc/invitations',
    '/api/spaces/abc/members',
    '/api/spaces/abc/export',
    '/api/spaces/abc/variants/variant-1/media',
    '/api/spaces/abc/variants/variant-1/poster',
  ]) {
    it(`still requires auth for ${path}`, async () => {
      const res = await get(buildApp(), path, 'application/json');
      assert.strictEqual(res.status, 401);
    });
  }
});
