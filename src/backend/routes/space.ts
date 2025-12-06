import { Hono } from 'hono';
import type { AppContext } from './types';
import { authMiddleware } from '../middleware/auth-middleware';
import { SpaceDAO } from '../../dao/space-dao';
import { MemberDAO } from '../../dao/member-dao';

const spaceRoutes = new Hono<AppContext>();

// All space routes require authentication
spaceRoutes.use('*', authMiddleware);

// POST /api/spaces - Create space
spaceRoutes.post('/api/spaces', async (c) => {
  const userId = String(c.get('userId')!);
  const container = c.get('container');
  const spaceDAO = container.get(SpaceDAO);
  const memberDAO = container.get(MemberDAO);

  // Get and validate request body
  const body = await c.req.json();
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
    success: true,
    space: {
      id: space.id,
      name: space.name,
      owner_id: space.owner_id,
      role: 'owner', // Creator is always the owner
      created_at: space.created_at,
    },
  }, 201);
});

// GET /api/spaces - List user's spaces
spaceRoutes.get('/api/spaces', async (c) => {
  const userId = String(c.get('userId')!);
  const spaceDAO = c.get('container').get(SpaceDAO);

  // Get all spaces where user is a member
  const spaces = await spaceDAO.getSpacesForUser(userId);

  return c.json({
    success: true,
    spaces: spaces.map(space => ({
      id: space.id,
      name: space.name,
      owner_id: space.owner_id,
      role: space.role,
      created_at: space.created_at,
    })),
  });
});

// GET /api/spaces/:id - Get space (D1 metadata)
spaceRoutes.get('/api/spaces/:id', async (c) => {
  const userId = String(c.get('userId')!);
  const container = c.get('container');
  const spaceDAO = container.get(SpaceDAO);
  const memberDAO = container.get(MemberDAO);

  const spaceId = c.req.param('id');

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
    success: true,
    space: {
      id: space.id,
      name: space.name,
      owner_id: space.owner_id,
      role: member.role,
      created_at: space.created_at,
    },
  });
});

// GET /api/spaces/:id/assets - List all assets in a space
spaceRoutes.get('/api/spaces/:id/assets', async (c) => {
  const userId = String(c.get('userId')!);
  const container = c.get('container');
  const memberDAO = container.get(MemberDAO);
  const env = c.env;

  const spaceId = c.req.param('id');

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

  return c.json({
    success: true,
    assets: state.assets,
  });
});

// DELETE /api/spaces/:id - Delete space (owner only)
spaceRoutes.delete('/api/spaces/:id', async (c) => {
  const userId = String(c.get('userId')!);
  const container = c.get('container');
  const spaceDAO = container.get(SpaceDAO);
  const memberDAO = container.get(MemberDAO);

  const spaceId = c.req.param('id');

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
    success: true,
    message: 'Space deleted successfully',
  });
});

export { spaceRoutes };
