import { Hono } from 'hono';
import type { AppContext } from './types';

const websocketRoutes = new Hono<AppContext>();

// GET /api/spaces/:id/ws - WebSocket upgrade endpoint
websocketRoutes.get('/api/spaces/:id/ws', async (c) => {
  try {
    const spaceId = c.req.param('id');
    const env = c.env;

    // Get the SPACES_DO binding
    if (!env.SPACES_DO) {
      return c.json({ error: 'WebSocket support not available' }, 503);
    }

    // Create DO stub using spaceId as the ID
    const id = env.SPACES_DO.idFromName(spaceId);
    const stub = env.SPACES_DO.get(id);

    // Forward the entire request to the DO
    // The DO handles auth and WebSocket upgrade
    return await stub.fetch(c.req.raw);
  } catch (error) {
    console.error('Error proxying to SpaceDO:', error);
    return c.json({ error: 'Failed to establish WebSocket connection' }, 500);
  }
});

export { websocketRoutes };
