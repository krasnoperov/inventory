import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKeyPair,
  exportPKCS8,
  exportSPKI,
  decodeJwt,
} from 'jose';
import { AuthService } from './auth-service';
import type { Env } from '../../../core/types';

const createAuthService = async (overrides: Partial<Env> = {}) => {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const privatePem = await exportPKCS8(privateKey);
  const publicPem = await exportSPKI(publicKey);

  const env: Partial<Env> = {
    OIDC_PRIVATE_KEY: privatePem,
    OIDC_PUBLIC_KEY: publicPem,
    OIDC_KEY_ID: 'test-key',
    OIDC_AUDIENCE: 'forgetray-api',
    OIDC_ISSUER: 'https://issuer.test',
    OIDC_ALLOWED_CLIENT_IDS: JSON.stringify(['forgetray-cli', 'qa-cli']),
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    ENVIRONMENT: 'stage',
    ...overrides,
  };

  return new AuthService(env as Env);
};

test('AuthService issues and verifies JWTs', async () => {
  const authService = await createAuthService();

  const token = await authService.createJWT(123);
  const decoded = decodeJwt(token);

  assert.strictEqual(decoded.sub, '123');
  assert.strictEqual(decoded.aud, 'forgetray-api');
  assert.strictEqual(decoded.iss, 'https://issuer.test');

  const payload = await authService.verifyJWT(token);
  assert.deepEqual(payload, { userId: 123 });
});

test('AuthService publishes JWKS with matching kid', async () => {
  const authService = await createAuthService();
  const jwks = await authService.getJwks();

  assert.ok(Array.isArray(jwks.keys));
  assert.equal(jwks.keys.length, 1);
  assert.equal(jwks.keys[0].kid, 'test-key');
  assert.equal(jwks.keys[0].alg, 'ES256');
  assert.equal(jwks.keys[0].use, 'sig');
});

test('AuthService validates allowed client IDs', async () => {
  const authService = await createAuthService({
    OIDC_ALLOWED_CLIENT_IDS: JSON.stringify(['cli-a', 'cli-b']),
  });

  assert.equal(authService.isClientAllowed('cli-a'), true);
  assert.equal(authService.isClientAllowed('cli-b'), true);
  assert.equal(authService.isClientAllowed('unknown'), false);
});

test('AuthService rejects token when audience mismatches', async () => {
  const authService = await createAuthService({ OIDC_AUDIENCE: 'forgetray-api' });
  const token = await authService.createJWT(42);

  const mismatched = await createAuthService({ OIDC_AUDIENCE: 'other-api' });
  const payload = await mismatched.verifyJWT(token);

  assert.equal(payload, null);
});

test('AuthService honours an explicit short TTL', async () => {
  const authService = await createAuthService();

  const shortLived = await authService.createJWT(7, 30 * 60);
  const shortClaims = decodeJwt(shortLived);
  assert.strictEqual(shortClaims.sub, '7');
  assert.strictEqual((shortClaims.exp ?? 0) - (shortClaims.iat ?? 0), 30 * 60);

  // Default TTL stays the long-lived one (well above 30 minutes).
  const longLived = await authService.createJWT(7);
  const longClaims = decodeJwt(longLived);
  assert.ok((longClaims.exp ?? 0) - (longClaims.iat ?? 0) > 30 * 60);

  // Short-lived tokens are still valid sessions.
  assert.deepEqual(await authService.verifyJWT(shortLived), { userId: 7 });
});
