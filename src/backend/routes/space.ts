import { authMiddleware } from '../middleware/auth-middleware';
import { SpaceDAO } from '../../dao/space-dao';
import { MemberDAO } from '../../dao/member-dao';
import { createOpenApiRouter, toApiSpace } from './openapi';
import {
  deleteSpaceRoute,
  getSpaceRoute,
  listSpaceAssetsRoute,
  listSpacesRoute,
  postSpaceRoute,
} from '../../shared/api/routes';
import { ListSpaceAssetsResponseSchema, type Space } from '../../shared/api/schemas';

const spaceRoutes = createOpenApiRouter();

// All space routes require authentication
spaceRoutes.use('/api/spaces/*', authMiddleware);

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

export { spaceRoutes };
