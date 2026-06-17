import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportPKCS8, exportSPKI, decodeJwt } from 'jose';
import { authRoutes } from './auth';
import { createOpenApiRouter } from './openapi';
import { AuthService } from '../features/auth/auth-service';
import type { Env } from '../../core/types';

async function buildAuthService(): Promise<AuthService> {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const env: Partial<Env> = {
    OIDC_PRIVATE_KEY: await exportPKCS8(privateKey),
    OIDC_PUBLIC_KEY: await exportSPKI(publicKey),
    OIDC_KEY_ID: 'test-key',
    OIDC_AUDIENCE: 'forgetray-api',
    OIDC_ISSUER: 'https://issuer.test',
    ENVIRONMENT: 'stage',
  };
  return new AuthService(env as Env);
}

// Mount the real auth routes with a container that hands back our test
// AuthService, so /api/auth/session-state runs exactly as in production.
function buildApp(authService: AuthService) {
  const app = createOpenApiRouter();
  app.use('*', async (c, next) => {
    c.set('container', { get: () => authService } as never);
    await next();
  });
  app.route('/', authRoutes);
  return app;
}

function post(app: ReturnType<typeof createOpenApiRouter>, headers: Record<string, string> = {}) {
  return app.fetch(
    new Request('https://app.example/api/auth/session-state', { method: 'POST', headers }),
  );
}

describe('POST /api/auth/session-state', () => {
  it('rejects requests without a bearer token', async () => {
    const app = buildApp(await buildAuthService());
    const res = await post(app);
    assert.strictEqual(res.status, 401);
  });

  it('rejects an invalid bearer token', async () => {
    const app = buildApp(await buildAuthService());
    const res = await post(app, { Authorization: 'Bearer not-a-real-jwt' });
    assert.strictEqual(res.status, 401);
  });

  it('mints a short-lived auth_token session from a valid CLI token', async () => {
    const authService = await buildAuthService();
    const cliToken = await authService.createJWT(42); // long-lived CLI credential
    const app = buildApp(authService);

    const res = await post(app, { Authorization: `Bearer ${cliToken}` });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('cache-control'), 'no-store');

    const body = (await res.json()) as {
      token: string;
      cookieName: string;
      expiresIn: number;
      tokenType: string;
    };
    assert.strictEqual(body.cookieName, 'auth_token');
    assert.strictEqual(body.tokenType, 'Bearer');
    assert.strictEqual(body.expiresIn, 30 * 60);

    // The minted token is a valid session for the same user...
    assert.deepEqual(await authService.verifyJWT(body.token), { userId: 42 });
    // ...and is short-lived (30 min), not the long-lived CLI TTL.
    const claims = decodeJwt(body.token);
    assert.strictEqual((claims.exp ?? 0) - (claims.iat ?? 0), 30 * 60);
  });
});
