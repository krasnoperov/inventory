import { Hono } from 'hono';
import type { AppContext } from './types';
import { authMiddleware } from '../middleware/auth-middleware';
import { JobDAO } from '../../dao/job-dao';
import { MemberDAO } from '../../dao/member-dao';

const jobRoutes = new Hono<AppContext>();

// All job routes require authentication
jobRoutes.use('*', authMiddleware);

// ============================================================================
// DEPRECATED ENDPOINTS (REMOVED)
// ============================================================================
// NOTE: POST /api/spaces/:spaceId/assets has been removed.
// Asset creation is now handled via WebSocket generate:request messages through SpaceDO → GenerationWorkflow.
//
// NOTE: POST /api/spaces/:spaceId/assets/:assetId/variants has been removed.
// Variant creation is now handled via WebSocket refine:request messages through SpaceDO → GenerationWorkflow.

// ============================================================================
// READ/QUERY ENDPOINTS
// ============================================================================

// GET /api/spaces/:id/assets/:assetId - Get asset details with variants and lineage
jobRoutes.get('/api/spaces/:id/assets/:assetId', async (c) => {
  const userId = c.get('userId')!;
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;

  const spaceId = c.req.param('id');
  const assetId = c.req.param('assetId');
  const userIdStr = String(userId);

  // Verify user is member of space
  const member = await memberDAO.getMember(spaceId, userIdStr);
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
});

// GET /api/spaces/:id/variants/:variantId/lineage - Get lineage for a variant
jobRoutes.get('/api/spaces/:id/variants/:variantId/lineage', async (c) => {
  const userId = c.get('userId')!;
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;

  const spaceId = c.req.param('id');
  const variantId = c.req.param('variantId');
  const userIdStr = String(userId);

  // Verify user is member of space
  const member = await memberDAO.getMember(spaceId, userIdStr);
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
});

// GET /api/spaces/:id/variants/:variantId/lineage/graph - Get full lineage graph
jobRoutes.get('/api/spaces/:id/variants/:variantId/lineage/graph', async (c) => {
  const userId = c.get('userId')!;
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;

  const spaceId = c.req.param('id');
  const variantId = c.req.param('variantId');
  const userIdStr = String(userId);

  // Verify user is member of space
  const member = await memberDAO.getMember(spaceId, userIdStr);
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
});

// PATCH /api/spaces/:id/assets/:assetId/parent - Re-parent asset
jobRoutes.patch('/api/spaces/:id/assets/:assetId/parent', async (c) => {
  const userId = c.get('userId')!;
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;

  const spaceId = c.req.param('id');
  const assetId = c.req.param('assetId');
  const userIdStr = String(userId);

  // Verify user is member of space with editor or owner role
  const member = await memberDAO.getMember(spaceId, userIdStr);
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
});

// GET /api/spaces/:id/assets/:assetId/children - Get child assets
jobRoutes.get('/api/spaces/:id/assets/:assetId/children', async (c) => {
  const userId = c.get('userId')!;
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;

  const spaceId = c.req.param('id');
  const assetId = c.req.param('assetId');
  const userIdStr = String(userId);

  // Verify user is member of space
  const member = await memberDAO.getMember(spaceId, userIdStr);
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
});

// GET /api/spaces/:id/assets/:assetId/ancestors - Get ancestor chain (breadcrumbs)
jobRoutes.get('/api/spaces/:id/assets/:assetId/ancestors', async (c) => {
  const userId = c.get('userId')!;
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;

  const spaceId = c.req.param('id');
  const assetId = c.req.param('assetId');
  const userIdStr = String(userId);

  // Verify user is member of space
  const member = await memberDAO.getMember(spaceId, userIdStr);
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
});

// PATCH /api/spaces/:id/variants/:variantId/star - Toggle star status
jobRoutes.patch('/api/spaces/:id/variants/:variantId/star', async (c) => {
  const userId = c.get('userId')!;
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;

  const spaceId = c.req.param('id');
  const variantId = c.req.param('variantId');
  const userIdStr = String(userId);

  // Verify user is member of space with editor or owner role
  const member = await memberDAO.getMember(spaceId, userIdStr);
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
});

// PATCH /api/spaces/:id/lineage/:lineageId/sever - Sever lineage link
jobRoutes.patch('/api/spaces/:id/lineage/:lineageId/sever', async (c) => {
  const userId = c.get('userId')!;
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;

  const spaceId = c.req.param('id');
  const lineageId = c.req.param('lineageId');
  const userIdStr = String(userId);

  // Verify user is member of space with editor or owner role
  const member = await memberDAO.getMember(spaceId, userIdStr);
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
});

// GET /api/jobs/:id - Get job status
jobRoutes.get('/api/jobs/:id', async (c) => {
  const userId = c.get('userId')!;
  const container = c.get('container');
  const jobDAO = container.get(JobDAO);
  const memberDAO = container.get(MemberDAO);

  const jobId = c.req.param('id');
  const userIdStr = String(userId);

  // Get job from database
  const job = await jobDAO.getJobById(jobId);
  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  // Check if user created the job OR is a member of the job's space
  const isCreator = job.created_by === userIdStr;
  const member = await memberDAO.getMember(job.space_id, userIdStr);
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
});

// POST /api/jobs/:id/retry - Retry stuck or failed job
jobRoutes.post('/api/jobs/:id/retry', async (c) => {
  const userId = c.get('userId')!;
  const container = c.get('container');
  const jobDAO = container.get(JobDAO);
  const memberDAO = container.get(MemberDAO);
  const env = c.env;

  const jobId = c.req.param('id');
  const userIdStr = String(userId);

  // Get job from database
  const job = await jobDAO.getJobById(jobId);
  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  // Check if user created the job OR is a member of the job's space
  const isCreator = job.created_by === userIdStr;
  const member = await memberDAO.getMember(job.space_id, userIdStr);
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
});

export { jobRoutes };
