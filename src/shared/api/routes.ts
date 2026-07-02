import { createRoute } from '@hono/zod-openapi';
import {
  AuthGoogleResponseSchema,
  AuthSessionResponseSchema,
  AuthSessionStateResponseSchema,
  ApproveSpaceAccessRequestRequestSchema,
  BinaryResponseSchema,
  CollectionIdParamsSchema,
  CollectionItemParamsSchema,
  CollectionItemResponseSchema,
  CollectionResponseSchema,
  CancelSpaceAccessRequestResponseSchema,
  CreateSpaceAccessRequestRequestSchema,
  CreateSpaceInvitationRequestSchema,
  CreateSpaceRequestSchema,
  CreateSpaceResponseSchema,
  DeleteSpaceResponseSchema,
  ErrorResponseSchema,
  GetSpaceAccessResponseSchema,
  GetSpaceResponseSchema,
  GetSupportSpaceResponseSchema,
  GoogleAuthRequestSchema,
  ListCollectionItemsResponseSchema,
  ListCollectionsResponseSchema,
  ListSpaceAssetsResponseSchema,
  ListStylePresetsResponseSchema,
  ListStyleReferenceCollectionsResponseSchema,
  ListProviderKeysResponseSchema,
  ListSpacesResponseSchema,
  PlatformUsageSummaryResponseSchema,
  ProviderKeyParamsSchema,
  ProviderKeyResponseSchema,
  DeleteAccountRequestSchema,
  DeleteAccountResponseSchema,
  ReorderItemsRequestSchema,
  RestoreSupportSpaceResponseSchema,
  SpaceAccessRequestParamsSchema,
  SpaceAccessRequestResponseSchema,
  SpaceIdParamsSchema,
  SpaceInvitationParamsSchema,
  SpaceInvitationResponseSchema,
  SpaceSharingResponseSchema,
  StylePresetParamsSchema,
  StylePresetResponseSchema,
  SuccessResponseSchema,
  UsageSummaryQuerySchema,
  UpdateCollectionItemRequestSchema,
  UpdateCollectionRequestSchema,
  UpdateStylePresetRequestSchema,
  UpsertCollectionItemRequestSchema,
  UpsertCollectionRequestSchema,
  UpsertStylePresetRequestSchema,
  UpdateUserProfileRequestSchema,
  UpdateUserSettingsRequestSchema,
  UpsertProviderKeyRequestSchema,
  UploadMediaRequestSchema,
  UploadMediaResponseSchema,
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

export const listProviderKeysRoute = createRoute({
  method: 'get',
  path: '/api/user/provider-keys',
  responses: {
    200: {
      ...json(ListProviderKeysResponseSchema),
      description: 'Current user provider key configuration',
    },
    401: errorResponse,
  },
});

export const putProviderKeyRoute = createRoute({
  method: 'put',
  path: '/api/user/provider-keys/{provider}',
  request: {
    params: ProviderKeyParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: UpsertProviderKeyRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      ...json(ProviderKeyResponseSchema),
      description: 'Stored encrypted provider key',
    },
    400: errorResponse,
    503: errorResponse,
  },
});

export const deleteProviderKeyRoute = createRoute({
  method: 'delete',
  path: '/api/user/provider-keys/{provider}',
  request: {
    params: ProviderKeyParamsSchema,
  },
  responses: {
    200: {
      ...json(ProviderKeyResponseSchema),
      description: 'Removed provider key',
    },
    400: errorResponse,
    503: errorResponse,
  },
});

export const deleteAccountRoute = createRoute({
  method: 'delete',
  path: '/api/user/account',
  request: {
    body: {
      content: {
        'application/json': {
          schema: DeleteAccountRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      ...json(DeleteAccountResponseSchema),
      description: 'Permanently deleted the authenticated user account',
    },
    400: errorResponse,
    401: errorResponse,
    404: errorResponse,
    500: errorResponse,
    502: errorResponse,
    503: errorResponse,
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

export const getSpaceAccessRoute = createRoute({
  method: 'get',
  path: '/api/spaces/{id}/access',
  request: {
    params: SpaceIdParamsSchema,
  },
  responses: {
    200: {
      ...json(GetSpaceAccessResponseSchema),
      description: 'Current access state for the signed-in user',
    },
    401: errorResponse,
    404: errorResponse,
  },
});

export const createSpaceAccessRequestRoute = createRoute({
  method: 'post',
  path: '/api/spaces/{id}/access-requests',
  request: {
    params: SpaceIdParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: CreateSpaceAccessRequestRequestSchema,
        },
      },
      required: false,
    },
  },
  responses: {
    200: {
      ...json(SpaceAccessRequestResponseSchema),
      description: 'Created or returned the current pending access request',
    },
    400: errorResponse,
    401: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
});

export const cancelMySpaceAccessRequestRoute = createRoute({
  method: 'delete',
  path: '/api/spaces/{id}/access-requests/me',
  request: {
    params: SpaceIdParamsSchema,
  },
  responses: {
    200: {
      ...json(CancelSpaceAccessRequestResponseSchema),
      description: 'Canceled the current user pending access request if one exists',
    },
    401: errorResponse,
    404: errorResponse,
  },
});

export const getSpaceSharingRoute = createRoute({
  method: 'get',
  path: '/api/spaces/{id}/sharing',
  request: {
    params: SpaceIdParamsSchema,
  },
  responses: {
    200: {
      ...json(SpaceSharingResponseSchema),
      description: 'Members, pending access requests, and pending invitations for a space',
    },
    403: errorResponse,
    404: errorResponse,
  },
});

export const createSpaceInvitationRoute = createRoute({
  method: 'post',
  path: '/api/spaces/{id}/invitations',
  request: {
    params: SpaceIdParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: CreateSpaceInvitationRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      ...json(SpaceInvitationResponseSchema),
      description: 'Created or returned the pending invitation for an email address',
    },
    400: errorResponse,
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
});

export const approveSpaceAccessRequestRoute = createRoute({
  method: 'post',
  path: '/api/spaces/{id}/access-requests/{requestId}/approve',
  request: {
    params: SpaceAccessRequestParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: ApproveSpaceAccessRequestRequestSchema,
        },
      },
      required: false,
    },
  },
  responses: {
    200: {
      ...json(SpaceAccessRequestResponseSchema),
      description: 'Approved a pending access request and granted membership',
    },
    400: errorResponse,
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
});

export const rejectSpaceAccessRequestRoute = createRoute({
  method: 'post',
  path: '/api/spaces/{id}/access-requests/{requestId}/reject',
  request: {
    params: SpaceAccessRequestParamsSchema,
  },
  responses: {
    200: {
      ...json(SpaceAccessRequestResponseSchema),
      description: 'Rejected a pending access request without granting membership',
    },
    403: errorResponse,
    404: errorResponse,
  },
});

export const revokeSpaceInvitationRoute = createRoute({
  method: 'post',
  path: '/api/spaces/{id}/invitations/{invitationId}/revoke',
  request: {
    params: SpaceInvitationParamsSchema,
  },
  responses: {
    200: {
      ...json(SpaceInvitationResponseSchema),
      description: 'Revoked a pending invitation',
    },
    403: errorResponse,
    404: errorResponse,
  },
});

export const acceptSpaceInvitationRoute = createRoute({
  method: 'post',
  path: '/api/spaces/{id}/invitations/{invitationId}/accept',
  request: {
    params: SpaceInvitationParamsSchema,
  },
  responses: {
    200: {
      ...json(SpaceInvitationResponseSchema),
      description: 'Accepted a pending invitation and granted membership',
    },
    400: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
});

export const getSupportSpaceRoute = createRoute({
  method: 'get',
  path: '/api/support/spaces/{id}',
  request: {
    params: SpaceIdParamsSchema,
  },
  responses: {
    200: {
      ...json(GetSupportSpaceResponseSchema),
      description: 'Support metadata for a space, including soft-deleted rows',
    },
    403: errorResponse,
    404: errorResponse,
  },
});

export const restoreSupportSpaceRoute = createRoute({
  method: 'post',
  path: '/api/support/spaces/{id}/restore',
  request: {
    params: SpaceIdParamsSchema,
  },
  responses: {
    200: {
      ...json(RestoreSupportSpaceResponseSchema),
      description: 'Restored soft-deleted space',
    },
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
    500: errorResponse,
    503: errorResponse,
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

export const listCollectionsRoute = createRoute({
  method: 'get',
  path: '/api/spaces/{id}/collections',
  request: {
    params: SpaceIdParamsSchema,
  },
  responses: {
    200: {
      ...json(ListCollectionsResponseSchema),
      description: 'Collections in a space',
    },
    403: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const createCollectionRoute = createRoute({
  method: 'post',
  path: '/api/spaces/{id}/collections',
  request: {
    params: SpaceIdParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: UpsertCollectionRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      ...json(CollectionResponseSchema),
      description: 'Created collection',
    },
    400: errorResponse,
    403: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const updateCollectionRoute = createRoute({
  method: 'patch',
  path: '/api/spaces/{id}/collections/{collectionId}',
  request: {
    params: CollectionIdParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateCollectionRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      ...json(CollectionResponseSchema),
      description: 'Updated collection',
    },
    400: errorResponse,
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const deleteCollectionRoute = createRoute({
  method: 'delete',
  path: '/api/spaces/{id}/collections/{collectionId}',
  request: {
    params: CollectionIdParamsSchema,
  },
  responses: {
    200: {
      ...json(SuccessResponseSchema),
      description: 'Deleted collection',
    },
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const listCollectionItemsRoute = createRoute({
  method: 'get',
  path: '/api/spaces/{id}/collections/{collectionId}/items',
  request: {
    params: CollectionIdParamsSchema,
  },
  responses: {
    200: {
      ...json(ListCollectionItemsResponseSchema),
      description: 'Collection items in a space collection',
    },
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const createCollectionItemRoute = createRoute({
  method: 'post',
  path: '/api/spaces/{id}/collections/{collectionId}/items',
  request: {
    params: CollectionIdParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: UpsertCollectionItemRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      ...json(CollectionItemResponseSchema),
      description: 'Created collection item',
    },
    400: errorResponse,
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const updateCollectionItemRoute = createRoute({
  method: 'patch',
  path: '/api/spaces/{id}/collections/{collectionId}/items/{itemId}',
  request: {
    params: CollectionItemParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateCollectionItemRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      ...json(CollectionItemResponseSchema),
      description: 'Updated collection item',
    },
    400: errorResponse,
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const reorderCollectionItemsRoute = createRoute({
  method: 'post',
  path: '/api/spaces/{id}/collections/{collectionId}/items/reorder',
  request: {
    params: CollectionIdParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: ReorderItemsRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      ...json(ListCollectionItemsResponseSchema),
      description: 'Reordered collection items',
    },
    400: errorResponse,
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const deleteCollectionItemRoute = createRoute({
  method: 'delete',
  path: '/api/spaces/{id}/collections/{collectionId}/items/{itemId}',
  request: {
    params: CollectionItemParamsSchema,
  },
  responses: {
    200: {
      ...json(SuccessResponseSchema),
      description: 'Deleted collection item',
    },
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const listStyleReferenceCollectionsRoute = createRoute({
  method: 'get',
  path: '/api/spaces/{id}/style-reference-collections',
  request: {
    params: SpaceIdParamsSchema,
  },
  responses: {
    200: {
      ...json(ListStyleReferenceCollectionsResponseSchema),
      description: 'Style reference collections in a space',
    },
    403: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const listStylePresetsRoute = createRoute({
  method: 'get',
  path: '/api/spaces/{id}/style-presets',
  request: {
    params: SpaceIdParamsSchema,
  },
  responses: {
    200: {
      ...json(ListStylePresetsResponseSchema),
      description: 'Style presets in a space',
    },
    403: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const createStylePresetRoute = createRoute({
  method: 'post',
  path: '/api/spaces/{id}/style-presets',
  request: {
    params: SpaceIdParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: UpsertStylePresetRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      ...json(StylePresetResponseSchema),
      description: 'Created style preset',
    },
    400: errorResponse,
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const updateStylePresetRoute = createRoute({
  method: 'patch',
  path: '/api/spaces/{id}/style-presets/{presetId}',
  request: {
    params: StylePresetParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateStylePresetRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      ...json(StylePresetResponseSchema),
      description: 'Updated style preset',
    },
    400: errorResponse,
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const deleteStylePresetRoute = createRoute({
  method: 'delete',
  path: '/api/spaces/{id}/style-presets/{presetId}',
  request: {
    params: StylePresetParamsSchema,
  },
  responses: {
    200: {
      ...json(SuccessResponseSchema),
      description: 'Deleted style preset',
    },
    403: errorResponse,
    404: errorResponse,
    500: errorResponse,
    503: errorResponse,
  },
});

export const getSpaceUsageSummaryRoute = createRoute({
  method: 'get',
  path: '/api/spaces/{id}/usage/summary',
  request: {
    params: SpaceIdParamsSchema,
    query: UsageSummaryQuerySchema,
  },
  responses: {
    200: {
      ...json(PlatformUsageSummaryResponseSchema),
      description: 'Platform storage, workflow, and delivery usage summary for a space',
    },
    400: errorResponse,
    403: errorResponse,
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
    503: errorResponse,
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
