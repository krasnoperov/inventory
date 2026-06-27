import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { EmailService, type EmailSendInput } from './email-service';
import type { Env, SendEmailMessage } from '../../core/types';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    MAKEFX_EMAIL_FROM: 'notifications@makefx.app',
    ...overrides,
  } as Env;
}

describe('EmailService', () => {
  test('sends through the EMAIL binding with configured sender', async () => {
    const sent: SendEmailMessage[] = [];
    const service = new EmailService(makeEnv({
      EMAIL: {
        send: async (message) => {
          sent.push(message);
          return {};
        },
      },
    }));

    const input: EmailSendInput = {
      to: 'artist@example.com',
      subject: 'Subject',
      text: 'Body',
    };
    assert.deepEqual(await service.send(input), { ok: true });
    assert.deepEqual(sent, [{
      from: 'notifications@makefx.app',
      to: 'artist@example.com',
      subject: 'Subject',
      text: 'Body',
    }]);
  });

  test('reports missing sender or binding without throwing', async () => {
    assert.deepEqual(
      await new EmailService(makeEnv({ MAKEFX_EMAIL_FROM: undefined })).send({
        to: 'artist@example.com',
        subject: 'Subject',
        text: 'Body',
      }),
      { ok: false, error: 'sender_not_configured' },
    );
    assert.deepEqual(
      await new EmailService(makeEnv()).send({
        to: 'artist@example.com',
        subject: 'Subject',
        text: 'Body',
      }),
      { ok: false, error: 'email_binding_not_configured' },
    );
  });

  test('rejects invalid messages before calling EMAIL', async () => {
    let called = false;
    const service = new EmailService(makeEnv({
      EMAIL: {
        send: async () => {
          called = true;
          return {};
        },
      },
    }));

    assert.deepEqual(
      await service.send({ to: 'has space@example.com', subject: 'Subject', text: 'Body' }),
      { ok: false, error: 'invalid_recipient' },
    );
    assert.deepEqual(
      await service.send({ to: 'artist@example.com', subject: ' ', text: 'Body' }),
      { ok: false, error: 'empty_message' },
    );
    assert.equal(called, false);
  });

  test('maps binding failures to send_failed', async () => {
    const service = new EmailService(makeEnv({
      EMAIL: {
        send: async () => {
          throw new Error('sender not verified');
        },
      },
    }));

    assert.deepEqual(
      await service.send({ to: 'artist@example.com', subject: 'Subject', text: 'Body' }),
      { ok: false, error: 'send_failed' },
    );
  });
});
