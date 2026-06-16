import { createRoute } from '@hono/zod-openapi';
import {
  AuthGoogleResponseSchema,
  AuthSessionResponseSchema,
  CreateSpaceRequestSchema,
  CreateSpaceResponseSchema,
  DeleteSpaceResponseSchema,
  ErrorResponseSchema,
  GetSpaceResponseSchema,
  GoogleAuthRequestSchema,
  ListSpaceAssetsResponseSchema,
  ListSpacesResponseSchema,
  SpaceIdParamsSchema,
  SuccessResponseSchema,
  UpdateUserProfileRequestSchema,
  UpdateUserSettingsRequestSchema,
  UserProfileSchema,
  UserProfileUpdateResponseSchema,
  UserSettingsResponseSchema,
} from './schemas';

const json = <T>(schema: T) => ({
  content: {
    'application/json': {
      schema,
    },
  },
});

const errorResponse = {
  ...json(ErrorResponseSchema),
  description: 'Error response',
};

export const getAuthSessionRoute = createRoute({
  method: 'get',
  path: '/api/auth/session',
  responses: {
    200: {
      ...json(AuthSessionResponseSchema),
      description: 'Current auth session and public client config',
    },
  },
});

export const postGoogleAuthRoute = createRoute({
  method: 'post',
  path: '/api/auth/google',
  request: {
    body: {
      content: {
        'application/json': {
          schema: GoogleAuthRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      ...json(AuthGoogleResponseSchema),
      description: 'Authenticated Google user',
    },
    400: errorResponse,
    500: errorResponse,
  },
});

export const postAuthLogoutRoute = createRoute({
  method: 'post',
  path: '/api/auth/logout',
  responses: {
    200: {
      ...json(SuccessResponseSchema),
      description: 'Session cleared',
    },
  },
});

export const putUserSettingsRoute = createRoute({
  method: 'put',
  path: '/api/user/settings',
  request: {
    body: {
      content: {
        'application/json': {
          schema: UpdateUserSettingsRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      ...json(UserSettingsResponseSchema),
      description: 'Updated user settings',
    },
    400: errorResponse,
    500: errorResponse,
  },
});

export const getUserProfileRoute = createRoute({
  method: 'get',
  path: '/api/user/profile',
  responses: {
    200: {
      ...json(UserProfileSchema),
      description: 'Current user profile',
    },
    404: errorResponse,
  },
});

export const patchUserProfileRoute = createRoute({
  method: 'patch',
  path: '/api/user/profile',
  request: {
    body: {
      content: {
        'application/json': {
          schema: UpdateUserProfileRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      ...json(UserProfileUpdateResponseSchema),
      description: 'Updated current user profile',
    },
    400: errorResponse,
    404: errorResponse,
  },
});

export const postSpaceRoute = createRoute({
  method: 'post',
  path: '/api/spaces',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateSpaceRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      ...json(CreateSpaceResponseSchema),
      description: 'Created space',
    },
    400: errorResponse,
  },
});

export const listSpacesRoute = createRoute({
  method: 'get',
  path: '/api/spaces',
  responses: {
    200: {
      ...json(ListSpacesResponseSchema),
      description: 'Spaces for the current user',
    },
  },
});

export const getSpaceRoute = createRoute({
  method: 'get',
  path: '/api/spaces/{id}',
  request: {
    params: SpaceIdParamsSchema,
  },
  responses: {
    200: {
      ...json(GetSpaceResponseSchema),
      description: 'Space metadata',
    },
    403: errorResponse,
    404: errorResponse,
  },
});

export const listSpaceAssetsRoute = createRoute({
  method: 'get',
  path: '/api/spaces/{id}/assets',
  request: {
    params: SpaceIdParamsSchema,
  },
  responses: {
    200: {
      ...json(ListSpaceAssetsResponseSchema),
      description: 'Assets in a space',
    },
    403: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const deleteSpaceRoute = createRoute({
  method: 'delete',
  path: '/api/spaces/{id}',
  request: {
    params: SpaceIdParamsSchema,
  },
  responses: {
    200: {
      ...json(DeleteSpaceResponseSchema),
      description: 'Deleted space',
    },
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
  },
});
