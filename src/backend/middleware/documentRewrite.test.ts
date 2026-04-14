import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { handleDocumentNavigation } from './documentRewrite';
import type { AppContext } from '../routes/types';

const SHELL_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Inventory Forge</title>
    <meta name="description" content="Landing description." />
    <link rel="canonical" href="https://inventory.krasnoperov.me/" />
    <meta property="og:title" content="Inventory Forge" />
    <meta property="og:description" content="Landing og description." />
    <meta property="og:url" content="https://inventory.krasnoperov.me/" />
    <meta name="twitter:title" content="Inventory Forge" />
    <meta name="twitter:description" content="Landing twitter description." />
  </head>
  <body><div id="root"></div></body>
</html>`;

function buildApp() {
  const app = new Hono<AppContext>();
  app.use('*', async (c, next) => {
    // Stub ASSETS binding — returns the shell HTML for /index.html, 404 otherwise.
    const fakeAssets: { fetch: (req: Request) => Promise<Response> } = {
      fetch: async (req: Request) => {
        const u = new URL(req.url);
        if (u.pathname === '/index.html') {
          return new Response(SHELL_HTML, {
            status: 200,
            headers: { 'content-type': 'text/html' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    };
    c.env = { ASSETS: fakeAssets } as unknown as AppContext['Bindings'];
    await next();
  });
  app.all('*', handleDocumentNavigation);
  return app;
}

describe('handleDocumentNavigation', () => {
  it('serves rewritten shell with 200 for known SPA route (/login)', async () => {
    const app = buildApp();
    const res = await app.fetch(new Request('https://app.example/login', {
      headers: { accept: 'text/html' },
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.text();
    assert.match(body, /<title>Sign in \| Inventory Forge<\/title>/);
    assert.match(body, /name="description" content="Sign in to Inventory Forge with your Google account\."/);
    assert.match(body, /rel="canonical" href="https:\/\/app\.example\/login"/);
    assert.match(body, /property="og:url" content="https:\/\/app\.example\/login"/);
  });

  it('returns 404 with not-found meta for unknown path', async () => {
    const app = buildApp();
    const res = await app.fetch(new Request('https://app.example/does-not-exist', {
      headers: { accept: 'text/html' },
    }));
    assert.strictEqual(res.status, 404);
    const body = await res.text();
    assert.match(body, /<title>Not found \| Inventory Forge<\/title>/);
    assert.match(body, /name="robots" content="noindex,nofollow"/);
  });

  it('injects noindex robots meta for authed routes', async () => {
    const app = buildApp();
    const res = await app.fetch(new Request('https://app.example/dashboard', {
      headers: { accept: 'text/html' },
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.text();
    assert.match(body, /name="robots" content="noindex,nofollow"/);
  });

  it('matches parameterised space + asset routes', async () => {
    const app = buildApp();
    const res = await app.fetch(new Request('https://app.example/spaces/abc/assets/xyz', {
      headers: { accept: 'text/html' },
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.text();
    assert.match(body, /<title>Asset \| Inventory Forge<\/title>/);
  });

  it('301-redirects trailing-slash document paths to canonical non-slash form', async () => {
    const app = buildApp();
    const res = await app.fetch(new Request('https://app.example/login/?next=x', {
      headers: { accept: 'text/html' },
      redirect: 'manual',
    }));
    assert.strictEqual(res.status, 301);
    assert.strictEqual(res.headers.get('location'), 'https://app.example/login?next=x');
  });

  it('root `/` is not redirected', async () => {
    const app = buildApp();
    const res = await app.fetch(new Request('https://app.example/', {
      headers: { accept: 'text/html' },
    }));
    assert.strictEqual(res.status, 200);
  });

  it('delegates non-document requests straight to ASSETS', async () => {
    const app = buildApp();
    const res = await app.fetch(new Request('https://app.example/assets/main.js', {
      headers: { accept: 'application/javascript' },
    }));
    // Our stub ASSETS returns 404 for anything that isn't /index.html —
    // the middleware should pass the request through rather than rewriting it.
    assert.strictEqual(res.status, 404);
    const body = await res.text();
    assert.strictEqual(body, 'not found');
  });

  it('passes .txt files through to ASSETS even with text/html Accept', async () => {
    // Stub ASSETS that serves /llms.txt successfully.
    const app = new Hono<AppContext>();
    app.use('*', async (c, next) => {
      const fakeAssets = {
        fetch: async (req: Request) => {
          const u = new URL(req.url);
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
    app.all('*', handleDocumentNavigation);

    const res = await app.fetch(new Request('https://app.example/llms.txt', {
      headers: { accept: 'text/html,application/xhtml+xml,*/*' },
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'text/plain');
    const body = await res.text();
    assert.strictEqual(body, '# Inventory Forge');
  });
});
