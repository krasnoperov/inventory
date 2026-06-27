import { inject, injectable } from 'inversify';
import { TYPES } from '../../core/di-types';
import type { Env } from '../../core/types';
import { loggers } from '../../shared/logger';

export interface EmailSendInput {
  to: string;
  subject: string;
  text: string;
}

export type EmailSendResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'invalid_recipient'
        | 'empty_message'
        | 'sender_not_configured'
        | 'email_binding_not_configured'
        | 'send_failed';
    };

const log = loggers.emailService;

@injectable()
export class EmailService {
  constructor(@inject(TYPES.Env) private env: Env) {}

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    const from = this.env.MAKEFX_EMAIL_FROM?.trim();
    if (!from) {
      return { ok: false, error: 'sender_not_configured' };
    }

    const to = input.to.trim();
    if (to.length < 3 || to.length > 254 || !to.includes('@') || /\s/.test(to)) {
      return { ok: false, error: 'invalid_recipient' };
    }
    if (!input.subject.trim() || !input.text.trim()) {
      return { ok: false, error: 'empty_message' };
    }
    if (!this.env.EMAIL || typeof this.env.EMAIL.send !== 'function') {
      return { ok: false, error: 'email_binding_not_configured' };
    }

    try {
      await this.env.EMAIL.send({
        from,
        to,
        subject: input.subject,
        text: input.text,
      });
      return { ok: true };
    } catch (error) {
      log.warn('Email send failed', {
        to,
        subject: input.subject,
        code: (error as { code?: string }).code,
        message: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, error: 'send_failed' };
    }
  }
}
