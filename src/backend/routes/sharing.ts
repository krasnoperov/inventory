import type { Context } from 'hono';
import { authMiddleware } from '../middleware/auth-middleware';
import { MemberDAO } from '../../dao/member-dao';
import { SpaceDAO } from '../../dao/space-dao';
import { SpaceSharingDAO, SpaceSharingError, normalizeInvitationEmail } from '../../dao/space-sharing-dao';
import { UserDAO } from '../../dao/user-dao';
import { createOpenApiRouter } from './openapi';
import type {
  SpaceAccessRequest,
  SpaceAccessRequestWithRequester,
  SpaceInvitation,
  SpaceInvitationWithUsers,
  SpaceSharingMember,
} from '../../shared/api/schemas';
import {
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
    const request = await sharingDAO.createAccessRequest({
      spaceId,
      requesterUserId: userId,
      requestedRole: body.requestedRole ?? 'viewer',
      message: body.message ?? null,
    });

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
    const invitation = await sharingDAO.createInvitation({
      spaceId,
      email: body.email,
      role: body.role,
      invitedByUserId: userId,
    });

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

  return c.json({
    success: true as const,
    invitation: toInvitation(revoked),
  }, 200);
});

export { sharingRoutes };
