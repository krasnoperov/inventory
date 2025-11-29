import { Hono } from 'hono';
import type { AppContext } from './types';
import { AuthService } from '../features/auth/auth-service';
import { getAuthToken } from '../auth';
import { MemoryService } from '../services/memoryService';

const memoryRoutes = new Hono<AppContext>();

// =============================================================================
// USER PATTERNS
// =============================================================================

// GET /api/users/me/patterns - Get user's learned patterns
memoryRoutes.get('/api/users/me/patterns', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const memoryService = container.get(MemoryService);

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

    const patterns = await memoryService.getUserPatterns(payload.userId);

    return c.json({
      success: true,
      patterns: patterns.map(p => ({
        id: p.id,
        assetType: p.asset_type,
        promptText: p.prompt_text,
        successCount: p.success_count,
        totalUses: p.total_uses,
        styleTags: p.style_tags ? JSON.parse(p.style_tags) : [],
        lastUsedAt: p.last_used_at,
        createdAt: p.created_at,
        spaceId: p.space_id,
      })),
    });
  } catch (error) {
    console.error('Error getting user patterns:', error);
    return c.json({ error: 'Failed to get patterns' }, 500);
  }
});

// DELETE /api/users/me/patterns/:id - Delete (forget) a pattern
memoryRoutes.delete('/api/users/me/patterns/:id', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const memoryService = container.get(MemoryService);

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

    const patternId = c.req.param('id');
    const deleted = await memoryService.deletePattern(payload.userId, patternId);

    if (!deleted) {
      return c.json({ error: 'Pattern not found' }, 404);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('Error deleting pattern:', error);
    return c.json({ error: 'Failed to delete pattern' }, 500);
  }
});

// =============================================================================
// USER PREFERENCES
// =============================================================================

// GET /api/users/me/preferences - Get user preferences
memoryRoutes.get('/api/users/me/preferences', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const memoryService = container.get(MemoryService);

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

    const preferences = await memoryService.getPreferences(payload.userId);

    return c.json({
      success: true,
      preferences: {
        defaultArtStyle: preferences.default_art_style,
        defaultAspectRatio: preferences.default_aspect_ratio,
        autoExecuteSafe: preferences.auto_execute_safe,
        autoApproveLowCost: preferences.auto_approve_low_cost,
        injectPatterns: preferences.inject_patterns,
        maxPatternsContext: preferences.max_patterns_context,
      },
    });
  } catch (error) {
    console.error('Error getting user preferences:', error);
    return c.json({ error: 'Failed to get preferences' }, 500);
  }
});

// PUT /api/users/me/preferences - Update user preferences
memoryRoutes.put('/api/users/me/preferences', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const memoryService = container.get(MemoryService);

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

    const body = await c.req.json();
    const {
      defaultArtStyle,
      defaultAspectRatio,
      autoExecuteSafe,
      autoApproveLowCost,
      injectPatterns,
      maxPatternsContext,
    } = body as {
      defaultArtStyle?: string | null;
      defaultAspectRatio?: string | null;
      autoExecuteSafe?: boolean;
      autoApproveLowCost?: boolean;
      injectPatterns?: boolean;
      maxPatternsContext?: number;
    };

    // Build update object with only provided fields
    const updates: Parameters<typeof memoryService.updatePreferences>[1] = {};

    if (defaultArtStyle !== undefined) updates.default_art_style = defaultArtStyle;
    if (defaultAspectRatio !== undefined) updates.default_aspect_ratio = defaultAspectRatio;
    if (autoExecuteSafe !== undefined) updates.auto_execute_safe = autoExecuteSafe;
    if (autoApproveLowCost !== undefined) updates.auto_approve_low_cost = autoApproveLowCost;
    if (injectPatterns !== undefined) updates.inject_patterns = injectPatterns;
    if (maxPatternsContext !== undefined) {
      // Validate range
      if (maxPatternsContext < 0 || maxPatternsContext > 20) {
        return c.json({ error: 'maxPatternsContext must be between 0 and 20' }, 400);
      }
      updates.max_patterns_context = maxPatternsContext;
    }

    await memoryService.updatePreferences(payload.userId, updates);

    return c.json({ success: true });
  } catch (error) {
    console.error('Error updating user preferences:', error);
    return c.json({ error: 'Failed to update preferences' }, 500);
  }
});

// =============================================================================
// FEEDBACK STATS
// =============================================================================

// GET /api/users/me/feedback/stats - Get feedback statistics
memoryRoutes.get('/api/users/me/feedback/stats', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const memoryService = container.get(MemoryService);

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

    const stats = await memoryService.getFeedbackStats(payload.userId);

    return c.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('Error getting feedback stats:', error);
    return c.json({ error: 'Failed to get feedback stats' }, 500);
  }
});

export { memoryRoutes };
