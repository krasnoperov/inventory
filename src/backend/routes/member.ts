import { Hono } from 'hono';
import type { AppContext } from './types';
import { AuthService } from '../features/auth/auth-service';
import { MemberDAO } from '../../dao/member-dao';
import { SpaceDAO } from '../../dao/space-dao';
import { UserDAO } from '../../dao/user-dao';
import { getAuthToken } from '../auth';

const memberRoutes = new Hono<AppContext>();

// List members in a space
memberRoutes.get('/api/spaces/:id/members', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const memberDAO = container.get(MemberDAO);
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

    const spaceId = c.req.param('id');

    // Check if space exists
    const space = await spaceDAO.getSpaceById(spaceId);
    if (!space) {
      return c.json({ error: 'Space not found' }, 404);
    }

    // Check if user is a member of the space
    const isMember = await memberDAO.isSpaceMember(spaceId, String(payload.userId));
    if (!isMember) {
      return c.json({ error: 'Access denied' }, 403);
    }

    // Get all members
    const members = await memberDAO.getMembersBySpaceId(spaceId);

    return c.json({
      success: true,
      members: members.map(m => ({
        user_id: m.user_id,
        role: m.role,
        joined_at: m.joined_at,
        user: {
          id: m.user.id,
          email: m.user.email,
          name: m.user.name,
        },
      })),
    });
  } catch (error) {
    console.error('Error listing members:', error);
    return c.json({ error: 'Failed to list members' }, 500);
  }
});

// Invite member to space (lookup by email)
memberRoutes.post('/api/spaces/:id/members', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const memberDAO = container.get(MemberDAO);
    const spaceDAO = container.get(SpaceDAO);
    const userDAO = container.get(UserDAO);

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

    // Check if space exists
    const space = await spaceDAO.getSpaceById(spaceId);
    if (!space) {
      return c.json({ error: 'Space not found' }, 404);
    }

    // Check if user is the owner
    const currentUserRole = await memberDAO.getMemberRole(spaceId, String(payload.userId));
    if (currentUserRole !== 'owner') {
      return c.json({ error: 'Only the owner can add members' }, 403);
    }

    // Get and validate request body
    const body = await c.req.json();
    const { email, role = 'editor' } = body;

    if (!email || typeof email !== 'string') {
      return c.json({ error: 'Email is required' }, 400);
    }

    // Validate role
    if (role && !['owner', 'editor', 'viewer'].includes(role)) {
      return c.json({ error: 'Invalid role. Must be owner, editor, or viewer' }, 400);
    }

    // Lookup user by email
    const userToInvite = await userDAO.findByEmail(email);
    if (!userToInvite) {
      return c.json({ error: 'User not found with this email' }, 404);
    }

    // Check if user is already a member
    const existingMember = await memberDAO.getMember(spaceId, String(userToInvite.id));
    if (existingMember) {
      return c.json({ error: 'User is already a member of this space' }, 400);
    }

    // Add member
    const newMember = await memberDAO.addMember({
      space_id: spaceId,
      user_id: String(userToInvite.id),
      role: role as 'owner' | 'editor' | 'viewer',
      joined_at: Date.now(),
    });

    return c.json({
      success: true,
      member: {
        user_id: newMember.user_id,
        role: newMember.role,
        joined_at: newMember.joined_at,
        user: {
          id: userToInvite.id,
          email: userToInvite.email,
          name: userToInvite.name,
        },
      },
    });
  } catch (error) {
    console.error('Error inviting member:', error);
    return c.json({ error: 'Failed to invite member' }, 500);
  }
});

// Remove member from space
memberRoutes.delete('/api/spaces/:id/members/:uid', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const memberDAO = container.get(MemberDAO);
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

    const spaceId = c.req.param('id');
    const userIdToRemove = c.req.param('uid');

    // Check if space exists
    const space = await spaceDAO.getSpaceById(spaceId);
    if (!space) {
      return c.json({ error: 'Space not found' }, 404);
    }

    // Check if current user is the owner
    const currentUserRole = await memberDAO.getMemberRole(spaceId, String(payload.userId));
    if (currentUserRole !== 'owner') {
      return c.json({ error: 'Only the owner can remove members' }, 403);
    }

    // Check if member to remove exists
    const memberToRemove = await memberDAO.getMember(spaceId, userIdToRemove);
    if (!memberToRemove) {
      return c.json({ error: 'Member not found' }, 404);
    }

    // Cannot remove the owner
    if (memberToRemove.role === 'owner') {
      return c.json({ error: 'Cannot remove the owner from the space' }, 400);
    }

    // Remove member
    const removed = await memberDAO.removeMember(spaceId, userIdToRemove);
    if (!removed) {
      return c.json({ error: 'Failed to remove member' }, 500);
    }

    return c.json({
      success: true,
      message: 'Member removed successfully',
    });
  } catch (error) {
    console.error('Error removing member:', error);
    return c.json({ error: 'Failed to remove member' }, 500);
  }
});

// Update member role
memberRoutes.patch('/api/spaces/:id/members/:uid', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const memberDAO = container.get(MemberDAO);
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

    const spaceId = c.req.param('id');
    const userIdToUpdate = c.req.param('uid');

    // Check if space exists
    const space = await spaceDAO.getSpaceById(spaceId);
    if (!space) {
      return c.json({ error: 'Space not found' }, 404);
    }

    // Check if current user is the owner
    const currentUserRole = await memberDAO.getMemberRole(spaceId, String(payload.userId));
    if (currentUserRole !== 'owner') {
      return c.json({ error: 'Only the owner can change member roles' }, 403);
    }

    // Get and validate request body
    const body = await c.req.json();
    const { role } = body;

    if (!role || typeof role !== 'string') {
      return c.json({ error: 'Role is required' }, 400);
    }

    // Validate role
    if (!['owner', 'editor', 'viewer'].includes(role)) {
      return c.json({ error: 'Invalid role. Must be owner, editor, or viewer' }, 400);
    }

    // Check if member to update exists
    const memberToUpdate = await memberDAO.getMember(spaceId, userIdToUpdate);
    if (!memberToUpdate) {
      return c.json({ error: 'Member not found' }, 404);
    }

    // Cannot change owner's role
    if (memberToUpdate.role === 'owner') {
      return c.json({ error: "Cannot change the owner's role" }, 400);
    }

    // Update member role
    const updatedMember = await memberDAO.updateMemberRole(
      spaceId,
      userIdToUpdate,
      role as 'owner' | 'editor' | 'viewer'
    );

    if (!updatedMember) {
      return c.json({ error: 'Failed to update member role' }, 500);
    }

    return c.json({
      success: true,
      member: {
        user_id: updatedMember.user_id,
        role: updatedMember.role,
        joined_at: updatedMember.joined_at,
      },
    });
  } catch (error) {
    console.error('Error updating member role:', error);
    return c.json({ error: 'Failed to update member role' }, 500);
  }
});

export { memberRoutes };
