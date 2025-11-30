import type { Context, Next } from 'hono';
import type { AppContext } from '../routes/types';
import { AuthService } from '../features/auth/auth-service';

/**
 * Extract token from request headers (Bearer token or cookie)
 */
function extractToken(c: Context): string | undefined {
  // Check Authorization header first for Bearer token
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Fall back to cookie
  const cookieHeader = c.req.header('Cookie');
  return cookieHeader
    ?.split('; ')
    .find((row) => row.startsWith('auth_token='))
    ?.split('=')[1];
}

/**
 * Auth middleware that validates JWT tokens and sets userId on context.
 * Use on route groups that require authentication.
 *
 * @example
 * const routes = new Hono<AppContext>();
 * routes.use('*', authMiddleware);
 * routes.get('/protected', (c) => {
 *   const userId = c.get('userId')!;
 *   // ...
 * });
 */
export const authMiddleware = async (c: Context<AppContext>, next: Next) => {
  const container = c.get('container');
  const authService = container.get(AuthService);

  const token = extractToken(c);

  if (!token) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const payload = await authService.verifyJWT(token);
  if (!payload) {
    return c.json({ error: 'Invalid authentication' }, 401);
  }

  c.set('userId', payload.userId);
  await next();
};

/** @deprecated Use authMiddleware directly */
export const createAuthMiddleware = () => authMiddleware;