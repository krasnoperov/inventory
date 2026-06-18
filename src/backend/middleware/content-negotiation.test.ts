import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { contentNegotiationWithRenderer } from './content-negotiation';
import type { AppContext } from '../routes/types';

const content = {
  CONTENT_MAP: {
    '/': '# Home\n\nAgent home.',
    '/docs': '# Quickstart\n\nAgent docs.',
    '/docs/cli': '# CLI\n\nAgent CLI docs.',
  },
  LLMS_TXT: '# LLM index',
  LLMS_FULL_TXT: '# Full LLM context',
};

function buildApp() {
  const calls: string[] = [];
  const app = new Hono<AppContext>();
  app.use(
    '*',
    contentNegotiationWithRenderer(
      async (c: Context<AppContext>) => {
        calls.push(new URL(c.req.url).pathname);
        return new Response(`<main>${new URL(c.req.url).pathname}</main>`, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      },
      async () => content,
    ),
  );
  return { app, calls };
}

function get(app: Hono<AppContext>, path: string, accept = '*/*') {
  return app.fetch(new Request(`https://makefx.app${path}`, { headers: { accept } }));
}

describe('contentNegotiation', () => {
  it('renders public HTML pages for generic agent requests and advertises markdown alternates', async () => {
    const { app, calls } = buildApp();

    const res = await get(app, '/');
    const body = await res.text();

    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    assert.match(body, /<main>\/<\/main>/);
    assert.match(res.headers.get('link') ?? '', /rel="alternate"; type="text\/markdown"/);
    assert.match(res.headers.get('link') ?? '', /rel="llms-txt"/);
    assert.equal(res.headers.get('vary'), 'Accept');
    assert.equal(res.headers.get('x-llms-txt'), '/llms.txt');
    assert.deepEqual(calls, ['/']);
  });

  it('serves markdown when canonical docs URLs request text markdown', async () => {
    const { app, calls } = buildApp();

    const res = await get(app, '/docs', 'text/markdown');
    const body = await res.text();

    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/markdown/);
    assert.match(body, /^# Quickstart/);
    assert.match(res.headers.get('link') ?? '', /<https:\/\/makefx\.app\/docs>; rel="canonical"/);
    assert.equal(res.headers.get('x-llms-txt'), '/llms.txt');
    assert.deepEqual(calls, []);
  });

  it('serves explicit markdown URLs with canonical links', async () => {
    const { app } = buildApp();

    const res = await get(app, '/docs/cli.md');
    const body = await res.text();

    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/markdown/);
    assert.match(body, /^# CLI/);
    assert.match(res.headers.get('link') ?? '', /<https:\/\/makefx\.app\/docs\/cli>; rel="canonical"/);
  });

  it('serves llms and well-known agent discovery endpoints', async () => {
    const { app } = buildApp();

    const llms = await get(app, '/llms.txt');
    assert.equal(llms.status, 200);
    assert.equal(await llms.text(), '# LLM index');

    const card = await get(app, '/.well-known/agent-card.json');
    assert.equal(card.status, 200);
    assert.equal(card.headers.get('content-type'), 'application/json');
    assert.equal((await card.json() as { preferred_cli?: string }).preferred_cli, 'makefx');

    const skills = await get(app, '/.well-known/agent-skills/index.json');
    assert.equal(skills.status, 200);
    assert.equal(skills.headers.get('content-type'), 'application/json');
    assert.ok(Array.isArray((await skills.json() as { skills?: unknown[] }).skills));
  });

  it('falls through for non-public API paths', async () => {
    const { app, calls } = buildApp();

    const res = await get(app, '/api/nope');

    assert.equal(res.status, 404);
    assert.deepEqual(calls, []);
  });
});
