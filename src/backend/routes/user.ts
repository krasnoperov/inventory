import { authMiddleware } from '../middleware/auth-middleware';
import { UserDAO } from '../../dao/user-dao';
import { createOpenApiRouter, toApiUser, toUserProfile } from './openapi';
import {
  getUserProfileRoute,
  patchUserProfileRoute,
  putUserSettingsRoute,
} from '../../shared/api/routes';

const userRoutes = createOpenApiRouter();

// All user routes require authentication
userRoutes.use('/api/user/*', authMiddleware);

// User settings endpoint
userRoutes.openapi(putUserSettingsRoute, async (c) => {
  const userId = c.get('userId')!;
  const userDAO = c.get('container').get(UserDAO);

  // Get and validate request body
  const body = c.req.valid('json');
  const { name } = body;

  // Update user settings
  await userDAO.updateSettings(userId, { name });

  // Return updated user
  const user = await userDAO.findById(userId);
  if (!user) {
    return c.json({ error: 'User not found after update' }, 500);
  }

  return c.json({
    success: true as const,
    user: toApiUser(user),
  }, 200);
});

// User profile endpoints
userRoutes.openapi(getUserProfileRoute, async (c) => {
  const userId = c.get('userId')!;
  const userDAO = c.get('container').get(UserDAO);

  const user = await userDAO.findById(userId);
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json(toUserProfile(user), 200);
});

userRoutes.openapi(patchUserProfileRoute, async (c) => {
  const userId = c.get('userId')!;
  const userDAO = c.get('container').get(UserDAO);

  const user = await userDAO.findById(userId);
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  const body = c.req.valid('json');
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
    success: true as const,
    user: toUserProfile(updatedUser!),
  }, 200);
});

export { userRoutes };
