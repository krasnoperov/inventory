import { Hono } from 'hono';
import { CONTENT_MAP, LLMS_FULL_TXT, LLMS_TXT } from '../content-map';
import { DOC_REGISTRY } from '../../shared/content/content-registry';
import type { AppContext } from './types';

export const contentRoutes = new Hono<AppContext>();

const TEXT_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'public, max-age=300',
};

contentRoutes.get('/llms.txt', (c) => c.text(LLMS_TXT, 200, TEXT_HEADERS));
contentRoutes.get('/llms-full.txt', (c) => c.text(LLMS_FULL_TXT, 200, TEXT_HEADERS));

contentRoutes.get('/docs.md', (c) => c.text(CONTENT_MAP['/docs'], 200, TEXT_HEADERS));

for (const entry of DOC_REGISTRY) {
  contentRoutes.get(`${entry.path}.md`, (c) => {
    const content = CONTENT_MAP[entry.path];
    if (!content) return c.notFound();
    return c.text(content, 200, TEXT_HEADERS);
  });
}
