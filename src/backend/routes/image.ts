import { Hono } from 'hono';
import type { AppContext } from './types';

const imageRoutes = new Hono<AppContext>();

// GET /api/images/* - Serve image from R2
// Key can contain slashes, e.g., images/spaceId/variantId.png
imageRoutes.get('/api/images/*', async (c) => {
  try {
    const env = c.env;
    // Get the full path after /api/images/
    const key = c.req.path.replace('/api/images/', '');

    if (!env.IMAGES) {
      return c.json({ error: 'Image storage not configured' }, 503);
    }

    // Get object from R2
    const object = await env.IMAGES.get(key);
    if (!object) {
      return c.json({ error: 'Image not found' }, 404);
    }

    // Get content type from metadata or infer from key
    const contentType = object.httpMetadata?.contentType || 'image/png';

    // Set cache headers - images are immutable by key
    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('ETag', object.httpEtag);

    // Handle conditional requests
    const ifNoneMatch = c.req.header('If-None-Match');
    if (ifNoneMatch === object.httpEtag) {
      return new Response(null, { status: 304, headers });
    }

    return new Response(object.body, { headers });
  } catch (error) {
    console.error('Error serving image:', error);
    return c.json({ error: 'Failed to serve image' }, 500);
  }
});

export { imageRoutes };
