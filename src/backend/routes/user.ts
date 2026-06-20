import { authMiddleware } from '../middleware/auth-middleware';
import { UserDAO } from '../../dao/user-dao';
import { createOpenApiRouter, toApiUser, toUserProfile } from './openapi';
import {
  deleteProviderKeyRoute,
  getUserProfileRoute,
  listProviderKeysRoute,
  patchUserProfileRoute,
  putProviderKeyRoute,
  putUserSettingsRoute,
} from '../../shared/api/routes';
import {
  isProviderKeyProvider,
  listProviderKeySummaries,
  ProviderKeyEncryptionError,
} from '../services/providerKeyVault';
import { keyBrokerClient } from '../key-broker/client';

const userRoutes = createOpenApiRouter();

function isProviderKeyEncryptionError(err: unknown): err is ProviderKeyEncryptionError {
  return err instanceof ProviderKeyEncryptionError ||
    (err instanceof Error && err.name === 'ProviderKeyEncryptionError');
}

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

userRoutes.openapi(listProviderKeysRoute, async (c) => {
  const userId = c.get('userId')!;
  const providers = await listProviderKeySummaries(c.env.DB, userId, c.env);
  return c.json({ success: true as const, providers }, 200);
});

userRoutes.openapi(putProviderKeyRoute, async (c) => {
  const userId = c.get('userId')!;
  const { provider } = c.req.valid('param');
  const { apiKey } = c.req.valid('json');

  if (!isProviderKeyProvider(provider)) {
    return c.json({ error: 'Unknown provider' }, 400);
  }

  const trimmed = apiKey.trim();
  if (!trimmed) {
    return c.json({ error: 'API key is required' }, 400);
  }

  if (!c.env.KEY_BROKER) {
    return c.json({ error: 'Provider key broker is not configured' }, 503);
  }

  try {
    await keyBrokerClient(c.env.KEY_BROKER).storeProviderKey({
      tenant: { type: 'user', userId },
      provider,
      apiKey: trimmed,
    });
  } catch (err) {
    if (isProviderKeyEncryptionError(err)) {
      return c.json({ error: err.message }, 503);
    }
    throw err;
  }

  const providers = await listProviderKeySummaries(c.env.DB, userId, c.env);
  const summary = providers.find((item) => item.provider === provider)!;
  return c.json({ success: true as const, provider: summary }, 200);
});

userRoutes.openapi(deleteProviderKeyRoute, async (c) => {
  const userId = c.get('userId')!;
  const { provider } = c.req.valid('param');

  if (!isProviderKeyProvider(provider)) {
    return c.json({ error: 'Unknown provider' }, 400);
  }

  if (!c.env.KEY_BROKER) {
    return c.json({ error: 'Provider key broker is not configured' }, 503);
  }

  try {
    await keyBrokerClient(c.env.KEY_BROKER).deleteProviderKey({
      tenant: { type: 'user', userId },
      provider,
    });
  } catch (err) {
    if (isProviderKeyEncryptionError(err)) {
      return c.json({ error: err.message }, 503);
    }
    throw err;
  }

  const providers = await listProviderKeySummaries(c.env.DB, userId, c.env);
  const summary = providers.find((item) => item.provider === provider)!;
  return c.json({ success: true as const, provider: summary }, 200);
});

export { userRoutes };
