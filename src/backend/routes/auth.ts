import { AuthHandler } from '../features/auth/auth-handler';
import { AuthService } from '../features/auth/auth-service';
import { createOpenApiRouter } from './openapi';
import {
  getAuthSessionRoute,
  postAuthLogoutRoute,
  postAuthSessionStateRoute,
  postGoogleAuthRoute,
} from '../../shared/api/routes';

// Short-lived web session token TTL for minted Playwright/curl sessions.
const SESSION_STATE_TTL_SECONDS = 30 * 60;

const authRoutes = createOpenApiRouter();

authRoutes.openapi(getAuthSessionRoute, async (c) => {
  const container = c.get('container');
  const authHandler = container.get(AuthHandler);
  return authHandler.getSession(c);
});

authRoutes.openapi(postGoogleAuthRoute, async (c) => {
  const container = c.get('container');
  const authHandler = container.get(AuthHandler);
  return authHandler.googleAuth(c);
});

// Exchange a long-lived CLI bearer token for a short-lived web session JWT.
// Used by scripts/auth/mint-session.mjs to drive curl / Playwright against
// authenticated pages without reusing the 30-day CLI credential as a cookie.
authRoutes.openapi(postAuthSessionStateRoute, async (c) => {
  const authorizationHeader = c.req.header('Authorization');
  const bearerToken = authorizationHeader?.startsWith('Bearer ')
    ? authorizationHeader.slice('Bearer '.length).trim()
    : null;
  if (!bearerToken) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  const container = c.get('container');
  const authService = container.get(AuthService);
  const payload = await authService.verifyJWT(bearerToken);
  if (!payload) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  const token = await authService.createJWT(payload.userId, SESSION_STATE_TTL_SECONDS);
  c.header('Cache-Control', 'no-store');
  c.header('Pragma', 'no-cache');
  return c.json(
    {
      token,
      cookieName: 'auth_token',
      expiresIn: SESSION_STATE_TTL_SECONDS,
      tokenType: 'Bearer' as const,
    },
    200,
  );
});

authRoutes.openapi(postAuthLogoutRoute, async (c) => {
  const container = c.get('container');
  const authHandler = container.get(AuthHandler);
  return authHandler.logout(c);
});

export { authRoutes };
