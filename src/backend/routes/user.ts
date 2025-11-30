import { Hono } from 'hono';
import type { AppContext } from './types';
import { authMiddleware } from '../middleware/auth-middleware';
import { UserDAO } from '../../dao/user-dao';

const userRoutes = new Hono<AppContext>();

// All user routes require authentication
userRoutes.use('*', authMiddleware);

// User settings endpoint
userRoutes.put('/api/user/settings', async (c) => {
  const userId = c.get('userId')!;
  const userDAO = c.get('container').get(UserDAO);

  // Get and validate request body
  const body = await c.req.json();
  const { name } = body;

  // Update user settings
  await userDAO.updateSettings(userId, { name });

  // Return updated user
  const user = await userDAO.findById(userId);
  if (!user) {
    return c.json({ error: 'User not found after update' }, 500);
  }

  return c.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      google_id: user.google_id,
      created_at: user.created_at,
      updated_at: user.updated_at,
    }
  });
});

// User profile endpoints
userRoutes.get('/api/user/profile', async (c) => {
  const userId = c.get('userId')!;
  const userDAO = c.get('container').get(UserDAO);

  const user = await userDAO.findById(userId);
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
  });
});

userRoutes.patch('/api/user/profile', async (c) => {
  const userId = c.get('userId')!;
  const userDAO = c.get('container').get(UserDAO);

  const user = await userDAO.findById(userId);
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  const body = await c.req.json();
  const { name } = body;

  // Validate name if provided
  if (name !== undefined && (!name || typeof name !== 'string' || name.trim().length === 0)) {
    return c.json({ error: 'Name is required and must be a non-empty string' }, 400);
  }

  // Update user settings
  await userDAO.updateSettings(user.id, {
    name: name !== undefined ? name.trim() : undefined,
  });

  // Fetch updated user
  const updatedUser = await userDAO.findById(user.id);

  return c.json({
    success: true,
    user: {
      id: updatedUser!.id,
      email: updatedUser!.email,
      name: updatedUser!.name,
    },
  });
});

export { userRoutes };
