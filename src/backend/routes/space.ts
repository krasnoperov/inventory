import { Hono } from 'hono';
import type { AppContext } from './types';
import { AuthService } from '../features/auth/auth-service';
import { SpaceDAO } from '../../dao/space-dao';
import { MemberDAO } from '../../dao/member-dao';
import { getAuthToken } from '../auth';

const spaceRoutes = new Hono<AppContext>();

// POST /api/spaces - Create space
spaceRoutes.post('/api/spaces', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const spaceDAO = container.get(SpaceDAO);
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

    // Get and validate request body
    const body = await c.req.json();
    const { name } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return c.json({ error: 'Name is required and must be a non-empty string' }, 400);
    }

    // Generate space ID
    const spaceId = crypto.randomUUID();
    const now = Date.now();

    const userId = String(payload.userId);

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
        created_at: space.created_at,
      },
    }, 201);
  } catch (error) {
    console.error('Error creating space:', error);
    return c.json({ error: 'Failed to create space' }, 500);
  }
});

// GET /api/spaces - List user's spaces
spaceRoutes.get('/api/spaces', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const spaceDAO = container.get(SpaceDAO);

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

    // Get all spaces where user is a member
    const userId = String(payload.userId);
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
  } catch (error) {
    console.error('Error listing spaces:', error);
    return c.json({ error: 'Failed to list spaces' }, 500);
  }
});

// GET /api/spaces/:id - Get space (D1 metadata)
spaceRoutes.get('/api/spaces/:id', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const spaceDAO = container.get(SpaceDAO);
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

    const spaceId = c.req.param('id');
    const userId = String(payload.userId);

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
  } catch (error) {
    console.error('Error getting space:', error);
    return c.json({ error: 'Failed to get space' }, 500);
  }
});

// DELETE /api/spaces/:id - Delete space (owner only)
spaceRoutes.delete('/api/spaces/:id', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const spaceDAO = container.get(SpaceDAO);
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

    const spaceId = c.req.param('id');
    const userId = String(payload.userId);

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
  } catch (error) {
    console.error('Error deleting space:', error);
    return c.json({ error: 'Failed to delete space' }, 500);
  }
});

export { spaceRoutes };
