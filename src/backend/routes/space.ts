import { authMiddleware } from '../middleware/auth-middleware';
import { SpaceDAO } from '../../dao/space-dao';
import { MemberDAO } from '../../dao/member-dao';
import { PlatformUsageEventDAO } from '../../dao/platform-usage-event-dao';
import { createOpenApiRouter, toApiSpace } from './openapi';
import type { AppContext } from './types';
import {
  createCollectionItemRoute,
  createCollectionRoute,
  createCompositionItemRoute,
  createCompositionRoute,
  createRelationRoute,
  deleteCollectionItemRoute,
  deleteCollectionRoute,
  deleteCompositionItemRoute,
  deleteCompositionRoute,
  deleteRelationRoute,
  deleteSpaceRoute,
  deleteProductionCueRoute,
  deleteProductionPlacementRoute,
  deleteProductionRecordRoute,
  deleteProductionRoute,
  deleteProductionShotRoute,
  getSpaceRoute,
  getProductionRoute,
  getSpaceUsageSummaryRoute,
  listCollectionItemsRoute,
  listCollectionsRoute,
  listCompositionItemsRoute,
  listCompositionsRoute,
  listProductionRecordsRoute,
  listProductionsRoute,
  listRelationsRoute,
  listSpaceAssetsRoute,
  listSpacesRoute,
  placeProductionRecordRoute,
  postSpaceRoute,
  upsertProductionCueRoute,
  upsertProductionPlacementRoute,
  upsertProductionRoute,
  upsertProductionShotRoute,
  reorderCollectionItemsRoute,
  reorderCompositionItemsRoute,
  updateCollectionItemRoute,
  updateCollectionRoute,
  updateCompositionItemRoute,
  updateCompositionRoute,
  updateRelationRoute,
} from '../../shared/api/routes';
import {
  CollectionItemResponseSchema,
  CollectionResponseSchema,
  CompositionItemResponseSchema,
  CompositionResponseSchema,
  ListCollectionItemsResponseSchema,
  ListCollectionsResponseSchema,
  ListCompositionItemsResponseSchema,
  ListCompositionsResponseSchema,
  ListProductionRecordsResponseSchema,
  ListProductionsResponseSchema,
  ListRelationsResponseSchema,
  ListSpaceAssetsResponseSchema,
  PlatformUsageSummaryResponseSchema,
  ProductionCueResponseSchema,
  ProductionDetailResponseSchema,
  ProductionPlacementResponseSchema,
  ProductionRecordResponseSchema,
  ProductionResponseSchema,
  ProductionShotResponseSchema,
  RelationResponseSchema,
  type Space,
} from '../../shared/api/schemas';

const spaceRoutes = createOpenApiRouter();

// All space routes require authentication
spaceRoutes.use('/api/spaces/*', authMiddleware);

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

spaceRoutes.openapi(listRelationsRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const { id: spaceId } = c.req.valid('param');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) return c.json({ error: 'Access denied' }, 403);

  const doResponse = spaceDoFetch(c.env, spaceId, '/internal/relations');
  if (!doResponse) return c.json({ error: 'Asset storage not available' }, 503);
  const response = await doResponse;
  if (!response.ok) {
    const message = await readSpaceDoError(response, 'Failed to fetch relations');
    return organizationFailure(response.status, message);
  }
  return c.json(ListRelationsResponseSchema.parse(await response.json()), 200);
});

spaceRoutes.openapi(createRelationRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const { id: spaceId } = c.req.valid('param');
  const body = c.req.valid('json');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) return c.json({ error: 'Access denied' }, 403);
  if (member.role === 'viewer') return c.json({ error: 'Viewers cannot modify relations' }, 403);

  const doResponse = spaceDoFetch(c.env, spaceId, '/internal/relations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, createdBy: userId }),
  });
  if (!doResponse) return c.json({ error: 'Asset storage not available' }, 503);
  const response = await doResponse;
  if (!response.ok) {
    const message = await readSpaceDoError(response, 'Failed to create relation');
    return organizationFailure(response.status, message);
  }
  return c.json(RelationResponseSchema.parse(await response.json()), 200);
});

spaceRoutes.openapi(updateRelationRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const { id: spaceId, relationId } = c.req.valid('param');
  const body = c.req.valid('json');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) return c.json({ error: 'Access denied' }, 403);
  if (member.role === 'viewer') return c.json({ error: 'Viewers cannot modify relations' }, 403);

  const doResponse = spaceDoFetch(c.env, spaceId, `/internal/relations/${encodeURIComponent(relationId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!doResponse) return c.json({ error: 'Asset storage not available' }, 503);
  const response = await doResponse;
  if (!response.ok) {
    const message = await readSpaceDoError(response, 'Failed to update relation');
    return organizationFailure(response.status, message);
  }
  return c.json(RelationResponseSchema.parse(await response.json()), 200);
});

spaceRoutes.openapi(deleteRelationRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const { id: spaceId, relationId } = c.req.valid('param');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) return c.json({ error: 'Access denied' }, 403);
  if (member.role === 'viewer') return c.json({ error: 'Viewers cannot delete relations' }, 403);

  const doResponse = spaceDoFetch(c.env, spaceId, `/internal/relations/${encodeURIComponent(relationId)}`, { method: 'DELETE' });
  if (!doResponse) return c.json({ error: 'Asset storage not available' }, 503);
  const response = await doResponse;
  if (!response.ok) {
    const message = await readSpaceDoError(response, 'Failed to delete relation');
    return organizationFailure(response.status, message);
  }
  return c.json({ success: true as const }, 200);
});

spaceRoutes.openapi(listCompositionsRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const { id: spaceId } = c.req.valid('param');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) return c.json({ error: 'Access denied' }, 403);

  const doResponse = spaceDoFetch(c.env, spaceId, '/internal/compositions');
  if (!doResponse) return c.json({ error: 'Asset storage not available' }, 503);
  const response = await doResponse;
  if (!response.ok) {
    const message = await readSpaceDoError(response, 'Failed to fetch compositions');
    return organizationFailure(response.status, message);
  }
  return c.json(ListCompositionsResponseSchema.parse(await response.json()), 200);
});

spaceRoutes.openapi(createCompositionRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const { id: spaceId } = c.req.valid('param');
  const body = c.req.valid('json');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) return c.json({ error: 'Access denied' }, 403);
  if (member.role === 'viewer') return c.json({ error: 'Viewers cannot modify compositions' }, 403);

  const doResponse = spaceDoFetch(c.env, spaceId, '/internal/compositions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, createdBy: userId }),
  });
  if (!doResponse) return c.json({ error: 'Asset storage not available' }, 503);
  const response = await doResponse;
  if (!response.ok) {
    const message = await readSpaceDoError(response, 'Failed to create composition');
    return organizationFailure(response.status, message);
  }
  return c.json(CompositionResponseSchema.parse(await response.json()), 200);
});

spaceRoutes.openapi(updateCompositionRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const { id: spaceId, compositionId } = c.req.valid('param');
  const body = c.req.valid('json');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) return c.json({ error: 'Access denied' }, 403);
  if (member.role === 'viewer') return c.json({ error: 'Viewers cannot modify compositions' }, 403);

  const doResponse = spaceDoFetch(c.env, spaceId, `/internal/compositions/${encodeURIComponent(compositionId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!doResponse) return c.json({ error: 'Asset storage not available' }, 503);
  const response = await doResponse;
  if (!response.ok) {
    const message = await readSpaceDoError(response, 'Failed to update composition');
    return organizationFailure(response.status, message);
  }
  return c.json(CompositionResponseSchema.parse(await response.json()), 200);
});

spaceRoutes.openapi(deleteCompositionRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const { id: spaceId, compositionId } = c.req.valid('param');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) return c.json({ error: 'Access denied' }, 403);
  if (member.role === 'viewer') return c.json({ error: 'Viewers cannot delete compositions' }, 403);

  const doResponse = spaceDoFetch(c.env, spaceId, `/internal/compositions/${encodeURIComponent(compositionId)}`, { method: 'DELETE' });
  if (!doResponse) return c.json({ error: 'Asset storage not available' }, 503);
  const response = await doResponse;
  if (!response.ok) {
    const message = await readSpaceDoError(response, 'Failed to delete composition');
    return organizationFailure(response.status, message);
  }
  return c.json({ success: true as const }, 200);
});

spaceRoutes.openapi(listCompositionItemsRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const { id: spaceId, compositionId } = c.req.valid('param');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) return c.json({ error: 'Access denied' }, 403);

  const doResponse = spaceDoFetch(c.env, spaceId, `/internal/compositions/${encodeURIComponent(compositionId)}/items`);
  if (!doResponse) return c.json({ error: 'Asset storage not available' }, 503);
  const response = await doResponse;
  if (!response.ok) {
    const message = await readSpaceDoError(response, 'Failed to fetch composition items');
    return organizationFailure(response.status, message);
  }
  return c.json(ListCompositionItemsResponseSchema.parse(await response.json()), 200);
});

spaceRoutes.openapi(createCompositionItemRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const { id: spaceId, compositionId } = c.req.valid('param');
  const body = c.req.valid('json');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) return c.json({ error: 'Access denied' }, 403);
  if (member.role === 'viewer') return c.json({ error: 'Viewers cannot modify composition items' }, 403);

  const doResponse = spaceDoFetch(c.env, spaceId, `/internal/compositions/${encodeURIComponent(compositionId)}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, createdBy: userId }),
  });
  if (!doResponse) return c.json({ error: 'Asset storage not available' }, 503);
  const response = await doResponse;
  if (!response.ok) {
    const message = await readSpaceDoError(response, 'Failed to create composition item');
    return organizationFailure(response.status, message);
  }
  return c.json(CompositionItemResponseSchema.parse(await response.json()), 200);
});

spaceRoutes.openapi(updateCompositionItemRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const { id: spaceId, compositionId, itemId } = c.req.valid('param');
  const body = c.req.valid('json');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) return c.json({ error: 'Access denied' }, 403);
  if (member.role === 'viewer') return c.json({ error: 'Viewers cannot modify composition items' }, 403);

  const doResponse = spaceDoFetch(c.env, spaceId, `/internal/compositions/${encodeURIComponent(compositionId)}/items/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!doResponse) return c.json({ error: 'Asset storage not available' }, 503);
  const response = await doResponse;
  if (!response.ok) {
    const message = await readSpaceDoError(response, 'Failed to update composition item');
    return organizationFailure(response.status, message);
  }
  return c.json(CompositionItemResponseSchema.parse(await response.json()), 200);
});

spaceRoutes.openapi(reorderCompositionItemsRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const { id: spaceId, compositionId } = c.req.valid('param');
  const body = c.req.valid('json');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) return c.json({ error: 'Access denied' }, 403);
  if (member.role === 'viewer') return c.json({ error: 'Viewers cannot reorder composition items' }, 403);

  const doResponse = spaceDoFetch(c.env, spaceId, `/internal/compositions/${encodeURIComponent(compositionId)}/items/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!doResponse) return c.json({ error: 'Asset storage not available' }, 503);
  const response = await doResponse;
  if (!response.ok) {
    const message = await readSpaceDoError(response, 'Failed to reorder composition items');
    return organizationFailure(response.status, message);
  }
  return c.json(ListCompositionItemsResponseSchema.parse(await response.json()), 200);
});

spaceRoutes.openapi(deleteCompositionItemRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const { id: spaceId, compositionId, itemId } = c.req.valid('param');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) return c.json({ error: 'Access denied' }, 403);
  if (member.role === 'viewer') return c.json({ error: 'Viewers cannot delete composition items' }, 403);

  const doResponse = spaceDoFetch(c.env, spaceId, `/internal/compositions/${encodeURIComponent(compositionId)}/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
  if (!doResponse) return c.json({ error: 'Asset storage not available' }, 503);
  const response = await doResponse;
  if (!response.ok) {
    const message = await readSpaceDoError(response, 'Failed to delete composition item');
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

// GET /api/spaces/:id/productions - List productions
spaceRoutes.openapi(listProductionsRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;
  const { id: spaceId } = c.req.valid('param');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }
  if (!env.SPACES_DO) {
    return c.json({ error: 'Asset storage not available' }, 503);
  }

  const doResponse = await env.SPACES_DO.get(env.SPACES_DO.idFromName(spaceId)).fetch(new Request('http://do/internal/productions'));
  if (!doResponse.ok) {
    const message = await readSpaceDoError(doResponse, 'Failed to fetch productions');
    return c.json({ error: message }, 500);
  }

  return c.json(ListProductionsResponseSchema.parse(await doResponse.json()), 200);
});

// POST /api/spaces/:id/productions - Create/update production
spaceRoutes.openapi(upsertProductionRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;
  const { id: spaceId } = c.req.valid('param');
  const body = c.req.valid('json');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }
  if (member.role === 'viewer') {
    return c.json({ error: 'Viewers cannot modify productions' }, 403);
  }
  if (!env.SPACES_DO) {
    return c.json({ error: 'Asset storage not available' }, 503);
  }

  const doResponse = await env.SPACES_DO.get(env.SPACES_DO.idFromName(spaceId)).fetch(new Request('http://do/internal/productions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, createdBy: userId }),
  }));
  if (!doResponse.ok) {
    const message = await readSpaceDoError(doResponse, 'Failed to save production');
    if (doResponse.status === 400) {
      return c.json({ error: message }, 400);
    }
    return c.json({ error: message }, 500);
  }

  return c.json(ProductionResponseSchema.parse(await doResponse.json()), 200);
});

// GET /api/spaces/:id/productions/:productionId - Production detail
spaceRoutes.openapi(getProductionRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;
  const { id: spaceId, productionId } = c.req.valid('param');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }
  if (!env.SPACES_DO) {
    return c.json({ error: 'Asset storage not available' }, 503);
  }

  const doResponse = await env.SPACES_DO.get(env.SPACES_DO.idFromName(spaceId)).fetch(
    new Request(`http://do/internal/productions/${encodeURIComponent(productionId)}`)
  );
  if (!doResponse.ok) {
    const message = await readSpaceDoError(doResponse, 'Failed to fetch production');
    if (doResponse.status === 404) {
      return c.json({ error: message }, 404);
    }
    return c.json({ error: message }, 500);
  }

  return c.json(ProductionDetailResponseSchema.parse(await doResponse.json()), 200);
});

// DELETE /api/spaces/:id/productions/:productionId - Delete production
spaceRoutes.openapi(deleteProductionRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;
  const { id: spaceId, productionId } = c.req.valid('param');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }
  if (member.role === 'viewer') {
    return c.json({ error: 'Viewers cannot delete productions' }, 403);
  }
  if (!env.SPACES_DO) {
    return c.json({ error: 'Asset storage not available' }, 503);
  }

  const doResponse = await env.SPACES_DO.get(env.SPACES_DO.idFromName(spaceId)).fetch(
    new Request(`http://do/internal/productions/${encodeURIComponent(productionId)}`, { method: 'DELETE' })
  );
  if (!doResponse.ok) {
    const message = await readSpaceDoError(doResponse, 'Failed to delete production');
    if (doResponse.status === 404) {
      return c.json({ error: message }, 404);
    }
    return c.json({ error: message }, 500);
  }

  return c.json({ success: true as const }, 200);
});

// POST /api/spaces/:id/productions/:productionId/shots - Create/update shot
spaceRoutes.openapi(upsertProductionShotRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;
  const { id: spaceId, productionId } = c.req.valid('param');
  const body = c.req.valid('json');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }
  if (member.role === 'viewer') {
    return c.json({ error: 'Viewers cannot modify production shots' }, 403);
  }
  if (!env.SPACES_DO) {
    return c.json({ error: 'Asset storage not available' }, 503);
  }

  const doResponse = await env.SPACES_DO.get(env.SPACES_DO.idFromName(spaceId)).fetch(new Request(`http://do/internal/productions/${encodeURIComponent(productionId)}/shots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, createdBy: userId }),
  }));
  if (!doResponse.ok) {
    const message = await readSpaceDoError(doResponse, 'Failed to save production shot');
    if (doResponse.status === 400) {
      return c.json({ error: message }, 400);
    }
    if (doResponse.status === 404) {
      return c.json({ error: message }, 404);
    }
    return c.json({ error: message }, 500);
  }

  return c.json(ProductionShotResponseSchema.parse(await doResponse.json()), 200);
});

// DELETE /api/spaces/:id/productions/:productionId/shots/:childId - Delete shot
spaceRoutes.openapi(deleteProductionShotRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;
  const { id: spaceId, productionId, childId } = c.req.valid('param');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }
  if (member.role === 'viewer') {
    return c.json({ error: 'Viewers cannot delete production shots' }, 403);
  }
  if (!env.SPACES_DO) {
    return c.json({ error: 'Asset storage not available' }, 503);
  }

  const doResponse = await env.SPACES_DO.get(env.SPACES_DO.idFromName(spaceId)).fetch(
    new Request(`http://do/internal/productions/${encodeURIComponent(productionId)}/shots/${encodeURIComponent(childId)}`, { method: 'DELETE' })
  );
  if (!doResponse.ok) {
    const message = await readSpaceDoError(doResponse, 'Failed to delete production shot');
    if (doResponse.status === 404) {
      return c.json({ error: message }, 404);
    }
    return c.json({ error: message }, 500);
  }

  return c.json({ success: true as const }, 200);
});

// POST /api/spaces/:id/productions/:productionId/cues - Create/update cue
spaceRoutes.openapi(upsertProductionCueRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;
  const { id: spaceId, productionId } = c.req.valid('param');
  const body = c.req.valid('json');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }
  if (member.role === 'viewer') {
    return c.json({ error: 'Viewers cannot modify production cues' }, 403);
  }
  if (!env.SPACES_DO) {
    return c.json({ error: 'Asset storage not available' }, 503);
  }

  const doResponse = await env.SPACES_DO.get(env.SPACES_DO.idFromName(spaceId)).fetch(new Request(`http://do/internal/productions/${encodeURIComponent(productionId)}/cues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, createdBy: userId }),
  }));
  if (!doResponse.ok) {
    const message = await readSpaceDoError(doResponse, 'Failed to save production cue');
    if (doResponse.status === 400) {
      return c.json({ error: message }, 400);
    }
    if (doResponse.status === 404) {
      return c.json({ error: message }, 404);
    }
    return c.json({ error: message }, 500);
  }

  return c.json(ProductionCueResponseSchema.parse(await doResponse.json()), 200);
});

// DELETE /api/spaces/:id/productions/:productionId/cues/:childId - Delete cue
spaceRoutes.openapi(deleteProductionCueRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;
  const { id: spaceId, productionId, childId } = c.req.valid('param');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }
  if (member.role === 'viewer') {
    return c.json({ error: 'Viewers cannot delete production cues' }, 403);
  }
  if (!env.SPACES_DO) {
    return c.json({ error: 'Asset storage not available' }, 503);
  }

  const doResponse = await env.SPACES_DO.get(env.SPACES_DO.idFromName(spaceId)).fetch(
    new Request(`http://do/internal/productions/${encodeURIComponent(productionId)}/cues/${encodeURIComponent(childId)}`, { method: 'DELETE' })
  );
  if (!doResponse.ok) {
    const message = await readSpaceDoError(doResponse, 'Failed to delete production cue');
    if (doResponse.status === 404) {
      return c.json({ error: message }, 404);
    }
    return c.json({ error: message }, 500);
  }

  return c.json({ success: true as const }, 200);
});

// POST /api/spaces/:id/productions/:productionId/placements - Create/update placement
spaceRoutes.openapi(upsertProductionPlacementRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;
  const { id: spaceId, productionId } = c.req.valid('param');
  const body = c.req.valid('json');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }
  if (member.role === 'viewer') {
    return c.json({ error: 'Viewers cannot modify production placements' }, 403);
  }
  if (!env.SPACES_DO) {
    return c.json({ error: 'Asset storage not available' }, 503);
  }

  const doResponse = await env.SPACES_DO.get(env.SPACES_DO.idFromName(spaceId)).fetch(new Request(`http://do/internal/productions/${encodeURIComponent(productionId)}/placements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, createdBy: userId }),
  }));
  if (!doResponse.ok) {
    const message = await readSpaceDoError(doResponse, 'Failed to save production placement');
    if (doResponse.status === 400) {
      return c.json({ error: message }, 400);
    }
    if (doResponse.status === 404) {
      return c.json({ error: message }, 404);
    }
    return c.json({ error: message }, 500);
  }

  return c.json(ProductionPlacementResponseSchema.parse(await doResponse.json()), 200);
});

// DELETE /api/spaces/:id/productions/:productionId/placements/:childId - Delete placement
spaceRoutes.openapi(deleteProductionPlacementRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;
  const { id: spaceId, productionId, childId } = c.req.valid('param');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }
  if (member.role === 'viewer') {
    return c.json({ error: 'Viewers cannot delete production placements' }, 403);
  }
  if (!env.SPACES_DO) {
    return c.json({ error: 'Asset storage not available' }, 503);
  }

  const doResponse = await env.SPACES_DO.get(env.SPACES_DO.idFromName(spaceId)).fetch(
    new Request(`http://do/internal/productions/${encodeURIComponent(productionId)}/placements/${encodeURIComponent(childId)}`, { method: 'DELETE' })
  );
  if (!doResponse.ok) {
    const message = await readSpaceDoError(doResponse, 'Failed to delete production placement');
    if (doResponse.status === 404) {
      return c.json({ error: message }, 404);
    }
    return c.json({ error: message }, 500);
  }

  return c.json({ success: true as const }, 200);
});

// GET /api/spaces/:id/productions/:productionId/records - List production records
spaceRoutes.openapi(listProductionRecordsRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;

  const { id: spaceId, productionId } = c.req.valid('param');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }

  if (!env.SPACES_DO) {
    return c.json({ error: 'Asset storage not available' }, 503);
  }

  const doId = env.SPACES_DO.idFromName(spaceId);
  const doStub = env.SPACES_DO.get(doId);
  const doResponse = await doStub.fetch(new Request(`http://do/internal/production/${encodeURIComponent(productionId)}/records`, {
    method: 'GET',
  }));

  if (!doResponse.ok) {
    const message = await readSpaceDoError(doResponse, 'Failed to fetch production records');
    if (doResponse.status === 400) {
      return c.json({ error: message }, 400);
    }
    return c.json({ error: message }, 500);
  }

  const payload = ListProductionRecordsResponseSchema.parse(await doResponse.json());
  return c.json(payload, 200);
});

// POST /api/spaces/:id/production/placements - Create/update production placement
spaceRoutes.openapi(placeProductionRecordRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;

  const { id: spaceId } = c.req.valid('param');
  const body = c.req.valid('json');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }
  if (member.role === 'viewer') {
    return c.json({ error: 'Viewers cannot place production records' }, 403);
  }

  if (!env.SPACES_DO) {
    return c.json({ error: 'Asset storage not available' }, 503);
  }

  const doId = env.SPACES_DO.idFromName(spaceId);
  const doStub = env.SPACES_DO.get(doId);
  const doResponse = await doStub.fetch(new Request('http://do/internal/production/placements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...body,
      createdBy: userId,
    }),
  }));

  if (!doResponse.ok) {
    const message = await readSpaceDoError(doResponse, 'Failed to place production record');
    if (doResponse.status === 400) {
      return c.json({ error: message }, 400);
    }
    if (doResponse.status === 404) {
      return c.json({ error: message }, 404);
    }
    return c.json({ error: message }, 500);
  }

  const payload = ProductionRecordResponseSchema.parse(await doResponse.json());
  return c.json(payload, 200);
});

// DELETE /api/spaces/:id/production/records/:recordId - Delete production record
spaceRoutes.openapi(deleteProductionRecordRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;

  const { id: spaceId, recordId } = c.req.valid('param');

  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }
  if (member.role === 'viewer') {
    return c.json({ error: 'Viewers cannot delete production records' }, 403);
  }

  if (!env.SPACES_DO) {
    return c.json({ error: 'Asset storage not available' }, 503);
  }

  const doId = env.SPACES_DO.idFromName(spaceId);
  const doStub = env.SPACES_DO.get(doId);
  const doResponse = await doStub.fetch(new Request(`http://do/internal/production/records/${encodeURIComponent(recordId)}`, {
    method: 'DELETE',
  }));

  if (!doResponse.ok) {
    const message = await readSpaceDoError(doResponse, 'Failed to delete production record');
    if (doResponse.status === 404) {
      return c.json({ error: message }, 404);
    }
    return c.json({ error: message }, 500);
  }

  return c.json({ success: true as const }, 200);
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

  // Delete space (cascade will delete members)
  const deleted = await spaceDAO.deleteSpace(spaceId);
  if (!deleted) {
    return c.json({ error: 'Failed to delete space' }, 500);
  }

  return c.json({
    success: true as const,
    message: 'Space deleted successfully',
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
