import { createRoute } from '@hono/zod-openapi';
import {
  AuthGoogleResponseSchema,
  AuthSessionResponseSchema,
  AuthSessionStateResponseSchema,
  BinaryResponseSchema,
  CreateSpaceRequestSchema,
  CreateSpaceResponseSchema,
  DeleteSpaceResponseSchema,
  ErrorResponseSchema,
  GetSpaceResponseSchema,
  GoogleAuthRequestSchema,
  ListSpaceAssetsResponseSchema,
  ListProductionRecordsResponseSchema,
  ListSpacesResponseSchema,
  PlaceProductionRecordRequestSchema,
  ProductionIdParamsSchema,
  ProductionChildParamsSchema,
  ListProductionsResponseSchema,
  ProductionCueResponseSchema,
  ProductionDetailResponseSchema,
  ProductionPlacementResponseSchema,
  ProductionRecordParamsSchema,
  ProductionRecordResponseSchema,
  ProductionResponseSchema,
  ProductionShotResponseSchema,
  SpaceIdParamsSchema,
  SuccessResponseSchema,
  UpsertProductionCueRequestSchema,
  UpsertProductionPlacementRequestSchema,
  UpsertProductionRequestSchema,
  UpsertProductionShotRequestSchema,
  UpdateUserProfileRequestSchema,
  UpdateUserSettingsRequestSchema,
  UploadMediaRequestSchema,
  UploadMediaResponseSchema,
  UploadStyleImageRequestSchema,
  UploadStyleImageResponseSchema,
  UserProfileSchema,
  UserProfileUpdateResponseSchema,
  UserSettingsResponseSchema,
  VariantMediaParamsSchema,
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

const multipart = <T>(schema: T) => ({
  content: {
    'multipart/form-data': {
      schema,
    },
  },
});

const binary = {
  content: {
    'application/octet-stream': {
      schema: BinaryResponseSchema,
    },
  },
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

export const postAuthSessionStateRoute = createRoute({
  method: 'post',
  path: '/api/auth/session-state',
  responses: {
    200: {
      ...json(AuthSessionStateResponseSchema),
      description: 'Short-lived web session token minted from a CLI bearer token',
    },
    401: errorResponse,
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

export const listProductionsRoute = createRoute({
  method: 'get',
  path: '/api/spaces/{id}/productions',
  request: {
    params: SpaceIdParamsSchema,
  },
  responses: {
    200: {
      ...json(ListProductionsResponseSchema),
      description: 'Productions in a space',
    },
    403: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const upsertProductionRoute = createRoute({
  method: 'post',
  path: '/api/spaces/{id}/productions',
  request: {
    params: SpaceIdParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: UpsertProductionRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      ...json(ProductionResponseSchema),
      description: 'Created or updated production',
    },
    400: errorResponse,
    403: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const getProductionRoute = createRoute({
  method: 'get',
  path: '/api/spaces/{id}/productions/{productionId}',
  request: {
    params: ProductionIdParamsSchema,
  },
  responses: {
    200: {
      ...json(ProductionDetailResponseSchema),
      description: 'Production with shots, cues, and placements',
    },
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const deleteProductionRoute = createRoute({
  method: 'delete',
  path: '/api/spaces/{id}/productions/{productionId}',
  request: {
    params: ProductionIdParamsSchema,
  },
  responses: {
    200: {
      ...json(SuccessResponseSchema),
      description: 'Deleted production',
    },
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const upsertProductionShotRoute = createRoute({
  method: 'post',
  path: '/api/spaces/{id}/productions/{productionId}/shots',
  request: {
    params: ProductionIdParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: UpsertProductionShotRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      ...json(ProductionShotResponseSchema),
      description: 'Created or updated production shot',
    },
    400: errorResponse,
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const deleteProductionShotRoute = createRoute({
  method: 'delete',
  path: '/api/spaces/{id}/productions/{productionId}/shots/{childId}',
  request: {
    params: ProductionChildParamsSchema,
  },
  responses: {
    200: {
      ...json(SuccessResponseSchema),
      description: 'Deleted production shot',
    },
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const upsertProductionCueRoute = createRoute({
  method: 'post',
  path: '/api/spaces/{id}/productions/{productionId}/cues',
  request: {
    params: ProductionIdParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: UpsertProductionCueRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      ...json(ProductionCueResponseSchema),
      description: 'Created or updated production cue',
    },
    400: errorResponse,
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const deleteProductionCueRoute = createRoute({
  method: 'delete',
  path: '/api/spaces/{id}/productions/{productionId}/cues/{childId}',
  request: {
    params: ProductionChildParamsSchema,
  },
  responses: {
    200: {
      ...json(SuccessResponseSchema),
      description: 'Deleted production cue',
    },
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const upsertProductionPlacementRoute = createRoute({
  method: 'post',
  path: '/api/spaces/{id}/productions/{productionId}/placements',
  request: {
    params: ProductionIdParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: UpsertProductionPlacementRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      ...json(ProductionPlacementResponseSchema),
      description: 'Created or updated production placement',
    },
    400: errorResponse,
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const deleteProductionPlacementRoute = createRoute({
  method: 'delete',
  path: '/api/spaces/{id}/productions/{productionId}/placements/{childId}',
  request: {
    params: ProductionChildParamsSchema,
  },
  responses: {
    200: {
      ...json(SuccessResponseSchema),
      description: 'Deleted production placement',
    },
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const listProductionRecordsRoute = createRoute({
  method: 'get',
  path: '/api/spaces/{id}/productions/{productionId}/records',
  request: {
    params: ProductionIdParamsSchema,
  },
  responses: {
    200: {
      ...json(ListProductionRecordsResponseSchema),
      description: 'Production records in a space',
    },
    400: errorResponse,
    403: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const placeProductionRecordRoute = createRoute({
  method: 'post',
  path: '/api/spaces/{id}/production/placements',
  request: {
    params: SpaceIdParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: PlaceProductionRecordRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      ...json(ProductionRecordResponseSchema),
      description: 'Created or updated production placement record',
    },
    400: errorResponse,
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const deleteProductionRecordRoute = createRoute({
  method: 'delete',
  path: '/api/spaces/{id}/production/records/{recordId}',
  request: {
    params: ProductionRecordParamsSchema,
  },
  responses: {
    200: {
      ...json(SuccessResponseSchema),
      description: 'Deleted production record',
    },
    403: errorResponse,
    404: errorResponse,
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

export const uploadMediaRoute = createRoute({
  method: 'post',
  path: '/api/spaces/{id}/upload',
  request: {
    params: SpaceIdParamsSchema,
    body: {
      ...multipart(UploadMediaRequestSchema),
      required: true,
    },
  },
  responses: {
    200: {
      ...json(UploadMediaResponseSchema),
      description: 'Uploaded media variant',
    },
    400: errorResponse,
    413: errorResponse,
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const uploadStyleImageRoute = createRoute({
  method: 'post',
  path: '/api/spaces/{id}/style-images',
  request: {
    params: SpaceIdParamsSchema,
    body: {
      ...multipart(UploadStyleImageRequestSchema),
      required: true,
    },
  },
  responses: {
    200: {
      ...json(UploadStyleImageResponseSchema),
      description: 'Uploaded style reference image',
    },
    400: errorResponse,
    413: errorResponse,
    403: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const getVariantMediaRoute = createRoute({
  method: 'get',
  path: '/api/spaces/{spaceId}/variants/{variantId}/media',
  request: {
    params: VariantMediaParamsSchema,
  },
  responses: {
    200: {
      ...binary,
      description: 'Variant media artifact',
    },
    206: {
      ...binary,
      description: 'Partial variant media artifact',
    },
    304: {
      description: 'Variant media artifact not modified',
    },
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const getVariantPosterRoute = createRoute({
  method: 'get',
  path: '/api/spaces/{spaceId}/variants/{variantId}/poster',
  request: {
    params: VariantMediaParamsSchema,
  },
  responses: {
    200: {
      ...binary,
      description: 'Variant poster artifact',
    },
    304: {
      description: 'Variant poster artifact not modified',
    },
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const getVariantTranscriptRoute = createRoute({
  method: 'get',
  path: '/api/spaces/{spaceId}/variants/{variantId}/transcript',
  request: {
    params: VariantMediaParamsSchema,
  },
  responses: {
    200: {
      ...binary,
      description: 'Variant transcript sidecar artifact',
    },
    304: {
      description: 'Variant transcript sidecar artifact not modified',
    },
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const getVariantWordTimingsRoute = createRoute({
  method: 'get',
  path: '/api/spaces/{spaceId}/variants/{variantId}/word-timings',
  request: {
    params: VariantMediaParamsSchema,
  },
  responses: {
    200: {
      ...binary,
      description: 'Variant word timings sidecar artifact',
    },
    304: {
      description: 'Variant word timings sidecar artifact not modified',
    },
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const getVariantRenderMetadataRoute = createRoute({
  method: 'get',
  path: '/api/spaces/{spaceId}/variants/{variantId}/render-metadata',
  request: {
    params: VariantMediaParamsSchema,
  },
  responses: {
    200: {
      ...binary,
      description: 'Variant render metadata sidecar artifact',
    },
    304: {
      description: 'Variant render metadata sidecar artifact not modified',
    },
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});
