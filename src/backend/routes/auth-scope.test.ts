import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerRoutes } from './index';
import type { AppContext } from './types';
import { createOpenApiRouter } from './openapi';
import { createDocumentNavigationHandler, type RouteRenderer } from '../middleware/documentNavigation';

// Minimal index.html shell so document navigation has something to hydrate.
const SHELL_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Inventory Forge</title>
    <meta name="description" content="Landing description." />
  </head>
  <body><div id="root"></div></body>
</html>`;

const renderRoute: RouteRenderer = async (request) => ({
  html: `<main>${new URL(request.url).pathname}</main>`,
  status: 200,
});

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
        if (u.pathname === '/index.html') {
          return new Response(SHELL_HTML, {
            status: 200,
            headers: { 'content-type': 'text/html' },
          });
        }
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
  registerRoutes(app, createDocumentNavigationHandler(async () => renderRoute));
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
