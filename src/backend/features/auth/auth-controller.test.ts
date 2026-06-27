import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import type { Kysely } from 'kysely';
import { UserDAO } from '../../../dao/user-dao';
import type { Database } from '../../../db/types';
import { cleanupTestDatabase, createTestDatabase } from '../../../test-utils/database';
import type { Env, SendEmailMessage } from '../../../core/types';
import { EmailService } from '../../services/email-service';
import { NotificationEmailService } from '../../services/notification-email-service';
import { AuthController } from './auth-controller';
import type { AuthService } from './auth-service';
import type { PolarService } from '../../services/polarService';

describe('AuthController notifications', () => {
  let db: Kysely<Database>;
  let sent: SendEmailMessage[];

  beforeEach(async () => {
    db = await createTestDatabase();
    sent = [];
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  function buildController() {
    const env = {
      ENVIRONMENT: 'stage',
      MAKEFX_EMAIL_FROM: 'notifications@makefx.app',
      MAKEFX_ADMIN_NOTIFICATION_EMAILS: 'owner@example.com',
      EMAIL: {
        send: async (message: SendEmailMessage) => {
          sent.push(message);
          return {};
        },
      },
    } as Env;
    const userDAO = new UserDAO(db);
    const authService = {
      fetchGoogleUserInfo: async () => ({
        id: 'google-user-1',
        email: 'new-user@example.com',
        name: 'New User',
      }),
      createJWT: async (userId: number) => `jwt-${userId}`,
    } as unknown as AuthService;
    const polarService = {
      isConfigured: () => false,
    } as unknown as PolarService;
    const emailService = new EmailService(env);
    const notificationEmailService = new NotificationEmailService(emailService, env);
    return new AuthController(authService, userDAO, polarService, notificationEmailService);
  }

  test('new user registration triggers one admin notification', async () => {
    const result = await buildController().authenticateWithGoogle('google-token');

    assert.equal(result.success, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'owner@example.com');
    assert.match(sent[0].subject, /New MakeFX registration/);
    assert.match(sent[0].text, /new-user@example\.com/);
  });

  test('existing user sign-in does not send another admin notification', async () => {
    const controller = buildController();

    await controller.authenticateWithGoogle('google-token');
    await controller.authenticateWithGoogle('google-token');

    assert.equal(sent.length, 1);
  });
});
