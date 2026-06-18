import { Hono } from 'hono';
import { DOC_REGISTRY } from '../../shared/content/content-registry';
import type { AppContext } from './types';

export const contentRoutes = new Hono<AppContext>();

const TEXT_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'public, max-age=300',
};

async function loadContentMap() {
  return import('../content-map');
}

contentRoutes.get('/llms.txt', async (c) => {
  const { LLMS_TXT } = await loadContentMap();
  return c.text(LLMS_TXT, 200, TEXT_HEADERS);
});

contentRoutes.get('/llms-full.txt', async (c) => {
  const { LLMS_FULL_TXT } = await loadContentMap();
  return c.text(LLMS_FULL_TXT, 200, TEXT_HEADERS);
});

contentRoutes.get('/docs.md', async (c) => {
  const { CONTENT_MAP } = await loadContentMap();
  return c.text(CONTENT_MAP['/docs'], 200, TEXT_HEADERS);
});

for (const entry of DOC_REGISTRY) {
  contentRoutes.get(`${entry.path}.md`, async (c) => {
    const { CONTENT_MAP } = await loadContentMap();
    const content = CONTENT_MAP[entry.path];
    if (!content) return c.notFound();
    return c.text(content, 200, TEXT_HEADERS);
  });
}
