import { Hono } from 'hono';
import type { AppContext } from './types';
import { authMiddleware } from '../middleware/auth-middleware';
import { SyncService } from '../services/syncService';

const searchRoutes = new Hono<AppContext>();

// All search routes require authentication
searchRoutes.use('*', authMiddleware);

// GET /api/search/assets - Search assets across user's spaces
searchRoutes.get('/api/search/assets', async (c) => {
  const userId = String(c.get('userId')!);
  const env = c.env;

  // Get query parameters
  const query = c.req.query('q') || '';
  const type = c.req.query('type');
  const limitParam = c.req.query('limit');
  const offsetParam = c.req.query('offset');

  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 100) : 20;
  const offset = offsetParam ? parseInt(offsetParam, 10) : 0;

  // Search assets
  const syncService = new SyncService(env);
  const results = await syncService.searchAssets(userId, query, {
    type: type || undefined,
    limit,
    offset,
  });

  return c.json({
    success: true,
    results,
    pagination: {
      limit,
      offset,
      hasMore: results.length === limit,
    },
  });
});

// POST /api/admin/sync - Trigger manual sync (admin only)
searchRoutes.post('/api/admin/sync', async (c) => {
  const env = c.env;

  // For MVP, any authenticated user can trigger sync
  // In production, add admin role check

  // Run sync
  const syncService = new SyncService(env);
  const result = await syncService.syncAllSpaces();

  return c.json({
    success: true,
    synced: result.synced,
    errors: result.errors,
  });
});

// POST /api/spaces/:id/sync - Sync a specific space
searchRoutes.post('/api/spaces/:id/sync', async (c) => {
  const env = c.env;
  const spaceId = c.req.param('id');

  // Run sync for specific space
  const syncService = new SyncService(env);
  await syncService.syncSpace(spaceId);

  return c.json({
    success: true,
    message: 'Space synced successfully',
  });
});

export { searchRoutes };
