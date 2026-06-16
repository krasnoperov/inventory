import { z } from '@hono/zod-openapi';

export const ErrorResponseSchema = z
  .object({
    error: z.string(),
  })
  .openapi('ErrorResponse');

export const ApiUserSchema = z
  .object({
    id: z.number().int(),
    email: z.string(),
    name: z.string(),
    google_id: z.string().nullable(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .openapi('ApiUser');

export const UserProfileSchema = z
  .object({
    id: z.number().int(),
    email: z.string(),
    name: z.string(),
  })
  .openapi('UserProfile');

export const SessionConfigSchema = z
  .object({
    googleClientId: z.string(),
    environment: z.string(),
  })
  .openapi('SessionConfig');

export const AuthSessionResponseSchema = z
  .object({
    user: ApiUserSchema.nullable(),
    config: SessionConfigSchema,
  })
  .openapi('AuthSessionResponse');

export const GoogleAuthRequestSchema = z
  .object({
    access_token: z.string(),
  })
  .openapi('GoogleAuthRequest');

export const AuthGoogleResponseSchema = z
  .object({
    success: z.literal(true),
    user: ApiUserSchema,
  })
  .openapi('AuthGoogleResponse');

export const SuccessResponseSchema = z
  .object({
    success: z.literal(true),
  })
  .openapi('SuccessResponse');

export const UpdateUserProfileRequestSchema = z
  .object({
    name: z.string().optional(),
  })
  .openapi('UpdateUserProfileRequest');

export const UpdateUserSettingsRequestSchema = z
  .object({
    name: z.string().optional(),
  })
  .openapi('UpdateUserSettingsRequest');

export const UserProfileUpdateResponseSchema = z
  .object({
    success: z.literal(true),
    user: UserProfileSchema,
  })
  .openapi('UserProfileUpdateResponse');

export const UserSettingsResponseSchema = z
  .object({
    success: z.literal(true),
    user: ApiUserSchema,
  })
  .openapi('UserSettingsResponse');

export const SpaceRoleSchema = z.enum(['owner', 'editor', 'viewer']);

export const SpaceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    owner_id: z.string(),
    role: SpaceRoleSchema,
    created_at: z.number(),
  })
  .openapi('Space');

export const SpaceIdParamsSchema = z.object({
  id: z.string().openapi({
    param: {
      name: 'id',
      in: 'path',
    },
  }),
});

export const CreateSpaceRequestSchema = z
  .object({
    name: z.string(),
  })
  .openapi('CreateSpaceRequest');

export const CreateSpaceResponseSchema = z
  .object({
    success: z.literal(true),
    space: SpaceSchema,
  })
  .openapi('CreateSpaceResponse');

export const ListSpacesResponseSchema = z
  .object({
    success: z.literal(true),
    spaces: z.array(SpaceSchema),
  })
  .openapi('ListSpacesResponse');

export const GetSpaceResponseSchema = z
  .object({
    success: z.literal(true),
    space: SpaceSchema,
  })
  .openapi('GetSpaceResponse');

export const MediaKindSchema = z.enum(['image', 'audio', 'video']);

export const AssetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    media_kind: MediaKindSchema,
    tags: z.string(),
    parent_asset_id: z.string().nullable(),
    active_variant_id: z.string().nullable(),
    created_by: z.string(),
    created_at: z.number(),
    updated_at: z.number(),
  })
  .passthrough()
  .openapi('Asset');

export const ListSpaceAssetsResponseSchema = z
  .object({
    success: z.literal(true),
    assets: z.array(AssetSchema),
  })
  .openapi('ListSpaceAssetsResponse');

export const DeleteSpaceResponseSchema = z
  .object({
    success: z.literal(true),
    message: z.string(),
  })
  .openapi('DeleteSpaceResponse');

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type ApiUser = z.infer<typeof ApiUserSchema>;
export type UserProfile = z.infer<typeof UserProfileSchema>;
export type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>;
export type GoogleAuthRequest = z.infer<typeof GoogleAuthRequestSchema>;
export type AuthGoogleResponse = z.infer<typeof AuthGoogleResponseSchema>;
export type SuccessResponse = z.infer<typeof SuccessResponseSchema>;
export type UpdateUserProfileRequest = z.infer<typeof UpdateUserProfileRequestSchema>;
export type UpdateUserSettingsRequest = z.infer<typeof UpdateUserSettingsRequestSchema>;
export type UserProfileUpdateResponse = z.infer<typeof UserProfileUpdateResponseSchema>;
export type UserSettingsResponse = z.infer<typeof UserSettingsResponseSchema>;
export type Space = z.infer<typeof SpaceSchema>;
export type CreateSpaceRequest = z.infer<typeof CreateSpaceRequestSchema>;
export type CreateSpaceResponse = z.infer<typeof CreateSpaceResponseSchema>;
export type ListSpacesResponse = z.infer<typeof ListSpacesResponseSchema>;
export type GetSpaceResponse = z.infer<typeof GetSpaceResponseSchema>;
export type ListSpaceAssetsResponse = z.infer<typeof ListSpaceAssetsResponseSchema>;
export type DeleteSpaceResponse = z.infer<typeof DeleteSpaceResponseSchema>;
