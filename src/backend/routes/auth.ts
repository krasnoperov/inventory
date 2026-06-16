import { AuthHandler } from '../features/auth/auth-handler';
import { createOpenApiRouter } from './openapi';
import {
  getAuthSessionRoute,
  postAuthLogoutRoute,
  postGoogleAuthRoute,
} from '../../shared/api/routes';

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

authRoutes.openapi(postAuthLogoutRoute, async (c) => {
  const container = c.get('container');
  const authHandler = container.get(AuthHandler);
  return authHandler.logout(c);
});

export { authRoutes };
