import { Hono } from 'hono';
import type { AppContext } from './types';
import { AuthService } from '../features/auth/auth-service';
import { MemberDAO } from '../../dao/member-dao';
import { SpaceDAO } from '../../dao/space-dao';
import { getAuthToken } from '../auth';
import { ClaudeService, type BotContext, type ChatMessage, type ForgeContext, type ViewingContext } from '../services/claudeService';
import { UsageService } from '../services/usageService';
import { chatRateLimiter, suggestionRateLimiter } from '../middleware/rate-limit';
import { arrayBufferToBase64, detectImageType } from '../utils/image-utils';

const chatRoutes = new Hono<AppContext>();

// POST /api/spaces/:id/chat - Send chat message to bot
chatRoutes.post('/api/spaces/:id/chat', chatRateLimiter, async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const memberDAO = container.get(MemberDAO);
    const spaceDAO = container.get(SpaceDAO);
    const usageService = container.get(UsageService);
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
    const userId = String(payload.userId);

    // Verify user is member of space
    const member = await memberDAO.getMember(spaceId, userId);
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
    const {
      message,
      mode = 'advisor',
      history = [],
      forgeContext,
      viewingContext,
    } = body as {
      message: string;
      mode?: string;
      history?: ChatMessage[];
      forgeContext?: ForgeContext;
      viewingContext?: ViewingContext;
    };

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return c.json({ error: 'Message is required' }, 400);
    }

    if (mode !== 'advisor' && mode !== 'actor') {
      return c.json({ error: 'Mode must be "advisor" or "actor"' }, 400);
    }

    // Check Claude API key
    if (!env.ANTHROPIC_API_KEY) {
      return c.json({ error: 'Bot assistant not configured' }, 503);
    }

    // Check quota before making Claude API call
    const quotaCheck = await usageService.checkQuota(payload.userId, 'claude');
    if (!quotaCheck.allowed) {
      return c.json({
        error: 'Quota exceeded',
        message: quotaCheck.message || 'You have exceeded your Claude usage quota. Please upgrade your plan.',
        remaining: quotaCheck.remaining,
        limit: quotaCheck.limit,
      }, 402);
    }

    // Get assets from DO for context
    let assets: BotContext['assets'] = [];
    if (env.SPACES_DO) {
      try {
        const doId = env.SPACES_DO.idFromName(spaceId);
        const doStub = env.SPACES_DO.get(doId);

        // We need to get assets from DO - create a simple internal endpoint
        const doResponse = await doStub.fetch(new Request('http://do/internal/state', {
          method: 'GET',
        }));

        if (doResponse.ok) {
          const state = await doResponse.json() as {
            assets: Array<{ id: string; name: string; type: string }>;
            variants: Array<{ asset_id: string }>;
          };

          assets = state.assets.map(asset => ({
            id: asset.id,
            name: asset.name,
            type: asset.type,
            variantCount: state.variants.filter(v => v.asset_id === asset.id).length,
          }));
        }
      } catch (err) {
        console.error('Error fetching space state for bot context:', err);
      }
    }

    // Build context
    const context: BotContext = {
      spaceId,
      spaceName: space.name,
      assets,
      mode: mode as 'advisor' | 'actor',
      forge: forgeContext,
      viewing: viewingContext,
    };

    // Process message with Claude
    const claudeService = new ClaudeService(env.ANTHROPIC_API_KEY);
    const { response, usage } = await claudeService.processMessage(
      message.trim(),
      context,
      history as ChatMessage[]
    );

    // Track Claude API usage with actual token counts from Anthropic API
    usageService.trackClaudeUsage(
      payload.userId,
      usage.inputTokens,
      usage.outputTokens,
      'claude-sonnet-4-20250514'
    ).catch(err => console.warn('Failed to track Claude usage:', err));

    // Store chat message in DO (user message)
    if (env.SPACES_DO) {
      const doId = env.SPACES_DO.idFromName(spaceId);
      const doStub = env.SPACES_DO.get(doId);

      // Store user message
      await doStub.fetch(new Request('http://do/internal/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderType: 'user',
          senderId: userId,
          content: message.trim(),
          metadata: JSON.stringify({ mode }),
        }),
      }));

      // Store bot response
      const botContent = response.type === 'advice'
        ? response.message
        : response.message || JSON.stringify(response);

      await doStub.fetch(new Request('http://do/internal/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderType: 'bot',
          senderId: 'claude',
          content: botContent,
          metadata: JSON.stringify({ type: response.type }),
        }),
      }));
    }

    // Check permissions for action/plan execution
    if ((response.type === 'action' || response.type === 'plan') && mode === 'actor') {
      if (member.role !== 'owner' && member.role !== 'editor') {
        return c.json({
          success: true,
          response: {
            type: 'advice',
            message: 'I understand what you want to do, but you need editor permissions to make changes.\n\n' + response.message,
          },
        });
      }
    }

    return c.json({
      success: true,
      response,
    });
  } catch (error) {
    console.error('Error processing chat message:', error);
    return c.json({ error: 'Failed to process chat message' }, 500);
  }
});

// POST /api/spaces/:id/chat/suggest - Get prompt suggestion
chatRoutes.post('/api/spaces/:id/chat/suggest', suggestionRateLimiter, async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const memberDAO = container.get(MemberDAO);
    const spaceDAO = container.get(SpaceDAO);
    const usageService = container.get(UsageService);
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
    const userId = String(payload.userId);

    // Verify user is member of space
    const member = await memberDAO.getMember(spaceId, userId);
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

    // Check quota before making Claude API call
    const quotaCheck = await usageService.checkQuota(payload.userId, 'claude');
    if (!quotaCheck.allowed) {
      return c.json({
        error: 'Quota exceeded',
        message: quotaCheck.message || 'You have exceeded your Claude usage quota. Please upgrade your plan.',
        remaining: quotaCheck.remaining,
        limit: quotaCheck.limit,
      }, 402);
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

    // Track Claude API usage
    usageService.trackClaudeUsage(
      payload.userId,
      usage.inputTokens,
      usage.outputTokens,
      'claude-sonnet-4-20250514'
    ).catch(err => console.warn('Failed to track Claude usage:', err));

    return c.json({
      success: true,
      suggestion,
    });
  } catch (error) {
    console.error('Error generating prompt suggestion:', error);
    return c.json({ error: 'Failed to generate suggestion' }, 500);
  }
});

// POST /api/spaces/:id/chat/describe - Describe an image
chatRoutes.post('/api/spaces/:id/chat/describe', chatRateLimiter, async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const memberDAO = container.get(MemberDAO);
    const usageService = container.get(UsageService);
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
    const userId = String(payload.userId);

    // Verify user is member of space
    const member = await memberDAO.getMember(spaceId, userId);
    if (!member) {
      return c.json({ error: 'Access denied' }, 403);
    }

    // Validate request body
    const body = await c.req.json();
    const { variantId, assetName, focus = 'general', question } = body as {
      variantId: string;
      assetName: string;
      focus?: 'general' | 'style' | 'composition' | 'details' | 'compare';
      question?: string;
    };

    if (!variantId || !assetName) {
      return c.json({ error: 'variantId and assetName are required' }, 400);
    }

    // Check Claude API key
    if (!env.ANTHROPIC_API_KEY) {
      return c.json({ error: 'Bot assistant not configured' }, 503);
    }

    // Check quota before making Claude API call
    const quotaCheck = await usageService.checkQuota(payload.userId, 'claude');
    if (!quotaCheck.allowed) {
      return c.json({
        error: 'Quota exceeded',
        message: quotaCheck.message || 'You have exceeded your Claude usage quota. Please upgrade your plan.',
        remaining: quotaCheck.remaining,
        limit: quotaCheck.limit,
      }, 402);
    }

    // Get variant image_key from DO
    if (!env.SPACES_DO) {
      return c.json({ error: 'Space not available' }, 503);
    }

    const doId = env.SPACES_DO.idFromName(spaceId);
    const doStub = env.SPACES_DO.get(doId);

    const stateResponse = await doStub.fetch(new Request('http://do/internal/state', {
      method: 'GET',
    }));

    if (!stateResponse.ok) {
      return c.json({ error: 'Failed to get space state' }, 500);
    }

    const state = await stateResponse.json() as {
      variants: Array<{ id: string; image_key: string }>;
    };

    const variant = state.variants.find(v => v.id === variantId);
    if (!variant || !variant.image_key) {
      return c.json({ error: 'Variant not found or has no image' }, 404);
    }

    // Fetch image from R2
    if (!env.IMAGES) {
      return c.json({ error: 'Image storage not configured' }, 503);
    }

    const imageObject = await env.IMAGES.get(variant.image_key);
    if (!imageObject) {
      return c.json({ error: 'Image not found in storage' }, 404);
    }

    // Convert to base64 (chunked to handle large images)
    const arrayBuffer = await imageObject.arrayBuffer();
    const base64 = arrayBufferToBase64(arrayBuffer);

    // Detect actual media type from image data (more reliable than R2 metadata)
    const mediaType = detectImageType(base64);

    // Call Claude to describe the image
    const claudeService = new ClaudeService(env.ANTHROPIC_API_KEY);
    const { description, usage } = await claudeService.describeImage(base64, mediaType, assetName, focus, question);

    // Track Claude API usage
    usageService.trackClaudeUsage(
      payload.userId,
      usage.inputTokens,
      usage.outputTokens,
      'claude-sonnet-4-20250514'
    ).catch(err => console.warn('Failed to track Claude usage:', err));

    return c.json({
      success: true,
      description,
    });
  } catch (error) {
    console.error('Error describing image:', error);
    return c.json({ error: 'Failed to describe image' }, 500);
  }
});

// POST /api/spaces/:id/chat/compare - Compare multiple images
chatRoutes.post('/api/spaces/:id/chat/compare', chatRateLimiter, async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const memberDAO = container.get(MemberDAO);
    const usageService = container.get(UsageService);
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
    const userId = String(payload.userId);

    // Verify user is member of space
    const member = await memberDAO.getMember(spaceId, userId);
    if (!member) {
      return c.json({ error: 'Access denied' }, 403);
    }

    // Validate request body
    const body = await c.req.json();
    const { variantIds, aspects = ['style', 'composition', 'colors'] } = body as {
      variantIds: Array<{ variantId: string; label: string }>;
      aspects?: string[];
    };

    if (!variantIds || variantIds.length < 2 || variantIds.length > 4) {
      return c.json({ error: 'Must provide 2-4 variants to compare' }, 400);
    }

    // Check Claude API key
    if (!env.ANTHROPIC_API_KEY) {
      return c.json({ error: 'Bot assistant not configured' }, 503);
    }

    // Check quota before making Claude API call
    const quotaCheck = await usageService.checkQuota(payload.userId, 'claude');
    if (!quotaCheck.allowed) {
      return c.json({
        error: 'Quota exceeded',
        message: quotaCheck.message || 'You have exceeded your Claude usage quota. Please upgrade your plan.',
        remaining: quotaCheck.remaining,
        limit: quotaCheck.limit,
      }, 402);
    }

    // Get variant image_keys from DO
    if (!env.SPACES_DO || !env.IMAGES) {
      return c.json({ error: 'Services not available' }, 503);
    }

    const doId = env.SPACES_DO.idFromName(spaceId);
    const doStub = env.SPACES_DO.get(doId);

    const stateResponse = await doStub.fetch(new Request('http://do/internal/state', {
      method: 'GET',
    }));

    if (!stateResponse.ok) {
      return c.json({ error: 'Failed to get space state' }, 500);
    }

    const state = await stateResponse.json() as {
      variants: Array<{ id: string; image_key: string }>;
    };

    // Fetch all images
    const images: Array<{ base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; label: string }> = [];

    for (const { variantId, label } of variantIds) {
      const variant = state.variants.find(v => v.id === variantId);
      if (!variant || !variant.image_key) {
        return c.json({ error: `Variant ${variantId} not found` }, 404);
      }

      const imageObject = await env.IMAGES.get(variant.image_key);
      if (!imageObject) {
        return c.json({ error: `Image for variant ${variantId} not found` }, 404);
      }

      const arrayBuffer = await imageObject.arrayBuffer();
      const base64 = arrayBufferToBase64(arrayBuffer);

      images.push({
        base64,
        mediaType: detectImageType(base64),
        label,
      });
    }

    // Call Claude to compare images
    const claudeService = new ClaudeService(env.ANTHROPIC_API_KEY);
    const { comparison, usage } = await claudeService.compareImages(images, aspects);

    // Track Claude API usage
    usageService.trackClaudeUsage(
      payload.userId,
      usage.inputTokens,
      usage.outputTokens,
      'claude-sonnet-4-20250514'
    ).catch(err => console.warn('Failed to track Claude usage:', err));

    return c.json({
      success: true,
      comparison,
    });
  } catch (error) {
    console.error('Error comparing images:', error);
    return c.json({ error: 'Failed to compare images' }, 500);
  }
});

// GET /api/spaces/:id/chat/history - Get chat history
chatRoutes.get('/api/spaces/:id/chat/history', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const memberDAO = container.get(MemberDAO);
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
    const userId = String(payload.userId);

    // Verify user is member of space
    const member = await memberDAO.getMember(spaceId, userId);
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
  } catch (error) {
    console.error('Error getting chat history:', error);
    return c.json({ error: 'Failed to get chat history' }, 500);
  }
});

export { chatRoutes };
