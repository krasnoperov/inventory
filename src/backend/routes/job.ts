import { Hono } from 'hono';
import type { AppContext } from './types';
import { AuthService } from '../features/auth/auth-service';
import { JobDAO } from '../../dao/job-dao';
import { MemberDAO } from '../../dao/member-dao';
import { UsageService } from '../services/usageService';
import { getAuthToken } from '../auth';
import { type GenerationMessage } from '../services/generationConsumer';
import { generationRateLimiter } from '../middleware/rate-limit';

const jobRoutes = new Hono<AppContext>();

// ============================================================================
// NEW CONSOLIDATED ENDPOINTS
// ============================================================================

/**
 * POST /api/spaces/:spaceId/assets - Create new asset
 *
 * Unified endpoint for all asset creation operations:
 * - Fork: Copy variant to new asset (no AI) - prompt undefined, single referenceVariantIds
 * - Generate: Fresh AI generation - prompt defined, no referenceVariantIds
 * - Derive: AI with single reference - prompt defined, single referenceVariantIds
 * - Compose: AI with multiple refs - prompt defined, multiple referenceVariantIds
 *
 * Request body:
 * {
 *   name: string;              // Required: new asset name
 *   type: string;              // Required: asset type (character, item, scene, etc.)
 *   parentAssetId?: string;    // Optional: parent for hierarchy
 *   prompt?: string;           // Optional: AI prompt (undefined = fork/copy)
 *   referenceVariantIds?: string[]; // Optional: source variants
 *   model?: string;            // Optional: AI model
 *   aspectRatio?: string;      // Optional: aspect ratio (default 1:1)
 * }
 */
jobRoutes.post('/api/spaces/:spaceId/assets', generationRateLimiter, async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const jobDAO = container.get(JobDAO);
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

    const spaceId = c.req.param('spaceId');
    const userId = String(payload.userId);

    // Verify user is member of space with editor or owner role
    const member = await memberDAO.getMember(spaceId, userId);
    if (!member) {
      return c.json({ error: 'Access denied' }, 403);
    }

    if (member.role !== 'editor' && member.role !== 'owner') {
      return c.json({ error: 'Editor or owner role required' }, 403);
    }

    // Parse and validate request body
    const body = await c.req.json();
    const { name, type, parentAssetId, prompt, referenceVariantIds, model, aspectRatio } = body;

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return c.json({ error: 'Asset name is required and must be a non-empty string' }, 400);
    }

    const validAssetTypes = ['character', 'item', 'scene', 'environment', 'sprite-sheet', 'animation', 'style-sheet', 'reference', 'composite'];
    if (!type || !validAssetTypes.includes(type)) {
      return c.json({ error: `Asset type must be one of: ${validAssetTypes.join(', ')}` }, 400);
    }

    // Determine operation mode based on prompt and referenceVariantIds
    const hasPrompt = prompt !== undefined && prompt !== null;
    const hasRefs = Array.isArray(referenceVariantIds) && referenceVariantIds.length > 0;
    const refCount = hasRefs ? referenceVariantIds.length : 0;

    // Validation based on operation mode
    if (!hasPrompt && !hasRefs) {
      return c.json({
        error: 'Either prompt or referenceVariantIds is required. Provide prompt for AI generation, or referenceVariantIds to fork from an existing variant.'
      }, 400);
    }

    if (!hasPrompt && refCount > 1) {
      return c.json({
        error: 'Cannot fork from multiple variants without a prompt. Provide a prompt to compose them, or use a single referenceVariantIds to fork.'
      }, 400);
    }

    if (hasPrompt && typeof prompt !== 'string') {
      return c.json({ error: 'Prompt must be a string' }, 400);
    }

    if (hasPrompt && prompt.trim().length === 0) {
      return c.json({ error: 'Prompt cannot be empty. Use undefined/null for fork operation.' }, 400);
    }

    // Get Durable Object stub
    if (!env.SPACES_DO) {
      return c.json({ error: 'Asset storage not available' }, 503);
    }

    const doId = env.SPACES_DO.idFromName(spaceId);
    const doStub = env.SPACES_DO.get(doId);

    // FORK MODE: No prompt, single reference - just copy the variant
    if (!hasPrompt && refCount === 1) {
      const sourceVariantId = referenceVariantIds[0];

      // Spawn asset via DO (copies variant, creates spawned lineage)
      const doResponse = await doStub.fetch(new Request('http://do/internal/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceVariantId,
          name: name.trim(),
          type,
          parentAssetId,
          createdBy: userId,
        }),
      }));

      if (!doResponse.ok) {
        const errorData = await doResponse.json() as { error?: string };
        const status = doResponse.status === 404 ? 404 : 500;
        return c.json({ error: errorData.error || 'Failed to fork asset' }, status);
      }

      const data = await doResponse.json() as { success: boolean; asset: { id: string }; variant: { id: string } };
      return c.json({
        success: true,
        mode: 'fork',
        assetId: data.asset.id,
        variantId: data.variant.id,
      }, 201);
    }

    // AI GENERATION MODE: Has prompt (with or without references)
    // Pre-check: quota + rate limit before queueing image generation
    const usageService = container.get(UsageService);
    const preCheck = await usageService.preCheck(payload.userId, 'nanobanana');
    if (!preCheck.allowed) {
      const statusCode = preCheck.denyReason === 'rate_limited' ? 429 : 402;
      return c.json({
        error: preCheck.denyReason === 'rate_limited' ? 'Rate limited' : 'Quota exceeded',
        message: preCheck.denyMessage,
        denyReason: preCheck.denyReason,
        quota: {
          used: preCheck.quotaUsed,
          limit: preCheck.quotaLimit,
          remaining: preCheck.quotaRemaining,
        },
        rateLimit: {
          used: preCheck.rateLimitUsed,
          limit: preCheck.rateLimitMax,
          remaining: preCheck.rateLimitRemaining,
          resetsAt: preCheck.rateLimitResetsAt?.toISOString() || null,
        },
      }, statusCode);
    }

    // Validate references exist if provided
    const sourceImageKeys: string[] = [];
    if (hasRefs) {
      const stateResponse = await doStub.fetch(new Request('http://do/internal/state'));
      if (!stateResponse.ok) {
        return c.json({ error: 'Failed to fetch space state' }, 500);
      }

      const state = await stateResponse.json() as {
        variants: Array<{ id: string; image_key: string }>;
      };

      for (const refId of referenceVariantIds) {
        const variant = state.variants.find(v => v.id === refId);
        if (!variant) {
          return c.json({ error: `Reference variant not found: ${refId}` }, 404);
        }
        sourceImageKeys.push(variant.image_key);
      }
    }

    // Create asset in DO first
    const assetId = crypto.randomUUID();
    const createAssetResponse = await doStub.fetch(new Request('http://do/internal/create-asset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: assetId,
        name: name.trim(),
        type,
        parentAssetId,
        createdBy: userId,
      }),
    }));

    if (!createAssetResponse.ok) {
      const errorData = await createAssetResponse.json() as { error?: string };
      return c.json({ error: errorData.error || 'Failed to create asset' }, 500);
    }

    // Create job in D1
    const jobId = crypto.randomUUID();
    const now = Date.now();

    // Determine job type for tracking
    const jobType = refCount === 0 ? 'generate' : refCount === 1 ? 'derive' : 'compose';

    const input = {
      prompt: prompt.trim(),
      assetName: name.trim(),
      assetType: type,
      assetId,
      sourceVariantIds: hasRefs ? referenceVariantIds : undefined,
      sourceImageKeys: sourceImageKeys.length > 0 ? sourceImageKeys : undefined,
      model,
      aspectRatio: aspectRatio || '1:1',
    };

    const job = await jobDAO.createJob({
      id: jobId,
      space_id: spaceId,
      type: jobType,
      status: 'pending',
      input: JSON.stringify(input),
      result_variant_id: null,
      error: null,
      attempts: 0,
      created_by: userId,
      created_at: now,
      updated_at: now,
    });

    // Enqueue job to generation queue
    const message: GenerationMessage = {
      jobId,
      spaceId,
      ...input,
    };

    console.log('[Job Route] POST /assets - Sending message to GENERATION_QUEUE', {
      jobId,
      spaceId,
      mode: jobType,
      assetName: input.assetName,
      refCount,
    });

    await env.GENERATION_QUEUE.send(message);

    // Increment rate limit counter after successful queue
    usageService.incrementRateLimit(payload.userId).catch(err =>
      console.warn('Failed to increment rate limit:', err)
    );

    console.log('[Job Route] POST /assets - Message sent successfully', { jobId });

    return c.json({
      success: true,
      mode: jobType,
      jobId: job.id,
      assetId,
    }, 201);
  } catch (error) {
    console.error('[Job Route] Error in POST /assets:', error);
    return c.json({ error: 'Failed to create asset' }, 500);
  }
});

/**
 * POST /api/spaces/:spaceId/assets/:assetId/variants - Create new variant in existing asset
 *
 * Always uses AI generation to create a new variant derived from an existing one.
 *
 * Request body:
 * {
 *   sourceVariantId: string;        // Required: variant to derive from
 *   prompt: string;                 // Required: modification instructions
 *   referenceVariantIds?: string[]; // Optional: additional reference images
 *   model?: string;                 // Optional: AI model
 *   aspectRatio?: string;           // Optional: aspect ratio
 * }
 */
jobRoutes.post('/api/spaces/:spaceId/assets/:assetId/variants', generationRateLimiter, async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const jobDAO = container.get(JobDAO);
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

    const spaceId = c.req.param('spaceId');
    const assetId = c.req.param('assetId');
    const userId = String(payload.userId);

    // Verify user is member of space with editor or owner role
    const member = await memberDAO.getMember(spaceId, userId);
    if (!member) {
      return c.json({ error: 'Access denied' }, 403);
    }

    if (member.role !== 'editor' && member.role !== 'owner') {
      return c.json({ error: 'Editor or owner role required' }, 403);
    }

    // Parse and validate request body
    const body = await c.req.json();
    const { sourceVariantId, prompt, referenceVariantIds, model, aspectRatio } = body;

    if (!sourceVariantId || typeof sourceVariantId !== 'string') {
      return c.json({ error: 'sourceVariantId is required' }, 400);
    }

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return c.json({ error: 'prompt is required and must be a non-empty string' }, 400);
    }

    // Pre-check: quota + rate limit before queueing image generation
    const usageService = container.get(UsageService);
    const variantPreCheck = await usageService.preCheck(payload.userId, 'nanobanana');
    if (!variantPreCheck.allowed) {
      const statusCode = variantPreCheck.denyReason === 'rate_limited' ? 429 : 402;
      return c.json({
        error: variantPreCheck.denyReason === 'rate_limited' ? 'Rate limited' : 'Quota exceeded',
        message: variantPreCheck.denyMessage,
        denyReason: variantPreCheck.denyReason,
        quota: {
          used: variantPreCheck.quotaUsed,
          limit: variantPreCheck.quotaLimit,
          remaining: variantPreCheck.quotaRemaining,
        },
        rateLimit: {
          used: variantPreCheck.rateLimitUsed,
          limit: variantPreCheck.rateLimitMax,
          remaining: variantPreCheck.rateLimitRemaining,
          resetsAt: variantPreCheck.rateLimitResetsAt?.toISOString() || null,
        },
      }, statusCode);
    }

    // Get asset and variant from Durable Object
    if (!env.SPACES_DO) {
      return c.json({ error: 'Asset storage not available' }, 503);
    }

    const doId = env.SPACES_DO.idFromName(spaceId);
    const doStub = env.SPACES_DO.get(doId);

    // Fetch asset to verify it exists and get variant info
    const doResponse = await doStub.fetch(new Request(`http://do/internal/asset/${assetId}`, {
      method: 'GET',
    }));

    if (!doResponse.ok) {
      const errorData = await doResponse.json() as { error?: string };
      const status = doResponse.status === 404 ? 404 : 500;
      return c.json({ error: errorData.error || 'Asset not found' }, status);
    }

    const assetData = await doResponse.json() as {
      asset: { id: string; name: string; type: string };
      variants: Array<{ id: string; image_key: string }>;
    };

    // Find the source variant
    const sourceVariant = assetData.variants.find(v => v.id === sourceVariantId);
    if (!sourceVariant) {
      return c.json({ error: 'Source variant not found in this asset' }, 404);
    }

    // Validate additional references if provided
    const additionalImageKeys: string[] = [];
    if (Array.isArray(referenceVariantIds) && referenceVariantIds.length > 0) {
      const stateResponse = await doStub.fetch(new Request('http://do/internal/state'));
      if (!stateResponse.ok) {
        return c.json({ error: 'Failed to fetch space state' }, 500);
      }

      const state = await stateResponse.json() as {
        variants: Array<{ id: string; image_key: string }>;
      };

      for (const refId of referenceVariantIds) {
        const variant = state.variants.find(v => v.id === refId);
        if (!variant) {
          return c.json({ error: `Reference variant not found: ${refId}` }, 404);
        }
        additionalImageKeys.push(variant.image_key);
      }
    }

    // Create job in D1
    const jobId = crypto.randomUUID();
    const now = Date.now();

    const input = {
      prompt: prompt.trim(),
      assetId,
      assetName: assetData.asset.name,
      assetType: assetData.asset.type,
      sourceVariantId,
      sourceImageKey: sourceVariant.image_key,
      referenceVariantIds: referenceVariantIds || undefined,
      referenceImageKeys: additionalImageKeys.length > 0 ? additionalImageKeys : undefined,
      model,
      aspectRatio: aspectRatio || '1:1',
    };

    const job = await jobDAO.createJob({
      id: jobId,
      space_id: spaceId,
      type: 'derive', // New variant derived from existing
      status: 'pending',
      input: JSON.stringify(input),
      result_variant_id: null,
      error: null,
      attempts: 0,
      created_by: userId,
      created_at: now,
      updated_at: now,
    });

    // Enqueue job to generation queue
    const message: GenerationMessage = {
      jobId,
      spaceId,
      ...input,
    };

    console.log('[Job Route] POST /variants - Sending message to GENERATION_QUEUE', {
      jobId,
      spaceId,
      assetId,
      sourceVariantId,
    });

    await env.GENERATION_QUEUE.send(message);

    // Increment rate limit counter after successful queue
    usageService.incrementRateLimit(payload.userId).catch(err =>
      console.warn('Failed to increment rate limit:', err)
    );

    console.log('[Job Route] POST /variants - Message sent successfully', { jobId });

    return c.json({
      success: true,
      jobId: job.id,
    }, 201);
  } catch (error) {
    console.error('[Job Route] Error in POST /variants:', error);
    return c.json({ error: 'Failed to create variant' }, 500);
  }
});

// ============================================================================
// READ/QUERY ENDPOINTS
// ============================================================================

// GET /api/spaces/:id/assets/:assetId - Get asset details with variants and lineage
jobRoutes.get('/api/spaces/:id/assets/:assetId', async (c) => {
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
    const assetId = c.req.param('assetId');
    const userId = String(payload.userId);

    // Verify user is member of space
    const member = await memberDAO.getMember(spaceId, userId);
    if (!member) {
      return c.json({ error: 'Access denied' }, 403);
    }

    // Get asset details from Durable Object
    if (!env.SPACES_DO) {
      return c.json({ error: 'Asset storage not available' }, 503);
    }

    const doId = env.SPACES_DO.idFromName(spaceId);
    const doStub = env.SPACES_DO.get(doId);

    const doResponse = await doStub.fetch(new Request(`http://do/internal/asset/${assetId}`, {
      method: 'GET',
    }));

    if (!doResponse.ok) {
      const errorData = await doResponse.json() as { error?: string };
      const status = doResponse.status === 404 ? 404 : 500;
      return c.json({ error: errorData.error || 'Failed to get asset' }, status);
    }

    const data = await doResponse.json();
    return c.json(data);
  } catch (error) {
    console.error('Error getting asset details:', error);
    return c.json({ error: 'Failed to get asset details' }, 500);
  }
});

// GET /api/spaces/:id/variants/:variantId/lineage - Get lineage for a variant
jobRoutes.get('/api/spaces/:id/variants/:variantId/lineage', async (c) => {
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
    const variantId = c.req.param('variantId');
    const userId = String(payload.userId);

    // Verify user is member of space
    const member = await memberDAO.getMember(spaceId, userId);
    if (!member) {
      return c.json({ error: 'Access denied' }, 403);
    }

    // Get lineage from Durable Object
    if (!env.SPACES_DO) {
      return c.json({ error: 'Asset storage not available' }, 503);
    }

    const doId = env.SPACES_DO.idFromName(spaceId);
    const doStub = env.SPACES_DO.get(doId);

    const doResponse = await doStub.fetch(new Request(`http://do/internal/lineage/${variantId}`, {
      method: 'GET',
    }));

    if (!doResponse.ok) {
      const errorData = await doResponse.json() as { error?: string };
      const status = doResponse.status === 404 ? 404 : 500;
      return c.json({ error: errorData.error || 'Failed to get lineage' }, status);
    }

    const data = await doResponse.json();
    return c.json(data);
  } catch (error) {
    console.error('Error getting lineage:', error);
    return c.json({ error: 'Failed to get lineage' }, 500);
  }
});

// GET /api/spaces/:id/variants/:variantId/lineage/graph - Get full lineage graph
jobRoutes.get('/api/spaces/:id/variants/:variantId/lineage/graph', async (c) => {
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
    const variantId = c.req.param('variantId');
    const userId = String(payload.userId);

    // Verify user is member of space
    const member = await memberDAO.getMember(spaceId, userId);
    if (!member) {
      return c.json({ error: 'Access denied' }, 403);
    }

    // Get full lineage graph from Durable Object
    if (!env.SPACES_DO) {
      return c.json({ error: 'Asset storage not available' }, 503);
    }

    const doId = env.SPACES_DO.idFromName(spaceId);
    const doStub = env.SPACES_DO.get(doId);

    const doResponse = await doStub.fetch(new Request(`http://do/internal/lineage/${variantId}/graph`, {
      method: 'GET',
    }));

    if (!doResponse.ok) {
      const errorData = await doResponse.json() as { error?: string };
      const status = doResponse.status === 404 ? 404 : 500;
      return c.json({ error: errorData.error || 'Failed to get lineage graph' }, status);
    }

    const data = await doResponse.json();
    return c.json(data);
  } catch (error) {
    console.error('Error getting lineage graph:', error);
    return c.json({ error: 'Failed to get lineage graph' }, 500);
  }
});

// PATCH /api/spaces/:id/assets/:assetId/parent - Re-parent asset
jobRoutes.patch('/api/spaces/:id/assets/:assetId/parent', async (c) => {
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
    const assetId = c.req.param('assetId');
    const userId = String(payload.userId);

    // Verify user is member of space with editor or owner role
    const member = await memberDAO.getMember(spaceId, userId);
    if (!member) {
      return c.json({ error: 'Access denied' }, 403);
    }

    if (member.role !== 'editor' && member.role !== 'owner') {
      return c.json({ error: 'Editor or owner role required' }, 403);
    }

    // Validate request body
    const body = await c.req.json();
    const { parentAssetId } = body;  // null to make root, string to set parent

    // Update asset parent via Durable Object
    if (!env.SPACES_DO) {
      return c.json({ error: 'Asset storage not available' }, 503);
    }

    const doId = env.SPACES_DO.idFromName(spaceId);
    const doStub = env.SPACES_DO.get(doId);

    const doResponse = await doStub.fetch(new Request(`http://do/internal/asset/${assetId}/parent`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentAssetId: parentAssetId ?? null,
      }),
    }));

    if (!doResponse.ok) {
      const errorData = await doResponse.json() as { error?: string };
      const status = doResponse.status === 404 ? 404 : doResponse.status === 400 ? 400 : 500;
      return c.json({ error: errorData.error || 'Failed to update asset parent' }, status);
    }

    const data = await doResponse.json();
    return c.json(data);
  } catch (error) {
    console.error('Error updating asset parent:', error);
    return c.json({ error: 'Failed to update asset parent' }, 500);
  }
});

// GET /api/spaces/:id/assets/:assetId/children - Get child assets
jobRoutes.get('/api/spaces/:id/assets/:assetId/children', async (c) => {
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
    const assetId = c.req.param('assetId');
    const userId = String(payload.userId);

    // Verify user is member of space
    const member = await memberDAO.getMember(spaceId, userId);
    if (!member) {
      return c.json({ error: 'Access denied' }, 403);
    }

    // Get child assets from Durable Object
    if (!env.SPACES_DO) {
      return c.json({ error: 'Asset storage not available' }, 503);
    }

    const doId = env.SPACES_DO.idFromName(spaceId);
    const doStub = env.SPACES_DO.get(doId);

    const doResponse = await doStub.fetch(new Request(`http://do/internal/asset/${assetId}/children`, {
      method: 'GET',
    }));

    if (!doResponse.ok) {
      const errorData = await doResponse.json() as { error?: string };
      const status = doResponse.status === 404 ? 404 : 500;
      return c.json({ error: errorData.error || 'Failed to get children' }, status);
    }

    const data = await doResponse.json();
    return c.json(data);
  } catch (error) {
    console.error('Error getting asset children:', error);
    return c.json({ error: 'Failed to get asset children' }, 500);
  }
});

// GET /api/spaces/:id/assets/:assetId/ancestors - Get ancestor chain (breadcrumbs)
jobRoutes.get('/api/spaces/:id/assets/:assetId/ancestors', async (c) => {
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
    const assetId = c.req.param('assetId');
    const userId = String(payload.userId);

    // Verify user is member of space
    const member = await memberDAO.getMember(spaceId, userId);
    if (!member) {
      return c.json({ error: 'Access denied' }, 403);
    }

    // Get ancestors from Durable Object
    if (!env.SPACES_DO) {
      return c.json({ error: 'Asset storage not available' }, 503);
    }

    const doId = env.SPACES_DO.idFromName(spaceId);
    const doStub = env.SPACES_DO.get(doId);

    const doResponse = await doStub.fetch(new Request(`http://do/internal/asset/${assetId}/ancestors`, {
      method: 'GET',
    }));

    if (!doResponse.ok) {
      const errorData = await doResponse.json() as { error?: string };
      const status = doResponse.status === 404 ? 404 : 500;
      return c.json({ error: errorData.error || 'Failed to get ancestors' }, status);
    }

    const data = await doResponse.json();
    return c.json(data);
  } catch (error) {
    console.error('Error getting asset ancestors:', error);
    return c.json({ error: 'Failed to get asset ancestors' }, 500);
  }
});

// PATCH /api/spaces/:id/variants/:variantId/star - Toggle star status
jobRoutes.patch('/api/spaces/:id/variants/:variantId/star', async (c) => {
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
    const variantId = c.req.param('variantId');
    const userId = String(payload.userId);

    // Verify user is member of space with editor or owner role
    const member = await memberDAO.getMember(spaceId, userId);
    if (!member) {
      return c.json({ error: 'Access denied' }, 403);
    }

    if (member.role !== 'editor' && member.role !== 'owner') {
      return c.json({ error: 'Editor or owner role required' }, 403);
    }

    // Validate request body
    const body = await c.req.json();
    const { starred } = body;

    if (typeof starred !== 'boolean') {
      return c.json({ error: 'starred must be a boolean' }, 400);
    }

    // Update variant star status via Durable Object
    if (!env.SPACES_DO) {
      return c.json({ error: 'Asset storage not available' }, 503);
    }

    const doId = env.SPACES_DO.idFromName(spaceId);
    const doStub = env.SPACES_DO.get(doId);

    const doResponse = await doStub.fetch(new Request(`http://do/internal/variant/${variantId}/star`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ starred }),
    }));

    if (!doResponse.ok) {
      const errorData = await doResponse.json() as { error?: string };
      const status = doResponse.status === 404 ? 404 : 500;
      return c.json({ error: errorData.error || 'Failed to update variant' }, status);
    }

    const data = await doResponse.json();
    return c.json(data);
  } catch (error) {
    console.error('Error updating variant star:', error);
    return c.json({ error: 'Failed to update variant' }, 500);
  }
});

// PATCH /api/spaces/:id/lineage/:lineageId/sever - Sever lineage link
jobRoutes.patch('/api/spaces/:id/lineage/:lineageId/sever', async (c) => {
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
    const lineageId = c.req.param('lineageId');
    const userId = String(payload.userId);

    // Verify user is member of space with editor or owner role
    const member = await memberDAO.getMember(spaceId, userId);
    if (!member) {
      return c.json({ error: 'Access denied' }, 403);
    }

    if (member.role !== 'editor' && member.role !== 'owner') {
      return c.json({ error: 'Editor or owner role required' }, 403);
    }

    // Sever lineage via Durable Object
    if (!env.SPACES_DO) {
      return c.json({ error: 'Asset storage not available' }, 503);
    }

    const doId = env.SPACES_DO.idFromName(spaceId);
    const doStub = env.SPACES_DO.get(doId);

    const doResponse = await doStub.fetch(new Request(`http://do/internal/lineage/${lineageId}/sever`, {
      method: 'PATCH',
    }));

    if (!doResponse.ok) {
      const errorData = await doResponse.json() as { error?: string };
      const status = doResponse.status === 404 ? 404 : 500;
      return c.json({ error: errorData.error || 'Failed to sever lineage' }, status);
    }

    const data = await doResponse.json();
    return c.json(data);
  } catch (error) {
    console.error('Error severing lineage:', error);
    return c.json({ error: 'Failed to sever lineage' }, 500);
  }
});

// GET /api/jobs/:id - Get job status
jobRoutes.get('/api/jobs/:id', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const jobDAO = container.get(JobDAO);
    const memberDAO = container.get(MemberDAO);

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

    const jobId = c.req.param('id');
    const userId = String(payload.userId);

    // Get job from database
    const job = await jobDAO.getJobById(jobId);
    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }

    // Check if user created the job OR is a member of the job's space
    const isCreator = job.created_by === userId;
    const member = await memberDAO.getMember(job.space_id, userId);
    const isMember = member !== null;

    if (!isCreator && !isMember) {
      return c.json({ error: 'Access denied' }, 403);
    }

    return c.json({
      success: true,
      job: {
        id: job.id,
        space_id: job.space_id,
        type: job.type,
        status: job.status,
        input: job.input,
        result_variant_id: job.result_variant_id,
        error: job.error,
        attempts: job.attempts,
        created_by: job.created_by,
        created_at: job.created_at,
        updated_at: job.updated_at,
      },
    });
  } catch (error) {
    console.error('Error getting job:', error);
    return c.json({ error: 'Failed to get job' }, 500);
  }
});

// POST /api/jobs/:id/retry - Retry stuck or failed job
jobRoutes.post('/api/jobs/:id/retry', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const jobDAO = container.get(JobDAO);
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

    const jobId = c.req.param('id');
    const userId = String(payload.userId);

    // Get job from database
    const job = await jobDAO.getJobById(jobId);
    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }

    // Check if user created the job OR is a member of the job's space
    const isCreator = job.created_by === userId;
    const member = await memberDAO.getMember(job.space_id, userId);
    const isMember = member !== null;

    if (!isCreator && !isMember) {
      return c.json({ error: 'Access denied' }, 403);
    }

    // Verify job status is 'stuck' or 'failed'
    if (job.status !== 'stuck' && job.status !== 'failed') {
      return c.json({
        error: `Cannot retry job with status '${job.status}'. Only 'stuck' or 'failed' jobs can be retried.`,
      }, 400);
    }

    // Retry the job using JobDAO
    const retriedJob = await jobDAO.retryJob(jobId);
    if (!retriedJob) {
      return c.json({ error: 'Failed to retry job' }, 500);
    }

    // Re-enqueue to generation queue
    const input = JSON.parse(job.input);

    console.log('[Job Route] Sending retry message to GENERATION_QUEUE', {
      jobId: retriedJob.id,
      spaceId: retriedJob.space_id,
      previousStatus: job.status,
    });

    await env.GENERATION_QUEUE.send({
      jobId: retriedJob.id,
      spaceId: retriedJob.space_id,
      ...input,
    });

    console.log('[Job Route] Retry message sent successfully', { jobId: retriedJob.id });

    return c.json({
      success: true,
      message: 'Job retry initiated',
      job: {
        id: retriedJob.id,
        status: retriedJob.status,
        updated_at: retriedJob.updated_at,
      },
    });
  } catch (error) {
    console.error('Error retrying job:', error);
    return c.json({ error: 'Failed to retry job' }, 500);
  }
});

export { jobRoutes };
