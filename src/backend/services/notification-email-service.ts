import { inject, injectable } from 'inversify';
import { TYPES } from '../../core/di-types';
import type { Env } from '../../core/types';
import { loggers } from '../../shared/logger';
import { EmailService } from './email-service';

export type NotificationRole = 'owner' | 'editor' | 'viewer';

export interface NewRegistrationNotification {
  userId: number;
  email: string;
  name: string | null;
}

export interface SpaceNotificationContext {
  spaceId: string;
  spaceName: string;
  recipientEmail: string;
  role: NotificationRole;
}

export interface SpaceAccessRequestNotification extends SpaceNotificationContext {
  requesterEmail: string;
}

export interface SpaceInvitationNotification extends SpaceNotificationContext {
  inviterEmail: string;
}

const log = loggers.notificationEmailService;

function parseRecipients(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((recipient) => recipient.trim())
    .filter(Boolean);
}

function displayName(name: string | null | undefined, email: string): string {
  const trimmed = name?.trim();
  return trimmed || email;
}

@injectable()
export class NotificationEmailService {
  constructor(
    @inject(EmailService) private emailService: EmailService,
    @inject(TYPES.Env) private env: Env,
  ) {}

  async notifyAdminNewRegistration(user: NewRegistrationNotification): Promise<void> {
    const recipients = parseRecipients(this.env.MAKEFX_ADMIN_NOTIFICATION_EMAILS);
    if (recipients.length === 0) {
      return;
    }

    const subject = `New MakeFX registration: ${user.email}`;
    const text = [
      'A new user registered for MakeFX.',
      '',
      `User: ${displayName(user.name, user.email)}`,
      `Email: ${user.email}`,
      `User ID: ${user.userId}`,
      `Environment: ${this.env.ENVIRONMENT ?? 'unknown'}`,
    ].join('\n');

    await Promise.all(recipients.map((to) => this.sendBestEffort('new_registration_admin', to, subject, text, {
      userId: String(user.userId),
    })));
  }

  async notifySpaceAccessRequested(input: SpaceAccessRequestNotification): Promise<void> {
    const { subject, text } = this.spaceEmail({
      headline: `${input.requesterEmail} requested access to ${input.spaceName}.`,
      action: 'Access requested',
      input,
      details: [`Requester: ${input.requesterEmail}`],
    });
    await this.sendBestEffort('space_access_requested', input.recipientEmail, subject, text, {
      spaceId: input.spaceId,
    });
  }

  async notifySpaceInvitationCreated(input: SpaceInvitationNotification): Promise<void> {
    const { subject, text } = this.spaceEmail({
      headline: `${input.inviterEmail} invited you to ${input.spaceName}.`,
      action: 'Invitation created',
      input,
      details: [`Invited by: ${input.inviterEmail}`],
    });
    await this.sendBestEffort('space_invitation_created', input.recipientEmail, subject, text, {
      spaceId: input.spaceId,
    });
  }

  async notifySpaceAccessAccepted(input: SpaceNotificationContext): Promise<void> {
    const { subject, text } = this.spaceEmail({
      headline: `Your access to ${input.spaceName} was accepted.`,
      action: 'Access accepted',
      input,
    });
    await this.sendBestEffort('space_access_accepted', input.recipientEmail, subject, text, {
      spaceId: input.spaceId,
    });
  }

  async notifySpaceAccessRevoked(input: SpaceNotificationContext): Promise<void> {
    const { subject, text } = this.spaceEmail({
      headline: `Your access to ${input.spaceName} was revoked.`,
      action: 'Access revoked',
      input,
    });
    await this.sendBestEffort('space_access_revoked', input.recipientEmail, subject, text, {
      spaceId: input.spaceId,
    });
  }

  private spaceEmail(args: {
    headline: string;
    action: string;
    input: SpaceNotificationContext;
    details?: string[];
  }): { subject: string; text: string } {
    const spaceUrl = this.spaceUrl(args.input.spaceId);
    return {
      subject: `MakeFX: ${args.action} for ${args.input.spaceName}`,
      text: [
        args.headline,
        '',
        `Space: ${args.input.spaceName}`,
        `Role: ${args.input.role}`,
        ...(args.details ?? []),
        `Open Space: ${spaceUrl}`,
      ].join('\n'),
    };
  }

  private spaceUrl(spaceId: string): string {
    const origin = (this.env.PUBLIC_SITE_ORIGIN ?? this.env.OIDC_ISSUER ?? 'https://makefx.app').replace(/\/$/, '');
    return `${origin}/spaces/${encodeURIComponent(spaceId)}`;
  }

  private async sendBestEffort(
    event: string,
    to: string,
    subject: string,
    text: string,
    context: Record<string, string>,
  ): Promise<void> {
    try {
      const result = await this.emailService.send({ to, subject, text });
      if (!result.ok) {
        log.warn('Notification email skipped', {
          event,
          to,
          reason: result.error,
          ...context,
        });
      }
    } catch (error) {
      log.warn('Notification email failed', {
        event,
        to,
        message: error instanceof Error ? error.message : String(error),
        ...context,
      });
    }
  }
}
