import type { Context } from 'hono';
import { authMiddleware } from '../middleware/auth-middleware';
import { MemberDAO } from '../../dao/member-dao';
import { SpaceDAO } from '../../dao/space-dao';
import { SpaceSharingDAO, SpaceSharingError, normalizeInvitationEmail } from '../../dao/space-sharing-dao';
import { UserDAO } from '../../dao/user-dao';
import { NotificationEmailService } from '../services/notification-email-service';
import { loggers } from '../../shared/logger';
import { createOpenApiRouter } from './openapi';
import type {
  SpaceAccessRequest,
  SpaceAccessRequestWithRequester,
  SpaceInvitation,
  SpaceInvitationWithUsers,
  SpaceSharingMember,
} from '../../shared/api/schemas';
import {
  acceptSpaceInvitationRoute,
  approveSpaceAccessRequestRoute,
  cancelMySpaceAccessRequestRoute,
  createSpaceAccessRequestRoute,
  createSpaceInvitationRoute,
  getSpaceAccessRoute,
  getSpaceSharingRoute,
  rejectSpaceAccessRequestRoute,
  revokeSpaceInvitationRoute,
} from '../../shared/api/routes';
import type { AppContext } from './types';

const sharingRoutes = createOpenApiRouter();
const log = loggers.spaceSharing;

sharingRoutes.use('/api/spaces/*', authMiddleware);

function toAccessRequest(request: {
  id: string;
  space_id: string;
  requester_user_id: string;
  requested_role: 'editor' | 'viewer';
  status: 'pending' | 'approved' | 'rejected' | 'canceled';
  message: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
}): SpaceAccessRequest {
  return {
    id: request.id,
    space_id: request.space_id,
    requester_user_id: request.requester_user_id,
    requested_role: request.requested_role,
    status: request.status,
    message: request.message,
    created_at: request.created_at,
    updated_at: request.updated_at,
    resolved_at: request.resolved_at,
    resolved_by_user_id: request.resolved_by_user_id,
  };
}

function toAccessRequestWithRequester(request: Parameters<typeof toAccessRequest>[0] & {
  requester: { id: string; email: string; name: string | null };
}): SpaceAccessRequestWithRequester {
  return {
    ...toAccessRequest(request),
    requester: request.requester,
  };
}

function toInvitation(invitation: {
  id: string;
  space_id: string;
  email: string;
  normalized_email: string;
  role: 'editor' | 'viewer';
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  invited_by_user_id: string;
  accepted_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  resolved_at: string | null;
}): SpaceInvitation {
  return {
    id: invitation.id,
    space_id: invitation.space_id,
    email: invitation.email,
    normalized_email: invitation.normalized_email,
    role: invitation.role,
    status: invitation.status,
    invited_by_user_id: invitation.invited_by_user_id,
    accepted_by_user_id: invitation.accepted_by_user_id,
    created_at: invitation.created_at,
    updated_at: invitation.updated_at,
    expires_at: invitation.expires_at,
    resolved_at: invitation.resolved_at,
  };
}

function toInvitationWithUsers(invitation: Parameters<typeof toInvitation>[0] & {
  invitedBy: { id: string; email: string; name: string | null } | null;
  acceptedBy: { id: string; email: string; name: string | null } | null;
}): SpaceInvitationWithUsers {
  return {
    ...toInvitation(invitation),
    invitedBy: invitation.invitedBy,
    acceptedBy: invitation.acceptedBy,
  };
}

function toSharingMember(member: {
  user_id: string;
  role: 'owner' | 'editor' | 'viewer';
  joined_at: number;
  user: { id: string; email: string; name: string | null };
}): SpaceSharingMember {
  return {
    user_id: member.user_id,
    role: member.role,
    joined_at: member.joined_at,
    user: member.user,
  };
}

function sharingErrorResponse(c: Context<AppContext>, error: SpaceSharingError) {
  if (error.code === 'space_not_found') {
    return c.json({ error: 'Space not found' }, 404);
  }
  if (error.code === 'active_member') {
    return c.json({ error: 'User already has active access to this space' }, 409);
  }
  if (error.code === 'invalid_role' || error.code === 'invalid_email') {
    return c.json({ error: error.message }, 400);
  }
  return c.json({ error: error.message }, 400);
}

async function requireActiveSpace(c: Context<AppContext>, spaceId: string) {
  const spaceDAO = c.get('container').get(SpaceDAO);
  const space = await spaceDAO.getSpaceById(spaceId);
  if (!space) {
    return false;
  }
  return true;
}

async function requireOwner(c: Context<AppContext>, spaceId: string, userId: string) {
  if (!(await requireActiveSpace(c, spaceId))) {
    return c.json({ error: 'Space not found' }, 404);
  }

  const memberDAO = c.get('container').get(MemberDAO);
  const role = await memberDAO.getMemberRole(spaceId, userId);
  if (role !== 'owner') {
    return c.json({ error: 'Only the owner can manage space sharing' }, 403);
  }

  return null;
}

async function notifyAccessRequestCreated(
  c: Context<AppContext>,
  spaceId: string,
  request: { requester_user_id: string; requested_role: 'editor' | 'viewer' }
): Promise<void> {
  try {
    const container = c.get('container');
    const spaceDAO = container.get(SpaceDAO);
    const userDAO = container.get(UserDAO);
    const space = await spaceDAO.getSpaceById(spaceId);
    if (!space) return;

    const [owner, requester] = await Promise.all([
      userDAO.findById(Number(space.owner_id)),
      userDAO.findById(Number(request.requester_user_id)),
    ]);
    if (!owner?.email || !requester?.email) return;

    await container.get(NotificationEmailService).notifySpaceAccessRequested({
      spaceId,
      spaceName: space.name,
      recipientEmail: owner.email,
      requesterEmail: requester.email,
      role: request.requested_role,
    });
  } catch (error) {
    log.warn('Failed to prepare access request notification', {
      spaceId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function notifyInvitationCreated(
  c: Context<AppContext>,
  spaceId: string,
  invitation: { email: string; role: 'editor' | 'viewer'; invited_by_user_id: string }
): Promise<void> {
  try {
    const container = c.get('container');
    const spaceDAO = container.get(SpaceDAO);
    const userDAO = container.get(UserDAO);
    const space = await spaceDAO.getSpaceById(spaceId);
    const inviter = await userDAO.findById(Number(invitation.invited_by_user_id));
    if (!space || !inviter?.email) return;

    await container.get(NotificationEmailService).notifySpaceInvitationCreated({
      spaceId,
      spaceName: space.name,
      recipientEmail: invitation.email,
      inviterEmail: inviter.email,
      role: invitation.role,
    });
  } catch (error) {
    log.warn('Failed to prepare invitation notification', {
      spaceId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function notifyAccessAccepted(
  c: Context<AppContext>,
  spaceId: string,
  userId: string,
  role: 'editor' | 'viewer'
): Promise<void> {
  try {
    const container = c.get('container');
    const spaceDAO = container.get(SpaceDAO);
    const userDAO = container.get(UserDAO);
    const [space, user] = await Promise.all([
      spaceDAO.getSpaceById(spaceId),
      userDAO.findById(Number(userId)),
    ]);
    if (!space || !user?.email) return;

    await container.get(NotificationEmailService).notifySpaceAccessAccepted({
      spaceId,
      spaceName: space.name,
      recipientEmail: user.email,
      role,
    });
  } catch (error) {
    log.warn('Failed to prepare access accepted notification', {
      spaceId,
      userId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function notifyAccessRevoked(
  c: Context<AppContext>,
  spaceId: string,
  recipientEmail: string,
  role: 'editor' | 'viewer'
): Promise<void> {
  try {
    const container = c.get('container');
    const space = await container.get(SpaceDAO).getSpaceById(spaceId);
    if (!space) return;

    await container.get(NotificationEmailService).notifySpaceAccessRevoked({
      spaceId,
      spaceName: space.name,
      recipientEmail,
      role,
    });
  } catch (error) {
    log.warn('Failed to prepare access revoked notification', {
      spaceId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

sharingRoutes.openapi(getSpaceAccessRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const { id: spaceId } = c.req.valid('param');
  const container = c.get('container');
  const memberDAO = container.get(MemberDAO);
  const sharingDAO = container.get(SpaceSharingDAO);
  const userDAO = container.get(UserDAO);

  if (!(await requireActiveSpace(c, spaceId))) {
    return c.json({ error: 'Space not found' }, 404);
  }

  const member = await memberDAO.getMember(spaceId, userId);
  if (member) {
    const user = await userDAO.findById(Number(userId));
    return c.json({
      success: true as const,
      access: {
        status: 'member' as const,
        member: {
          user_id: member.user_id,
          role: member.role,
          joined_at: member.joined_at,
          user: {
            id: userId,
            email: user?.email ?? '',
            name: user?.name ?? null,
          },
        },
        pendingRequest: null,
        pendingInvitation: null,
      },
    }, 200);
  }

  const pendingRequest = await sharingDAO.getPendingAccessRequestForUser(spaceId, userId);
  if (pendingRequest) {
    return c.json({
      success: true as const,
      access: {
        status: 'pending_request' as const,
        member: null,
        pendingRequest: toAccessRequest(pendingRequest),
        pendingInvitation: null,
      },
    }, 200);
  }

  const user = await userDAO.findById(Number(userId));
  const normalizedEmail = user?.email ? normalizeInvitationEmail(user.email) : null;
  const pendingInvitation = normalizedEmail
    ? await sharingDAO.getPendingInvitationForEmail(spaceId, normalizedEmail)
    : null;
  if (pendingInvitation) {
    return c.json({
      success: true as const,
      access: {
        status: 'pending_invitation' as const,
        member: null,
        pendingRequest: null,
        pendingInvitation: toInvitation(pendingInvitation),
      },
    }, 200);
  }

  return c.json({
    success: true as const,
    access: {
      status: 'none' as const,
      member: null,
      pendingRequest: null,
      pendingInvitation: null,
    },
  }, 200);
});

sharingRoutes.openapi(createSpaceAccessRequestRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const { id: spaceId } = c.req.valid('param');
  const body = c.req.valid('json') ?? {};
  const sharingDAO = c.get('container').get(SpaceSharingDAO);

  try {
    const { request, created } = await sharingDAO.createAccessRequestWithResult({
      spaceId,
      requesterUserId: userId,
      requestedRole: body.requestedRole ?? 'viewer',
      message: body.message ?? null,
    });
    if (created) {
      log.info('Space access request created', {
        spaceId,
        requesterUserId: userId,
        requestedRole: request.requested_role,
        requestId: request.id,
      });
      await notifyAccessRequestCreated(c, spaceId, request);
    } else {
      log.info('Duplicate space access request returned existing pending request', {
        spaceId,
        requesterUserId: userId,
        requestedRole: request.requested_role,
        requestId: request.id,
      });
    }

    return c.json({
      success: true as const,
      request: toAccessRequest(request),
    }, 200);
  } catch (error) {
    if (error instanceof SpaceSharingError) {
      return sharingErrorResponse(c, error);
    }
    throw error;
  }
});

sharingRoutes.openapi(cancelMySpaceAccessRequestRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const { id: spaceId } = c.req.valid('param');
  const sharingDAO = c.get('container').get(SpaceSharingDAO);

  if (!(await requireActiveSpace(c, spaceId))) {
    return c.json({ error: 'Space not found' }, 404);
  }

  const pendingRequest = await sharingDAO.getPendingAccessRequestForUser(spaceId, userId);
  if (!pendingRequest) {
    return c.json({
      success: true as const,
      request: null,
    }, 200);
  }

  const canceled = await sharingDAO.cancelAccessRequest(pendingRequest.id, userId);
  return c.json({
    success: true as const,
    request: canceled ? toAccessRequest(canceled) : null,
  }, 200);
});

sharingRoutes.openapi(getSpaceSharingRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const { id: spaceId } = c.req.valid('param');
  const ownerError = await requireOwner(c, spaceId, userId);
  if (ownerError) return ownerError;

  const sharingDAO = c.get('container').get(SpaceSharingDAO);
  const state = await sharingDAO.getSharingState(spaceId);
  if (!state) {
    return c.json({ error: 'Space not found' }, 404);
  }

  return c.json({
    success: true as const,
    members: state.members.map(toSharingMember),
    pendingAccessRequests: state.pendingAccessRequests.map(toAccessRequestWithRequester),
    pendingInvitations: state.pendingInvitations.map(toInvitationWithUsers),
  }, 200);
});

sharingRoutes.openapi(createSpaceInvitationRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const { id: spaceId } = c.req.valid('param');
  const body = c.req.valid('json');
  const ownerError = await requireOwner(c, spaceId, userId);
  if (ownerError) return ownerError;

  const sharingDAO = c.get('container').get(SpaceSharingDAO);
  try {
    const existing = await sharingDAO.getPendingInvitationForEmail(
      spaceId,
      normalizeInvitationEmail(body.email)
    );
    const invitation = await sharingDAO.createInvitation({
      spaceId,
      email: body.email,
      role: body.role,
      invitedByUserId: userId,
    });
    if (!existing) {
      await notifyInvitationCreated(c, spaceId, invitation);
    }

    return c.json({
      success: true as const,
      invitation: toInvitation(invitation),
    }, 200);
  } catch (error) {
    if (error instanceof SpaceSharingError) {
      return sharingErrorResponse(c, error);
    }
    throw error;
  }
});

sharingRoutes.openapi(approveSpaceAccessRequestRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const { id: spaceId, requestId } = c.req.valid('param');
  const body = c.req.valid('json') ?? {};
  const ownerError = await requireOwner(c, spaceId, userId);
  if (ownerError) return ownerError;

  const sharingDAO = c.get('container').get(SpaceSharingDAO);
  const request = await sharingDAO.getPendingAccessRequestById(requestId);
  if (!request || request.space_id !== spaceId) {
    return c.json({ error: 'Access request not found' }, 404);
  }

  try {
    if (body.role && body.role !== request.requested_role) {
      const updated = await sharingDAO.updateAccessRequestRole(requestId, body.role);
      if (!updated) {
        return c.json({ error: 'Access request not found' }, 404);
      }
    }

    const approved = await sharingDAO.resolveAccessRequest(requestId, userId, 'approved');
    if (!approved) {
      return c.json({ error: 'Access request not found' }, 404);
    }
    log.info('Space access request approved', {
      spaceId,
      requestId,
      requesterUserId: approved.requester_user_id,
      role: approved.requested_role,
      resolvedByUserId: userId,
    });
    await notifyAccessAccepted(c, spaceId, approved.requester_user_id, approved.requested_role);

    return c.json({
      success: true as const,
      request: toAccessRequest(approved),
    }, 200);
  } catch (error) {
    if (error instanceof SpaceSharingError) {
      return sharingErrorResponse(c, error);
    }
    throw error;
  }
});

sharingRoutes.openapi(rejectSpaceAccessRequestRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const { id: spaceId, requestId } = c.req.valid('param');
  const ownerError = await requireOwner(c, spaceId, userId);
  if (ownerError) return ownerError;

  const sharingDAO = c.get('container').get(SpaceSharingDAO);
  const request = await sharingDAO.getPendingAccessRequestById(requestId);
  if (!request || request.space_id !== spaceId) {
    return c.json({ error: 'Access request not found' }, 404);
  }

  const rejected = await sharingDAO.resolveAccessRequest(requestId, userId, 'rejected');
  if (!rejected) {
    return c.json({ error: 'Access request not found' }, 404);
  }
  log.info('Space access request rejected', {
    spaceId,
    requestId,
    requesterUserId: rejected.requester_user_id,
    resolvedByUserId: userId,
  });

  return c.json({
    success: true as const,
    request: toAccessRequest(rejected),
  }, 200);
});

sharingRoutes.openapi(revokeSpaceInvitationRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const { id: spaceId, invitationId } = c.req.valid('param');
  const ownerError = await requireOwner(c, spaceId, userId);
  if (ownerError) return ownerError;

  const sharingDAO = c.get('container').get(SpaceSharingDAO);
  const invitation = await sharingDAO.getPendingInvitationById(invitationId);
  if (!invitation || invitation.space_id !== spaceId) {
    return c.json({ error: 'Invitation not found' }, 404);
  }

  const revoked = await sharingDAO.revokeInvitation(invitationId);
  if (!revoked) {
    return c.json({ error: 'Invitation not found' }, 404);
  }
  log.info('Space invitation revoked', {
    spaceId,
    invitationId,
    role: revoked.role,
    revokedByUserId: userId,
  });
  await notifyAccessRevoked(c, spaceId, revoked.email, revoked.role);

  return c.json({
    success: true as const,
    invitation: toInvitation(revoked),
  }, 200);
});

sharingRoutes.openapi(acceptSpaceInvitationRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const { id: spaceId, invitationId } = c.req.valid('param');
  const sharingDAO = c.get('container').get(SpaceSharingDAO);
  const invitation = await sharingDAO.getPendingInvitationById(invitationId);
  if (!invitation || invitation.space_id !== spaceId) {
    return c.json({ error: 'Invitation not found' }, 404);
  }

  try {
    const accepted = await sharingDAO.acceptInvitation(invitationId, userId);
    if (!accepted) {
      return c.json({ error: 'Invitation not found' }, 404);
    }
    log.info('Space invitation accepted', {
      spaceId,
      invitationId,
      acceptedByUserId: userId,
      role: accepted.role,
    });
    await notifyAccessAccepted(c, spaceId, userId, accepted.role);

    return c.json({
      success: true as const,
      invitation: toInvitation(accepted),
    }, 200);
  } catch (error) {
    if (error instanceof SpaceSharingError) {
      return sharingErrorResponse(c, error);
    }
    throw error;
  }
});

export { sharingRoutes };
