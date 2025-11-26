import { Hono } from 'hono';
import type { AppContext } from './types';
import { AuthService } from '../features/auth/auth-service';
import { JobDAO } from '../../dao/job-dao';
import { MemberDAO } from '../../dao/member-dao';
import { getAuthToken } from '../auth';
import { type GenerationMessage } from '../services/generationConsumer';

const jobRoutes = new Hono<AppContext>();

// POST /api/spaces/:id/generate - Create new asset generation job
jobRoutes.post('/api/spaces/:id/generate', async (c) => {
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

    const spaceId = c.req.param('id');
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
    const { prompt, assetName, assetType, model, aspectRatio } = body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return c.json({ error: 'Prompt is required and must be a non-empty string' }, 400);
    }

    if (!assetName || typeof assetName !== 'string' || assetName.trim().length === 0) {
      return c.json({ error: 'Asset name is required and must be a non-empty string' }, 400);
    }

    const validAssetTypes = ['character', 'item', 'scene', 'composite'];
    if (!assetType || !validAssetTypes.includes(assetType)) {
      return c.json({ error: `Asset type must be one of: ${validAssetTypes.join(', ')}` }, 400);
    }

    // Create job in D1
    const jobId = crypto.randomUUID();
    const now = Date.now();

    // Create asset in Durable Object first
    let assetId: string;
    if (env.SPACES_DO) {
      const doId = env.SPACES_DO.idFromName(spaceId);
      const doStub = env.SPACES_DO.get(doId);

      const doResponse = await doStub.fetch(new Request('http://do/internal/create-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: assetName.trim(),
          type: assetType,
          createdBy: userId,
        }),
      }));

      if (!doResponse.ok) {
        const errorData = await doResponse.json() as { error?: string };
        return c.json({ error: errorData.error || 'Failed to create asset' }, 500);
      }

      const assetResult = await doResponse.json() as { success: boolean; asset: { id: string } };
      assetId = assetResult.asset.id;
    } else {
      // Fallback for local dev without DO
      assetId = crypto.randomUUID();
    }

    const input = {
      prompt: prompt.trim(),
      assetName: assetName.trim(),
      assetType,
      assetId,
      model,  // Let NanoBananaService use its default if undefined
      aspectRatio: aspectRatio || '1:1',
    };

    const job = await jobDAO.createJob({
      id: jobId,
      space_id: spaceId,
      type: 'generate',
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

    console.log('[Job Route] Sending generate message to GENERATION_QUEUE', {
      jobId,
      spaceId,
      assetName: input.assetName,
      assetType: input.assetType,
    });

    await env.GENERATION_QUEUE.send(message);

    console.log('[Job Route] Generate message sent successfully', { jobId });

    return c.json({
      success: true,
      jobId: job.id,
    }, 201);
  } catch (error) {
    console.error('[Job Route] Error creating generation job:', error);
    return c.json({ error: 'Failed to create generation job' }, 500);
  }
});

// POST /api/assets/:assetId/edit - New variant from edit (placeholder)
jobRoutes.post('/api/assets/:assetId/edit', async (c) => {
  return c.json({
    error: 'Not implemented - requires Durable Object',
  }, 501);
});

// POST /api/spaces/:id/compose - Create composite asset from multiple source variants
jobRoutes.post('/api/spaces/:id/compose', async (c) => {
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

    const spaceId = c.req.param('id');
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
    const { prompt, assetName, sourceVariantIds, model, aspectRatio } = body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return c.json({ error: 'Prompt is required and must be a non-empty string' }, 400);
    }

    if (!assetName || typeof assetName !== 'string' || assetName.trim().length === 0) {
      return c.json({ error: 'Asset name is required and must be a non-empty string' }, 400);
    }

    if (!Array.isArray(sourceVariantIds) || sourceVariantIds.length < 2) {
      return c.json({ error: 'At least 2 source variant IDs are required for composition' }, 400);
    }

    // Create job in D1
    const jobId = crypto.randomUUID();
    const now = Date.now();

    // Create composite asset in Durable Object first
    let assetId: string;
    if (env.SPACES_DO) {
      const doId = env.SPACES_DO.idFromName(spaceId);
      const doStub = env.SPACES_DO.get(doId);

      const doResponse = await doStub.fetch(new Request('http://do/internal/create-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: assetName.trim(),
          type: 'composite',
          createdBy: userId,
        }),
      }));

      if (!doResponse.ok) {
        const errorData = await doResponse.json() as { error?: string };
        return c.json({ error: errorData.error || 'Failed to create asset' }, 500);
      }

      const assetResult = await doResponse.json() as { success: boolean; asset: { id: string } };
      assetId = assetResult.asset.id;
    } else {
      assetId = crypto.randomUUID();
    }

    const input = {
      prompt: prompt.trim(),
      assetName: assetName.trim(),
      assetType: 'composite' as const,
      assetId,
      sourceVariantIds,
      model,  // Let NanoBananaService use its default if undefined
      aspectRatio: aspectRatio || '1:1',
    };

    const job = await jobDAO.createJob({
      id: jobId,
      space_id: spaceId,
      type: 'compose',
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

    console.log('[Job Route] Sending compose message to GENERATION_QUEUE', {
      jobId,
      spaceId,
      assetName: input.assetName,
      sourceVariantIds: input.sourceVariantIds,
    });

    await env.GENERATION_QUEUE.send(message);

    console.log('[Job Route] Compose message sent successfully', { jobId });

    return c.json({
      success: true,
      jobId: job.id,
    }, 201);
  } catch (error) {
    console.error('[Job Route] Error creating compose job:', error);
    return c.json({ error: 'Failed to create compose job' }, 500);
  }
});

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
