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

export const AuthSessionStateResponseSchema = z
  .object({
    token: z.string(),
    cookieName: z.string(),
    expiresIn: z.number(),
    tokenType: z.literal('Bearer'),
  })
  .openapi('AuthSessionStateResponse');

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

export const ProductionIdParamsSchema = SpaceIdParamsSchema.extend({
  productionId: z.string().openapi({
    param: {
      name: 'productionId',
      in: 'path',
    },
  }),
});

export const ProductionRecordParamsSchema = SpaceIdParamsSchema.extend({
  recordId: z.string().openapi({
    param: {
      name: 'recordId',
      in: 'path',
    },
  }),
});

export const ProductionChildParamsSchema = ProductionIdParamsSchema.extend({
  childId: z.string().openapi({
    param: {
      name: 'childId',
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
export const VariantStatusSchema = z.enum(['pending', 'processing', 'uploading', 'completed', 'failed']);
export const BooleanFromSqliteSchema = z
  .union([z.boolean(), z.literal(0), z.literal(1)])
  .transform((value) => value === true || value === 1)
  .openapi({
    type: 'boolean',
  });

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

export const VariantSchema = z
  .object({
    id: z.string(),
    asset_id: z.string(),
    media_kind: MediaKindSchema,
    workflow_id: z.string().nullable(),
    status: VariantStatusSchema,
    error_message: z.string().nullable(),
    image_key: z.string().nullable(),
    thumb_key: z.string().nullable(),
    media_key: z.string().nullable().optional(),
    media_mime_type: z.string().nullable().optional(),
    media_size_bytes: z.number().nullable().optional(),
    media_width: z.number().nullable().optional(),
    media_height: z.number().nullable().optional(),
    media_duration_ms: z.number().nullable().optional(),
    transcript_key: z.string().nullable().optional(),
    transcript_mime_type: z.string().nullable().optional(),
    transcript_size_bytes: z.number().nullable().optional(),
    word_timings_key: z.string().nullable().optional(),
    word_timings_mime_type: z.string().nullable().optional(),
    word_timings_size_bytes: z.number().nullable().optional(),
    render_metadata_key: z.string().nullable().optional(),
    render_metadata_mime_type: z.string().nullable().optional(),
    render_metadata_size_bytes: z.number().nullable().optional(),
    generation_provenance: z.string().nullable().optional(),
    provider_metadata: z.string().nullable().optional(),
    recipe: z.string(),
    starred: BooleanFromSqliteSchema,
    created_by: z.string(),
    created_at: z.number(),
    updated_at: z.number().nullable(),
  })
  .passthrough()
  .openapi('Variant');

export const ListSpaceAssetsResponseSchema = z
  .object({
    success: z.literal(true),
    assets: z.array(AssetSchema),
  })
  .openapi('ListSpaceAssetsResponse');

export const ProductionRecordSchema = z
  .object({
    id: z.string(),
    production_id: z.string(),
    variant_id: z.string(),
    asset_id: z.string(),
    media_kind: MediaKindSchema,
    shot_id: z.string().nullable(),
    scene_label: z.string(),
    timeline_start_ms: z.number().int().nonnegative(),
    duration_ms: z.number().int().nonnegative().nullable(),
    motion_prompt: z.string().nullable(),
    source_refs: z.string(),
    source_variant_ids: z.string(),
    metadata: z.string(),
    created_by: z.string(),
    created_at: z.number(),
    updated_at: z.number(),
  })
  .openapi('ProductionRecord');

export const PlaceProductionRecordRequestSchema = z
  .object({
    id: z.string().optional(),
    productionId: z.string().min(1),
    variantId: z.string().min(1),
    shotId: z.string().optional(),
    sceneLabel: z.string().min(1),
    timelineStartMs: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative().optional(),
    motionPrompt: z.string().optional(),
    sourceRefs: z.array(z.string()).optional(),
    sourceVariantIds: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('PlaceProductionRecordRequest');

export const ProductionRecordResponseSchema = z
  .object({
    success: z.literal(true),
    record: ProductionRecordSchema,
  })
  .openapi('ProductionRecordResponse');

export const ListProductionRecordsResponseSchema = z
  .object({
    success: z.literal(true),
    records: z.array(ProductionRecordSchema),
  })
  .openapi('ListProductionRecordsResponse');

export const ProductionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    metadata: z.string(),
    created_by: z.string(),
    created_at: z.number(),
    updated_at: z.number(),
  })
  .openapi('Production');

export const ProductionShotSchema = z
  .object({
    id: z.string(),
    production_id: z.string(),
    shot_id: z.string().nullable(),
    label: z.string(),
    timeline_start_ms: z.number().int().nonnegative(),
    duration_ms: z.number().int().nonnegative().nullable(),
    metadata: z.string(),
    created_by: z.string(),
    created_at: z.number(),
    updated_at: z.number(),
  })
  .openapi('ProductionShot');

export const ProductionCueTypeSchema = z.enum(['music', 'sfx', 'dialogue', 'ambience', 'custom']);

export const ProductionCueSchema = z
  .object({
    id: z.string(),
    production_id: z.string(),
    cue_type: ProductionCueTypeSchema,
    label: z.string(),
    timeline_start_ms: z.number().int().nonnegative(),
    duration_ms: z.number().int().nonnegative().nullable(),
    metadata: z.string(),
    created_by: z.string(),
    created_at: z.number(),
    updated_at: z.number(),
  })
  .openapi('ProductionCue');

export const ProductionPlacementTargetKindSchema = z.enum(['shot', 'cue']);

export const ProductionPlacementSchema = z
  .object({
    id: z.string(),
    production_id: z.string(),
    target_kind: ProductionPlacementTargetKindSchema,
    target_id: z.string(),
    variant_id: z.string(),
    asset_id: z.string(),
    media_kind: MediaKindSchema,
    role: z.string().nullable(),
    source_refs: z.string(),
    source_variant_ids: z.string(),
    metadata: z.string(),
    created_by: z.string(),
    created_at: z.number(),
    updated_at: z.number(),
  })
  .openapi('ProductionPlacement');

export const UpsertProductionRequestSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('UpsertProductionRequest');

export const UpsertProductionShotRequestSchema = z
  .object({
    id: z.string().optional(),
    shotId: z.string().optional(),
    label: z.string().min(1),
    timelineStartMs: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('UpsertProductionShotRequest');

export const UpsertProductionCueRequestSchema = z
  .object({
    id: z.string().optional(),
    cueType: ProductionCueTypeSchema.optional(),
    label: z.string().min(1),
    timelineStartMs: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('UpsertProductionCueRequest');

export const UpsertProductionPlacementRequestSchema = z
  .object({
    id: z.string().optional(),
    targetKind: ProductionPlacementTargetKindSchema,
    targetId: z.string().min(1),
    variantId: z.string().min(1),
    role: z.string().optional(),
    sourceRefs: z.array(z.string()).optional(),
    sourceVariantIds: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('UpsertProductionPlacementRequest');

export const ListProductionsResponseSchema = z
  .object({
    success: z.literal(true),
    productions: z.array(ProductionSchema),
  })
  .openapi('ListProductionsResponse');

export const ProductionResponseSchema = z
  .object({
    success: z.literal(true),
    production: ProductionSchema,
  })
  .openapi('ProductionResponse');

export const ProductionDetailResponseSchema = z
  .object({
    success: z.literal(true),
    production: ProductionSchema,
    shots: z.array(ProductionShotSchema),
    cues: z.array(ProductionCueSchema),
    placements: z.array(ProductionPlacementSchema),
  })
  .openapi('ProductionDetailResponse');

export const ProductionShotResponseSchema = z
  .object({
    success: z.literal(true),
    shot: ProductionShotSchema,
  })
  .openapi('ProductionShotResponse');

export const ProductionCueResponseSchema = z
  .object({
    success: z.literal(true),
    cue: ProductionCueSchema,
  })
  .openapi('ProductionCueResponse');

export const ProductionPlacementResponseSchema = z
  .object({
    success: z.literal(true),
    placement: ProductionPlacementSchema,
  })
  .openapi('ProductionPlacementResponse');

export const DeleteSpaceResponseSchema = z
  .object({
    success: z.literal(true),
    message: z.string(),
  })
  .openapi('DeleteSpaceResponse');

const UploadFileSchema = z.custom<File>((value) => value instanceof File, {
  message: 'Expected file upload',
}).openapi({
  type: 'string',
  format: 'binary',
});

export const UploadMediaRequestSchema = z
  .object({
    file: UploadFileSchema,
    assetId: z.string().optional(),
    assetName: z.string().optional(),
    assetType: z.string().optional(),
    mediaKind: MediaKindSchema.optional(),
    parentAssetId: z.string().optional(),
    transcript: UploadFileSchema.optional(),
    wordTimings: UploadFileSchema.optional(),
    renderMetadata: UploadFileSchema.optional(),
  })
  .openapi('UploadMediaRequest');

export const UploadMediaResponseSchema = z
  .object({
    success: z.literal(true),
    variant: VariantSchema,
    asset: AssetSchema.optional(),
  })
  .openapi('UploadMediaResponse');

export const UploadStyleImageRequestSchema = z
  .object({
    file: UploadFileSchema,
  })
  .openapi('UploadStyleImageRequest');

export const UploadStyleImageResponseSchema = z
  .object({
    success: z.literal(true),
    imageKey: z.string(),
    warning: z.string().optional(),
  })
  .openapi('UploadStyleImageResponse');

export const VariantMediaParamsSchema = z.object({
  spaceId: z.string().openapi({
    param: {
      name: 'spaceId',
      in: 'path',
    },
  }),
  variantId: z.string().openapi({
    param: {
      name: 'variantId',
      in: 'path',
    },
  }),
});

export const BinaryResponseSchema = z.string().openapi({
  type: 'string',
  format: 'binary',
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type ApiUser = z.infer<typeof ApiUserSchema>;
export type UserProfile = z.infer<typeof UserProfileSchema>;
export type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>;
export type GoogleAuthRequest = z.infer<typeof GoogleAuthRequestSchema>;
export type AuthGoogleResponse = z.infer<typeof AuthGoogleResponseSchema>;
export type AuthSessionStateResponse = z.infer<typeof AuthSessionStateResponseSchema>;
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
export type ProductionRecord = z.infer<typeof ProductionRecordSchema>;
export type PlaceProductionRecordRequest = z.infer<typeof PlaceProductionRecordRequestSchema>;
export type ProductionRecordResponse = z.infer<typeof ProductionRecordResponseSchema>;
export type ListProductionRecordsResponse = z.infer<typeof ListProductionRecordsResponseSchema>;
export type Production = z.infer<typeof ProductionSchema>;
export type ProductionShot = z.infer<typeof ProductionShotSchema>;
export type ProductionCue = z.infer<typeof ProductionCueSchema>;
export type ProductionPlacement = z.infer<typeof ProductionPlacementSchema>;
export type UpsertProductionRequest = z.infer<typeof UpsertProductionRequestSchema>;
export type UpsertProductionShotRequest = z.infer<typeof UpsertProductionShotRequestSchema>;
export type UpsertProductionCueRequest = z.infer<typeof UpsertProductionCueRequestSchema>;
export type UpsertProductionPlacementRequest = z.infer<typeof UpsertProductionPlacementRequestSchema>;
export type ListProductionsResponse = z.infer<typeof ListProductionsResponseSchema>;
export type ProductionResponse = z.infer<typeof ProductionResponseSchema>;
export type ProductionDetailResponse = z.infer<typeof ProductionDetailResponseSchema>;
export type ProductionShotResponse = z.infer<typeof ProductionShotResponseSchema>;
export type ProductionCueResponse = z.infer<typeof ProductionCueResponseSchema>;
export type ProductionPlacementResponse = z.infer<typeof ProductionPlacementResponseSchema>;
export type Variant = z.infer<typeof VariantSchema>;
export type UploadMediaRequest = z.infer<typeof UploadMediaRequestSchema>;
export type UploadMediaResponse = z.infer<typeof UploadMediaResponseSchema>;
export type UploadStyleImageRequest = z.infer<typeof UploadStyleImageRequestSchema>;
export type UploadStyleImageResponse = z.infer<typeof UploadStyleImageResponseSchema>;
