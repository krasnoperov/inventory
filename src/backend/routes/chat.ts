import { Hono } from 'hono';
import type { AppContext } from './types';
import { AuthService } from '../features/auth/auth-service';
import { MemberDAO } from '../../dao/member-dao';
import { SpaceDAO } from '../../dao/space-dao';
import { getAuthToken } from '../auth';
import { ClaudeService, type BotContext, type ChatMessage } from '../services/claudeService';

const chatRoutes = new Hono<AppContext>();

// POST /api/spaces/:id/chat - Send chat message to bot
chatRoutes.post('/api/spaces/:id/chat', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const memberDAO = container.get(MemberDAO);
    const spaceDAO = container.get(SpaceDAO);
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
    const { message, mode = 'advisor', history = [] } = body;

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
      mode,
    };

    // Process message with Claude
    const claudeService = new ClaudeService(env.ANTHROPIC_API_KEY);
    const response = await claudeService.processMessage(
      message.trim(),
      context,
      history as ChatMessage[]
    );

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
      await doStub.fetch(new Request('http://do/internal/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderType: 'bot',
          senderId: 'claude',
          content: response.type === 'advice'
            ? response.message
            : JSON.stringify(response),
          metadata: JSON.stringify({ type: response.type }),
        }),
      }));
    }

    // If actor mode returned a command, we can optionally execute it
    if (response.type === 'command' && mode === 'actor') {
      // Check if user has permission to execute commands
      if (member.role !== 'owner' && member.role !== 'editor') {
        return c.json({
          success: true,
          response: {
            type: 'advice',
            message: 'I understand what you want to do, but you need editor permissions to make changes. Here\'s what I would have done:\n\n' + response.explanation,
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
chatRoutes.post('/api/spaces/:id/chat/suggest', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const memberDAO = container.get(MemberDAO);
    const spaceDAO = container.get(SpaceDAO);
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

    // Build context
    const context: BotContext = {
      spaceId,
      spaceName: space.name,
      assets: [],
      mode: 'advisor',
    };

    // Get prompt suggestion
    const claudeService = new ClaudeService(env.ANTHROPIC_API_KEY);
    const suggestion = await claudeService.suggestPrompt(context, assetType, theme);

    return c.json({
      success: true,
      suggestion,
    });
  } catch (error) {
    console.error('Error generating prompt suggestion:', error);
    return c.json({ error: 'Failed to generate suggestion' }, 500);
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
