import { Hono } from 'hono';
import type { AppContext } from './types';
import { authMiddleware } from '../middleware/auth-middleware';
import { MemoryService } from '../services/memoryService';

const memoryRoutes = new Hono<AppContext>();

// All memory routes require authentication
memoryRoutes.use('*', authMiddleware);

// =============================================================================
// USER PATTERNS
// =============================================================================

// GET /api/users/me/patterns - Get user's learned patterns
memoryRoutes.get('/api/users/me/patterns', async (c) => {
  const userId = c.get('userId')!;
  const memoryService = c.get('container').get(MemoryService);

  const patterns = await memoryService.getUserPatterns(userId);

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
});

// DELETE /api/users/me/patterns/:id - Delete (forget) a pattern
memoryRoutes.delete('/api/users/me/patterns/:id', async (c) => {
  const userId = c.get('userId')!;
  const memoryService = c.get('container').get(MemoryService);

  const patternId = c.req.param('id');
  const deleted = await memoryService.deletePattern(userId, patternId);

  if (!deleted) {
    return c.json({ error: 'Pattern not found' }, 404);
  }

  return c.json({ success: true });
});

// =============================================================================
// USER PREFERENCES
// =============================================================================

// GET /api/users/me/preferences - Get user preferences
memoryRoutes.get('/api/users/me/preferences', async (c) => {
  const userId = c.get('userId')!;
  const memoryService = c.get('container').get(MemoryService);

  const preferences = await memoryService.getPreferences(userId);

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
});

// PUT /api/users/me/preferences - Update user preferences
memoryRoutes.put('/api/users/me/preferences', async (c) => {
  const userId = c.get('userId')!;
  const memoryService = c.get('container').get(MemoryService);

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

  await memoryService.updatePreferences(userId, updates);

  return c.json({ success: true });
});

// =============================================================================
// FEEDBACK STATS
// =============================================================================

// GET /api/users/me/feedback/stats - Get feedback statistics
memoryRoutes.get('/api/users/me/feedback/stats', async (c) => {
  const userId = c.get('userId')!;
  const memoryService = c.get('container').get(MemoryService);

  const stats = await memoryService.getFeedbackStats(userId);

  return c.json({
    success: true,
    stats,
  });
});

export { memoryRoutes };
