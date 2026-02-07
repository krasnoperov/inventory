import type { Context, Next } from 'hono';
import type { AppContext } from '../routes/types';

/**
 * Admin middleware that checks if the authenticated user is in the ADMIN_USER_IDS list.
 * Must be applied after authMiddleware (requires userId to be set).
 *
 * ADMIN_USER_IDS is a comma-separated list of user IDs in the environment.
 */
export const adminMiddleware = async (c: Context<AppContext>, next: Next) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const adminUserIds = c.env.ADMIN_USER_IDS;
  if (!adminUserIds) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const allowedIds = adminUserIds.split(',').map((id) => id.trim()).filter(Boolean);
  if (!allowedIds.includes(String(userId))) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await next();
};
