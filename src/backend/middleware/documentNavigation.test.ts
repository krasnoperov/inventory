import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import {
  createDocumentNavigationHandler,
  documentResponseHeaders,
  type RouteRenderer,
} from './documentNavigation';
import type { AppContext } from '../routes/types';
import type { FetchLike } from '../../shared/api/client';

const SHELL_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Inventory Forge</title>
    <meta name="description" content="Landing description." />
  </head>
  <body><div id="root"></div></body>
</html>`;

const renderRoute: RouteRenderer = async (request) => {
  const url = new URL(request.url);
  return {
    html: `<main data-path="${url.pathname}">SSR ${url.pathname}</main>`,
    status: url.pathname === '/does-not-exist' ? 404 : 200,
  };
};

function buildApp() {
  const app = new Hono<AppContext>();
  app.use('*', async (c, next) => {
    const fakeAssets: { fetch: (req: Request) => Promise<Response> } = {
      fetch: async (req: Request) => {
        const u = new URL(req.url);
        if (u.pathname === '/index.html') {
          return new Response(SHELL_HTML, {
            status: 200,
            headers: { 'content-type': 'text/html' },
          });
        }
        if (u.pathname === '/llms.txt') {
          return new Response('# Inventory Forge', {
            status: 200,
            headers: { 'content-type': 'text/plain' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    };
    c.env = { ASSETS: fakeAssets } as unknown as AppContext['Bindings'];
    await next();
  });
  app.all('*', createDocumentNavigationHandler(async () => renderRoute));
  return app;
}

describe('handleDocumentNavigation', () => {
  it('serves SSR document HTML for document navigations', async () => {
    const res = await buildApp().fetch(new Request('https://app.example/login', {
      headers: { accept: 'text/html' },
    }));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('cache-control'), 'private, no-store');
    assert.strictEqual(res.headers.get('x-inventory-ssr'), 'tanstack-router');

    const body = await res.text();
    assert.match(body, /data-inventory-ssr="tanstack-router"/);
    assert.match(body, /<div id="root"><main data-path="\/login">SSR \/login<\/main><\/div>/);
    assert.match(body, /window\.__INVENTORY_START_SESSION__=/);
  });

  it('uses the TanStack renderer status for unknown routes', async () => {
    const res = await buildApp().fetch(new Request('https://app.example/does-not-exist', {
      headers: { accept: 'text/html' },
    }));

    assert.strictEqual(res.status, 404);
    const body = await res.text();
    assert.match(body, /SSR \/does-not-exist/);
  });

  it('301-redirects trailing-slash document paths to canonical non-slash form', async () => {
    const res = await buildApp().fetch(new Request('https://app.example/login/?next=x', {
      headers: { accept: 'text/html' },
      redirect: 'manual',
    }));

    assert.strictEqual(res.status, 301);
    assert.strictEqual(res.headers.get('location'), 'https://app.example/login?next=x');
  });

  it('delegates non-document requests straight to ASSETS', async () => {
    const res = await buildApp().fetch(new Request('https://app.example/assets/main.js', {
      headers: { accept: 'application/javascript' },
    }));

    assert.strictEqual(res.status, 404);
    assert.strictEqual(await res.text(), 'not found');
  });

  it('passes static files through to ASSETS even with text/html Accept', async () => {
    const res = await buildApp().fetch(new Request('https://app.example/llms.txt', {
      headers: { accept: 'text/html,application/xhtml+xml,*/*' },
    }));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'text/plain');
    assert.strictEqual(await res.text(), '# Inventory Forge');
  });

  it('marks document responses private and no-store', () => {
    const headers = new Headers(documentResponseHeaders());
    assert.strictEqual(headers.get('cache-control'), 'private, no-store');
    assert.strictEqual(headers.get('x-inventory-ssr'), 'tanstack-router');
  });
});

describe('handleDocumentNavigation — SSR redirects & in-process fetch', () => {
  function buildAppWith(renderer: RouteRenderer, serverFetch?: FetchLike) {
    const app = new Hono<AppContext>();
    app.use('*', async (c, next) => {
      const fakeAssets = {
        fetch: async (req: Request) => {
          const u = new URL(req.url);
          if (u.pathname === '/index.html') {
            return new Response(SHELL_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
          }
          return new Response('not found', { status: 404 });
        },
      };
      c.env = { ASSETS: fakeAssets } as unknown as AppContext['Bindings'];
      if (serverFetch) c.set('serverFetch', serverFetch);
      await next();
    });
    app.all('*', createDocumentNavigationHandler(async () => renderer));
    return app;
  }

  it('forwards a beforeLoad redirect as a real redirect, preserving Location', async () => {
    // Regression: a 307 from an auth-guard redirect was wrapped in the shell
    // with Location dropped, breaking unauthenticated deep links (hydration
    // mismatch → "Something went wrong").
    const app = buildAppWith(async () => ({ html: '', status: 307, headers: { location: '/login' } }));
    const res = await app.fetch(new Request('https://app.example/dashboard', {
      headers: { accept: 'text/html' },
      redirect: 'manual',
    }));

    assert.strictEqual(res.status, 307);
    assert.strictEqual(res.headers.get('location'), '/login');
    assert.strictEqual((await res.text()).length, 0);
  });

  it('threads the in-process serverFetch through to the renderer', async () => {
    // Regression: authed loaders self-fetched the worker origin during SSR and
    // 500'd; SSR must run them against an in-process dispatcher instead.
    let received: FetchLike | undefined;
    const sentinel: FetchLike = async () => new Response('ok');
    const app = buildAppWith(async (_req, _session, serverFetch) => {
      received = serverFetch;
      return { html: '<main/>', status: 200 };
    }, sentinel);

    await app.fetch(new Request('https://app.example/', { headers: { accept: 'text/html' } }));
    assert.strictEqual(received, sentinel);
  });
});
