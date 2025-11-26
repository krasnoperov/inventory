import { Hono } from 'hono';
import type { AppContext } from './types';
import { AuthService } from '../features/auth/auth-service';
import { getAuthToken } from '../auth';
import { SyncService } from '../services/syncService';

const searchRoutes = new Hono<AppContext>();

// GET /api/search/assets - Search assets across user's spaces
searchRoutes.get('/api/search/assets', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const env = c.env;

    // Check authentication
    const cookieHeader = c.req.header("Cookie");
    const token = getAuthToken(cookieHeader || null);

    if (!token) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const payload = await authService.verifyJWT(token);
    if (!payload) {
      return c.json({ error: 'Invalid authentication' }, 401);
    }

    const userId = String(payload.userId);

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
  } catch (error) {
    console.error('Error searching assets:', error);
    return c.json({ error: 'Failed to search assets' }, 500);
  }
});

// POST /api/admin/sync - Trigger manual sync (admin only)
searchRoutes.post('/api/admin/sync', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const env = c.env;

    // Check authentication
    const cookieHeader = c.req.header("Cookie");
    const token = getAuthToken(cookieHeader || null);

    if (!token) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const payload = await authService.verifyJWT(token);
    if (!payload) {
      return c.json({ error: 'Invalid authentication' }, 401);
    }

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
  } catch (error) {
    console.error('Error running sync:', error);
    return c.json({ error: 'Failed to run sync' }, 500);
  }
});

// POST /api/spaces/:id/sync - Sync a specific space
searchRoutes.post('/api/spaces/:id/sync', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const env = c.env;

    // Check authentication
    const cookieHeader = c.req.header("Cookie");
    const token = getAuthToken(cookieHeader || null);

    if (!token) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const payload = await authService.verifyJWT(token);
    if (!payload) {
      return c.json({ error: 'Invalid authentication' }, 401);
    }

    const spaceId = c.req.param('id');

    // Run sync for specific space
    const syncService = new SyncService(env);
    await syncService.syncSpace(spaceId);

    return c.json({
      success: true,
      message: 'Space synced successfully',
    });
  } catch (error) {
    console.error('Error syncing space:', error);
    return c.json({ error: 'Failed to sync space' }, 500);
  }
});

export { searchRoutes };
