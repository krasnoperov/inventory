import { Hono } from 'hono';
import type { AppContext } from './types';
import { authMiddleware } from '../middleware/auth-middleware';
import { MemberDAO } from '../../dao/member-dao';
import { SpaceDAO } from '../../dao/space-dao';
import { ClaudeService, type BotContext } from '../services/claudeService';
import { UsageService } from '../services/usageService';
import { MemoryService } from '../services/memoryService';
import { suggestionRateLimiter } from '../middleware/rate-limit';

const chatRoutes = new Hono<AppContext>();

// All chat routes require authentication
chatRoutes.use('*', authMiddleware);

// NOTE: POST /api/spaces/:id/chat has been removed.
// Chat is now handled via WebSocket chat:request messages through SpaceDO → ChatWorkflow.

// POST /api/spaces/:id/chat/suggest - Get prompt suggestion
chatRoutes.post('/api/spaces/:id/chat/suggest', suggestionRateLimiter, async (c) => {
  const userId = c.get('userId')!;
  const container = c.get('container');
  const memberDAO = container.get(MemberDAO);
  const spaceDAO = container.get(SpaceDAO);
  const usageService = container.get(UsageService);
  const env = c.env;

  const spaceId = c.req.param('id');
  const userIdStr = String(userId);

  // Verify user is member of space
  const member = await memberDAO.getMember(spaceId, userIdStr);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }

  // Get space details
  const space = await spaceDAO.getSpaceById(spaceId);
  if (!space) {
    return c.json({ error: 'Space not found' }, 404);
  }

  // Validate request body
  const body = await c.req.json();
  const { assetType, theme } = body;

  if (!assetType || !['character', 'item', 'scene', 'composite'].includes(assetType)) {
    return c.json({ error: 'Valid assetType is required' }, 400);
  }

  // Check Claude API key
  if (!env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'Bot assistant not configured' }, 503);
  }

  // Pre-check: quota + rate limit before making Claude API call
  const suggestPreCheck = await usageService.preCheck(userId, 'claude');
  if (!suggestPreCheck.allowed) {
    const statusCode = suggestPreCheck.denyReason === 'rate_limited' ? 429 : 402;
    return c.json({
      error: suggestPreCheck.denyReason === 'rate_limited' ? 'Rate limited' : 'Quota exceeded',
      message: suggestPreCheck.denyMessage,
      denyReason: suggestPreCheck.denyReason,
      quota: {
        used: suggestPreCheck.quotaUsed,
        limit: suggestPreCheck.quotaLimit,
        remaining: suggestPreCheck.quotaRemaining,
      },
      rateLimit: {
        used: suggestPreCheck.rateLimitUsed,
        limit: suggestPreCheck.rateLimitMax,
        remaining: suggestPreCheck.rateLimitRemaining,
        resetsAt: suggestPreCheck.rateLimitResetsAt?.toISOString() || null,
      },
    }, statusCode);
  }

  // Build context
  const context: BotContext = {
    spaceId,
    spaceName: space.name,
    assets: [],
    mode: 'advisor',
  };

  // Get prompt suggestion
  const claudeService = new ClaudeService(env.ANTHROPIC_API_KEY);
  const { suggestion, usage } = await claudeService.suggestPrompt(context, assetType, theme);

  // Track Claude API usage + increment rate limit
  Promise.all([
    usageService.trackClaudeUsage(userId, usage.inputTokens, usage.outputTokens, 'claude-sonnet-4-20250514'),
    usageService.incrementRateLimit(userId),
  ]).catch(err => console.warn('Failed to track Claude usage:', err));

  return c.json({
    success: true,
    suggestion,
  });
});

// NOTE: POST /api/spaces/:id/chat/describe has been removed.
// Describe is now handled via WebSocket describe:request messages through SpaceDO.

// NOTE: POST /api/spaces/:id/chat/compare has been removed.
// Compare is now handled via WebSocket compare:request messages through SpaceDO.

// GET /api/spaces/:id/chat/history - Get chat history
chatRoutes.get('/api/spaces/:id/chat/history', async (c) => {
  const userId = c.get('userId')!;
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;

  const spaceId = c.req.param('id');
  const userIdStr = String(userId);

  // Verify user is member of space
  const member = await memberDAO.getMember(spaceId, userIdStr);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }

  // Get chat history from DO
  if (!env.SPACES_DO) {
    return c.json({ error: 'Chat not available' }, 503);
  }

  const doId = env.SPACES_DO.idFromName(spaceId);
  const doStub = env.SPACES_DO.get(doId);

  const doResponse = await doStub.fetch(new Request('http://do/internal/chat/history', {
    method: 'GET',
  }));

  if (!doResponse.ok) {
    return c.json({ error: 'Failed to get chat history' }, 500);
  }

  const data = await doResponse.json();
  return c.json(data);
});

// DELETE /api/spaces/:id/chat/history - Clear chat history
chatRoutes.delete('/api/spaces/:id/chat/history', async (c) => {
  const userId = c.get('userId')!;
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;

  const spaceId = c.req.param('id');
  const userIdStr = String(userId);

  // Verify user is member of space
  const member = await memberDAO.getMember(spaceId, userIdStr);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }

  // Clear chat history in DO
  if (!env.SPACES_DO) {
    return c.json({ error: 'Chat not available' }, 503);
  }

  const doId = env.SPACES_DO.idFromName(spaceId);
  const doStub = env.SPACES_DO.get(doId);

  const doResponse = await doStub.fetch(new Request('http://do/internal/chat/history', {
    method: 'DELETE',
  }));

  if (!doResponse.ok) {
    return c.json({ error: 'Failed to clear chat history' }, 500);
  }

  return c.json({ success: true });
});

// POST /api/spaces/:id/chat/feedback - Record feedback on a variant
chatRoutes.post('/api/spaces/:id/chat/feedback', async (c) => {
  const userId = c.get('userId')!;
  const container = c.get('container');
  const memberDAO = container.get(MemberDAO);
  const memoryService = container.get(MemoryService);

  const spaceId = c.req.param('id');
  const userIdStr = String(userId);

  // Verify user is member of space
  const member = await memberDAO.getMember(spaceId, userIdStr);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }

  // Validate request body
  const body = await c.req.json();
  const { variantId, rating, prompt } = body as {
    variantId: string;
    rating: 'positive' | 'negative';
    prompt?: string;
  };

  if (!variantId || !rating) {
    return c.json({ error: 'variantId and rating are required' }, 400);
  }

  if (rating !== 'positive' && rating !== 'negative') {
    return c.json({ error: 'rating must be "positive" or "negative"' }, 400);
  }

  // Record feedback
  const feedbackId = await memoryService.recordFeedback({
    userId,
    variantId,
    rating,
    prompt,
  });

  return c.json({
    success: true,
    feedbackId,
  });
});

export { chatRoutes };
