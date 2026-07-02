import { authMiddleware } from '../middleware/auth-middleware';
import { adminMiddleware } from '../middleware/admin-middleware';
import { SpaceDAO } from '../../dao/space-dao';
import { MemberDAO } from '../../dao/member-dao';
import { PlatformUsageEventDAO } from '../../dao/platform-usage-event-dao';
import { createOpenApiRouter, toApiSpace } from './openapi';
import type { AppContext } from './types';
import {
  createCollectionItemRoute,
  createCollectionRoute,
  deleteCollectionItemRoute,
  deleteCollectionRoute,
  deleteSpaceRoute,
  getSpaceRoute,
  getSupportSpaceRoute,
  getSpaceUsageSummaryRoute,
  listCollectionItemsRoute,
  listCollectionsRoute,
  listSpaceAssetsRoute,
  listSpacesRoute,
  postSpaceRoute,
  reorderCollectionItemsRoute,
  restoreSupportSpaceRoute,
  updateCollectionItemRoute,
  updateCollectionRoute,
} from '../../shared/api/routes';
import {
  CollectionItemResponseSchema,
  CollectionResponseSchema,
  ListCollectionItemsResponseSchema,
  ListCollectionsResponseSchema,
  ListSpaceAssetsResponseSchema,
  PlatformUsageSummaryResponseSchema,
  type Space,
} from '../../shared/api/schemas';

const spaceRoutes = createOpenApiRouter();

// All space routes require authentication
spaceRoutes.use('/api/spaces/*', authMiddleware);
spaceRoutes.use('/api/support/spaces/*', authMiddleware);
spaceRoutes.use('/api/support/spaces/*', adminMiddleware);

function normalizeUsageBound(value: string | undefined, name: 'from' | 'to'): string | null | { error: string } {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const normalized = `${value}T${name === 'from' ? '00:00:00.000' : '23:59:59.999'}Z`;
    const timestamp = new Date(normalized).getTime();
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
      return { error: `${name} must be a valid date or ISO timestamp` };
    }
    return normalized;
  }
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return { error: `${name} must be a valid date or ISO timestamp` };
  }
  return new Date(timestamp).toISOString();
}

function spaceDoFetch(
  env: AppContext['Bindings'],
  spaceId: string,
  path: string,
  init?: RequestInit
): Promise<Response> | null {
  if (!env.SPACES_DO) {
    return null;
  }
  const doStub = env.SPACES_DO.get(env.SPACES_DO.idFromName(spaceId));
  return doStub.fetch(new Request(`http://do${path}`, init));
}

function organizationFailure(status: number, message: string, fallbackStatus = 500): any {
  if (status === 400) {
    return Response.json({ error: message }, { status: 400 });
  }
  if (status === 404) {
    return Response.json({ error: message }, { status: 404 });
  }
  if (status === 409) {
    return Response.json({ error: message, code: 'DEFAULT_STYLE_PRESET_CONFLICT' }, { status: 409 });
  }
  return Response.json({ error: message }, { status: fallbackStatus });
}

// POST /api/spaces - Create space
spaceRoutes.openapi(postSpaceRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const container = c.get('container');
  const spaceDAO = container.get(SpaceDAO);
  const memberDAO = container.get(MemberDAO);

  // Get and validate request body
  const body = c.req.valid('json');
  const { name } = body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return c.json({ error: 'Name is required and must be a non-empty string' }, 400);
  }

  // Generate space ID
  const spaceId = crypto.randomUUID();
  const now = Date.now();

  // Create space
  const space = await spaceDAO.createSpace({
    id: spaceId,
    name: name.trim(),
    owner_id: userId,
    created_at: now,
  });

  // Automatically add creator as owner member
  await memberDAO.addMember({
    space_id: spaceId,
    user_id: userId,
    role: 'owner',
    joined_at: now,
  });

  return c.json({
    success: true as const,
    space: toApiSpace(space, 'owner'), // Creator is always the owner
  }, 201);
});

// GET /api/spaces - List user's spaces
spaceRoutes.openapi(listSpacesRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const spaceDAO = c.get('container').get(SpaceDAO);

  // Get all spaces where user is a member
  const spaces = await spaceDAO.getSpacesForUser(userId);

  return c.json({
    success: true as const,
    spaces: spaces.map(space => toApiSpace(space, space.role as Space['role'])),
  }, 200);
});

// GET /api/spaces/:id - Get space (D1 metadata)
spaceRoutes.openapi(getSpaceRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const container = c.get('container');
  const spaceDAO = container.get(SpaceDAO);
  const memberDAO = container.get(MemberDAO);

  const { id: spaceId } = c.req.valid('param');

  // Check if user is a member of this space
  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }

  // Get space metadata
  const space = await spaceDAO.getSpaceById(spaceId);
  if (!space) {
    return c.json({ error: 'Space not found' }, 404);
  }

  return c.json({
    success: true as const,
    space: toApiSpace(space, member.role),
  }, 200);
});

// GET /api/support/spaces/:id - Support read path including soft-deleted rows
spaceRoutes.openapi(getSupportSpaceRoute, async (c) => {
  const container = c.get('container');
  const spaceDAO = container.get(SpaceDAO);
  const { id: spaceId } = c.req.valid('param');

  const space = await spaceDAO.getSpaceByIdIncludingDeleted(spaceId);
  if (!space) {
    return c.json({ error: 'Space not found or already purged' }, 404);
  }

  const memberships = await spaceDAO.getSpaceMembersIncludingDeleted(spaceId);
  return c.json({
    success: true as const,
    space: {
      id: space.id,
      name: space.name,
      owner_id: space.owner_id,
      created_at: space.created_at,
      deleted_at: space.deleted_at,
    },
    memberships,
  }, 200);
});

// POST /api/support/spaces/:id/restore - Restore a soft-deleted space
spaceRoutes.openapi(restoreSupportSpaceRoute, async (c) => {
  const userId = Number(c.get('userId')!);
  const container = c.get('container');
  const spaceDAO = container.get(SpaceDAO);
  const { id: spaceId } = c.req.valid('param');

  const space = await spaceDAO.getSpaceByIdIncludingDeleted(spaceId);
  if (!space) {
    return c.json({ error: 'Space not found or already purged' }, 404);
  }
  if (!space.deleted_at) {
    return c.json({ error: 'Space is not deleted' }, 409);
  }
  if (!c.env.SPACES_DO) {
    return c.json({ error: 'Asset storage not available' }, 503);
  }

  const unarchiveResponse = await spaceDoFetch(c.env, spaceId, '/internal/unarchive', {
    method: 'POST',
    headers: { 'X-Space-Id': spaceId },
  });
  if (!unarchiveResponse?.ok) {
    const message = unarchiveResponse
      ? await readSpaceDoError(unarchiveResponse, 'Failed to restore active space sessions')
      : 'Asset storage not available';
    return c.json({ error: message }, unarchiveResponse?.status === 404 ? 404 : 500);
  }

  let restored;
  try {
    restored = await spaceDAO.restoreDeletedSpace(spaceId, userId);
  } catch (error) {
    await spaceDoFetch(c.env, spaceId, '/internal/archive', {
      method: 'POST',
      headers: { 'X-Space-Id': spaceId },
    });
    return c.json({
      error: error instanceof Error ? error.message : 'Failed to restore space',
    }, 500);
  }
  if (!restored) {
    const current = await spaceDAO.getSpaceByIdIncludingDeleted(spaceId);
    if (current && !current.deleted_at) {
      const memberships = await spaceDAO.getSpaceMembersIncludingDeleted(spaceId);
      return c.json({
        success: true as const,
        space: {
          id: current.id,
          name: current.name,
          owner_id: current.owner_id,
          created_at: current.created_at,
          deleted_at: current.deleted_at,
        },
        membershipsVisible: memberships.filter(member => member.deleted_at === null).length,
        previousDeletedAt: space.deleted_at,
        auditLogId: null,
        message: 'Space was already restored.',
      }, 200);
    }

    await spaceDoFetch(c.env, spaceId, '/internal/archive', {
      method: 'POST',
      headers: { 'X-Space-Id': spaceId },
    });
    return c.json({ error: current ? 'Space is not deleted' : 'Space not found or already purged' }, current ? 409 : 404);
  }

  console.log('[Support] Restored soft-deleted space', {
    spaceId,
    restoredByUserId: userId,
    auditLogId: restored.auditLogId,
  });

  return c.json({
    success: true as const,
    space: {
      id: restored.space.id,
      name: restored.space.name,
      owner_id: restored.space.owner_id,
      created_at: restored.space.created_at,
      deleted_at: restored.space.deleted_at,
    },
    membershipsVisible: restored.membershipsVisible,
    previousDeletedAt: restored.previousDeletedAt,
    auditLogId: restored.auditLogId,
    message: 'Space restored successfully.',
  }, 200);
});

// GET /api/spaces/:id/assets - List all assets in a space
spaceRoutes.openapi(listSpaceAssetsRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const container = c.get('container');
  const memberDAO = container.get(MemberDAO);
  const env = c.env;

  const { id: spaceId } = c.req.valid('param');

  // Check if user is a member of this space
  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }

  // Get assets from SpaceDO
  if (!env.SPACES_DO) {
    return c.json({ error: 'Asset storage not available' }, 503);
  }

  const doId = env.SPACES_DO.idFromName(spaceId);
  const doStub = env.SPACES_DO.get(doId);

  const doResponse = await doStub.fetch(new Request('http://do/internal/state', {
    method: 'GET',
  }));

  if (!doResponse.ok) {
    return c.json({ error: 'Failed to fetch assets' }, 500);
  }

  const state = await doResponse.json() as { assets: unknown[] };

  const payload = ListSpaceAssetsResponseSchema.parse({
    success: true as const,
    assets: state.assets,
  });

  return c.json(payload, 200);
});

// GET /api/spaces/:id/collections - List collections
spaceRoutes.openapi(listCollectionsRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const { id: spaceId } = c.req.valid('param');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }

  const doResponse = spaceDoFetch(c.env, spaceId, '/internal/collections');
  if (!doResponse) {
    return c.json({ error: 'Asset storage not available' }, 503);
  }
  const response = await doResponse;
  if (!response.ok) {
    const message = await readSpaceDoError(response, 'Failed to fetch collections');
    return c.json({ error: message }, 500);
  }
  return c.json(ListCollectionsResponseSchema.parse(await response.json()), 200);
});

// POST /api/spaces/:id/collections - Create collection
spaceRoutes.openapi(createCollectionRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const { id: spaceId } = c.req.valid('param');
  const body = c.req.valid('json');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }
  if (member.role === 'viewer') {
    return c.json({ error: 'Viewers cannot modify collections' }, 403);
  }

  const doResponse = spaceDoFetch(c.env, spaceId, '/internal/collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, createdBy: userId }),
  });
  if (!doResponse) {
    return c.json({ error: 'Asset storage not available' }, 503);
  }
  const response = await doResponse;
  if (!response.ok) {
    const message = await readSpaceDoError(response, 'Failed to create collection');
    return organizationFailure(response.status, message);
  }
  return c.json(CollectionResponseSchema.parse(await response.json()), 200);
});

spaceRoutes.openapi(updateCollectionRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const { id: spaceId, collectionId } = c.req.valid('param');
  const body = c.req.valid('json');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) return c.json({ error: 'Access denied' }, 403);
  if (member.role === 'viewer') return c.json({ error: 'Viewers cannot modify collections' }, 403);

  const doResponse = spaceDoFetch(c.env, spaceId, `/internal/collections/${encodeURIComponent(collectionId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!doResponse) return c.json({ error: 'Asset storage not available' }, 503);
  const response = await doResponse;
  if (!response.ok) {
    const message = await readSpaceDoError(response, 'Failed to update collection');
    return organizationFailure(response.status, message);
  }
  return c.json(CollectionResponseSchema.parse(await response.json()), 200);
});

spaceRoutes.openapi(deleteCollectionRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const { id: spaceId, collectionId } = c.req.valid('param');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) return c.json({ error: 'Access denied' }, 403);
  if (member.role === 'viewer') return c.json({ error: 'Viewers cannot delete collections' }, 403);

  const doResponse = spaceDoFetch(c.env, spaceId, `/internal/collections/${encodeURIComponent(collectionId)}`, { method: 'DELETE' });
  if (!doResponse) return c.json({ error: 'Asset storage not available' }, 503);
  const response = await doResponse;
  if (!response.ok) {
    const message = await readSpaceDoError(response, 'Failed to delete collection');
    return organizationFailure(response.status, message);
  }
  return c.json({ success: true as const }, 200);
});

spaceRoutes.openapi(listCollectionItemsRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const { id: spaceId, collectionId } = c.req.valid('param');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) return c.json({ error: 'Access denied' }, 403);

  const doResponse = spaceDoFetch(c.env, spaceId, `/internal/collections/${encodeURIComponent(collectionId)}/items`);
  if (!doResponse) return c.json({ error: 'Asset storage not available' }, 503);
  const response = await doResponse;
  if (!response.ok) {
    const message = await readSpaceDoError(response, 'Failed to fetch collection items');
    return organizationFailure(response.status, message);
  }
  return c.json(ListCollectionItemsResponseSchema.parse(await response.json()), 200);
});

spaceRoutes.openapi(createCollectionItemRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const { id: spaceId, collectionId } = c.req.valid('param');
  const body = c.req.valid('json');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) return c.json({ error: 'Access denied' }, 403);
  if (member.role === 'viewer') return c.json({ error: 'Viewers cannot modify collection items' }, 403);

  const doResponse = spaceDoFetch(c.env, spaceId, `/internal/collections/${encodeURIComponent(collectionId)}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, createdBy: userId }),
  });
  if (!doResponse) return c.json({ error: 'Asset storage not available' }, 503);
  const response = await doResponse;
  if (!response.ok) {
    const message = await readSpaceDoError(response, 'Failed to create collection item');
    return organizationFailure(response.status, message);
  }
  return c.json(CollectionItemResponseSchema.parse(await response.json()), 200);
});

spaceRoutes.openapi(updateCollectionItemRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const { id: spaceId, collectionId, itemId } = c.req.valid('param');
  const body = c.req.valid('json');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) return c.json({ error: 'Access denied' }, 403);
  if (member.role === 'viewer') return c.json({ error: 'Viewers cannot modify collection items' }, 403);

  const doResponse = spaceDoFetch(c.env, spaceId, `/internal/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!doResponse) return c.json({ error: 'Asset storage not available' }, 503);
  const response = await doResponse;
  if (!response.ok) {
    const message = await readSpaceDoError(response, 'Failed to update collection item');
    return organizationFailure(response.status, message);
  }
  return c.json(CollectionItemResponseSchema.parse(await response.json()), 200);
});

spaceRoutes.openapi(reorderCollectionItemsRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const { id: spaceId, collectionId } = c.req.valid('param');
  const body = c.req.valid('json');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) return c.json({ error: 'Access denied' }, 403);
  if (member.role === 'viewer') return c.json({ error: 'Viewers cannot reorder collection items' }, 403);

  const doResponse = spaceDoFetch(c.env, spaceId, `/internal/collections/${encodeURIComponent(collectionId)}/items/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!doResponse) return c.json({ error: 'Asset storage not available' }, 503);
  const response = await doResponse;
  if (!response.ok) {
    const message = await readSpaceDoError(response, 'Failed to reorder collection items');
    return organizationFailure(response.status, message);
  }
  return c.json(ListCollectionItemsResponseSchema.parse(await response.json()), 200);
});

spaceRoutes.openapi(deleteCollectionItemRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const { id: spaceId, collectionId, itemId } = c.req.valid('param');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) return c.json({ error: 'Access denied' }, 403);
  if (member.role === 'viewer') return c.json({ error: 'Viewers cannot delete collection items' }, 403);

  const doResponse = spaceDoFetch(c.env, spaceId, `/internal/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
  if (!doResponse) return c.json({ error: 'Asset storage not available' }, 503);
  const response = await doResponse;
  if (!response.ok) {
    const message = await readSpaceDoError(response, 'Failed to delete collection item');
    return organizationFailure(response.status, message);
  }
  return c.json({ success: true as const }, 200);
});

// GET /api/spaces/:id/usage/summary - Platform usage summary for a space
spaceRoutes.openapi(getSpaceUsageSummaryRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const container = c.get('container');
  const memberDAO = container.get(MemberDAO);
  const usageDAO = container.get(PlatformUsageEventDAO);

  const { id: spaceId } = c.req.valid('param');
  const query = c.req.valid('query');
  const from = normalizeUsageBound(query.from, 'from');
  if (from && typeof from !== 'string') {
    return c.json({ error: from.error }, 400);
  }
  const to = normalizeUsageBound(query.to, 'to');
  if (to && typeof to !== 'string') {
    return c.json({ error: to.error }, 400);
  }
  if (from && to && new Date(from).getTime() > new Date(to).getTime()) {
    return c.json({ error: 'from must be before to' }, 400);
  }

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }

  const summary = await usageDAO.getSpaceSummary(spaceId, { from, to });
  const payload = PlatformUsageSummaryResponseSchema.parse({
    success: true as const,
    ...summary,
  });
  return c.json(payload, 200);
});

// DELETE /api/spaces/:id - Delete space (owner only)
spaceRoutes.openapi(deleteSpaceRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const container = c.get('container');
  const spaceDAO = container.get(SpaceDAO);
  const memberDAO = container.get(MemberDAO);

  const { id: spaceId } = c.req.valid('param');

  // Get space to verify ownership
  const space = await spaceDAO.getSpaceById(spaceId);
  if (!space) {
    return c.json({ error: 'Space not found' }, 404);
  }

  // Check if user is the owner
  const member = await memberDAO.getMember(spaceId, userId);
  if (!member || member.role !== 'owner') {
    return c.json({ error: 'Only the space owner can delete the space' }, 403);
  }
  if (!c.env.SPACES_DO) {
    return c.json({ error: 'Asset storage not available' }, 503);
  }

  const archiveResponse = await spaceDoFetch(c.env, spaceId, '/internal/archive', {
    method: 'POST',
    headers: { 'X-Space-Id': spaceId },
  });
  if (!archiveResponse?.ok) {
    const message = archiveResponse
      ? await readSpaceDoError(archiveResponse, 'Failed to close active space sessions')
      : 'Asset storage not available';
    return c.json({ error: message }, archiveResponse?.status === 404 ? 404 : 500);
  }

  // Soft-delete the space. Membership rows are retained so support can restore
  // accidental deletes with the original shared-space context intact.
  const deleted = await spaceDAO.deleteSpace(spaceId);
  if (!deleted) {
    await spaceDoFetch(c.env, spaceId, '/internal/unarchive', {
      method: 'POST',
      headers: { 'X-Space-Id': spaceId },
    });
    return c.json({ error: 'Failed to delete space' }, 500);
  }

  return c.json({
    success: true as const,
    message: 'Space archived successfully. Support can restore it during the retention window.',
  }, 200);
});

async function readSpaceDoError(response: Response, fallback: string): Promise<string> {
  let message = fallback;
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === 'string') {
      message = body.error;
    }
  } catch {
    // Keep fallback message.
  }
  return message;
}

export { spaceRoutes };
