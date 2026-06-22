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
    mediaCdnBaseUrl: z.string().nullable().optional(),
    features: z.object({
      rotation: z.boolean(),
    }),
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

export const ProviderKeyProviderSchema = z
  .enum(['google_ai', 'anthropic', 'elevenlabs', 'lyria'])
  .openapi('ProviderKeyProvider');

export const ProviderKeyParamsSchema = z.object({
  provider: ProviderKeyProviderSchema.openapi({
    param: {
      name: 'provider',
      in: 'path',
    },
  }),
});

export const ProviderKeySummarySchema = z
  .object({
    provider: ProviderKeyProviderSchema,
    label: z.string(),
    configured: z.boolean(),
    keyHint: z.string().nullable(),
    updatedAt: z.string().nullable(),
    platformConfigured: z.boolean(),
  })
  .openapi('ProviderKeySummary');

export const ListProviderKeysResponseSchema = z
  .object({
    success: z.literal(true),
    providers: z.array(ProviderKeySummarySchema),
  })
  .openapi('ListProviderKeysResponse');

export const UpsertProviderKeyRequestSchema = z
  .object({
    apiKey: z.string(),
  })
  .openapi('UpsertProviderKeyRequest');

export const ProviderKeyResponseSchema = z
  .object({
    success: z.literal(true),
    provider: ProviderKeySummarySchema,
  })
  .openapi('ProviderKeyResponse');

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
export const PlatformUsageTypeSchema = z.enum(['storage', 'workflow', 'delivery']);
export const PlatformUsageUnitSchema = z.enum(['byte', 'run']);
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

export const LineageSchema = z
  .object({
    id: z.string(),
    parent_variant_id: z.string(),
    child_variant_id: z.string(),
    relation_type: z.enum(['derived', 'refined', 'forked']),
    severed: BooleanFromSqliteSchema.optional(),
    created_at: z.number().optional(),
  })
  .passthrough()
  .openapi('Lineage');

export const ListSpaceAssetsResponseSchema = z
  .object({
    success: z.literal(true),
    assets: z.array(AssetSchema),
  })
  .openapi('ListSpaceAssetsResponse');

export const SpaceSubjectTypeSchema = z.enum(['asset', 'variant']);
export const CollectionKindSchema = z.enum([
  'cast',
  'style_refs',
  'backgrounds',
  'scenes',
  'thumbnails',
  'maps',
  'deliverables',
  'custom',
]);
export const SpaceRelationTypeSchema = z.enum([
  'appears_in',
  'background_for',
  'style_reference_for',
  'thumbnail_for',
  'alternate_of',
  'prop_in',
  'map_for',
  'part_of',
  'reference_for',
  'custom',
]);
export const CompositionItemRoleSchema = z.enum([
  'output',
  'background',
  'character',
  'prop',
  'style_ref',
  'overlay',
  'map',
  'thumbnail',
  'custom',
]);
export const CompositionStatusSchema = z.enum(['draft', 'final']);

export const CollectionIdParamsSchema = SpaceIdParamsSchema.extend({
  collectionId: z.string().openapi({
    param: {
      name: 'collectionId',
      in: 'path',
    },
  }),
});

export const CollectionItemParamsSchema = CollectionIdParamsSchema.extend({
  itemId: z.string().openapi({
    param: {
      name: 'itemId',
      in: 'path',
    },
  }),
});

export const StylePresetParamsSchema = SpaceIdParamsSchema.extend({
  presetId: z.string().openapi({
    param: {
      name: 'presetId',
      in: 'path',
    },
  }),
});

export const RelationParamsSchema = SpaceIdParamsSchema.extend({
  relationId: z.string().openapi({
    param: {
      name: 'relationId',
      in: 'path',
    },
  }),
});

export const CompositionIdParamsSchema = SpaceIdParamsSchema.extend({
  compositionId: z.string().openapi({
    param: {
      name: 'compositionId',
      in: 'path',
    },
  }),
});

export const CompositionItemParamsSchema = CompositionIdParamsSchema.extend({
  itemId: z.string().openapi({
    param: {
      name: 'itemId',
      in: 'path',
    },
  }),
});

export const SpaceSubjectSchema = z
  .object({
    subjectType: SpaceSubjectTypeSchema,
    assetId: z.string().optional(),
    variantId: z.string().optional(),
  })
  .openapi('SpaceSubject');

export const SpaceCollectionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: CollectionKindSchema,
    color: z.string().nullable(),
    description: z.string().nullable(),
    sort_index: z.number().int(),
    created_by: z.string(),
    created_at: z.number(),
    updated_at: z.number(),
  })
  .openapi('SpaceCollection');

export const CollectionItemSchema = z
  .object({
    id: z.string(),
    collection_id: z.string(),
    subject_type: SpaceSubjectTypeSchema,
    asset_id: z.string().nullable(),
    variant_id: z.string().nullable(),
    role: z.string(),
    pinned_variant_id: z.string().nullable(),
    sort_index: z.number().int(),
    created_by: z.string(),
    created_at: z.number(),
    updated_at: z.number(),
  })
  .openapi('CollectionItem');

export const StyleReferenceCollectionSchema = SpaceCollectionSchema.extend({
  reference_count: z.number().int(),
  preset_count: z.number().int(),
}).openapi('StyleReferenceCollection');

export const StylePresetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    style_prompt: z.string(),
    collection_id: z.string().nullable(),
    enabled: BooleanFromSqliteSchema,
    is_default: BooleanFromSqliteSchema,
    created_by: z.string(),
    created_at: z.number(),
    updated_at: z.number(),
    collection_name: z.string().nullable(),
    reference_count: z.number().int(),
    style_reference_variant_ids: z.array(z.string()),
    style_reference_image_keys: z.array(z.string()),
  })
  .openapi('StylePreset');

export const SpaceRelationSchema = z
  .object({
    id: z.string(),
    subject_type: SpaceSubjectTypeSchema,
    subject_asset_id: z.string().nullable(),
    subject_variant_id: z.string().nullable(),
    object_type: SpaceSubjectTypeSchema,
    object_asset_id: z.string().nullable(),
    object_variant_id: z.string().nullable(),
    relation_type: SpaceRelationTypeSchema,
    label: z.string().nullable(),
    context: z.string().nullable(),
    metadata: z.string(),
    sort_index: z.number().int(),
    created_by: z.string(),
    created_at: z.number(),
    updated_at: z.number(),
  })
  .openapi('SpaceRelation');

export const CompositionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    status: CompositionStatusSchema,
    output_asset_id: z.string().nullable(),
    output_variant_id: z.string().nullable(),
    metadata: z.string(),
    sort_index: z.number().int(),
    created_by: z.string(),
    created_at: z.number(),
    updated_at: z.number(),
  })
  .openapi('Composition');

export const CompositionItemSchema = z
  .object({
    id: z.string(),
    composition_id: z.string(),
    role: CompositionItemRoleSchema,
    label: z.string().nullable(),
    asset_id: z.string().nullable(),
    variant_id: z.string(),
    metadata: z.string(),
    sort_index: z.number().int(),
    created_by: z.string(),
    created_at: z.number(),
    updated_at: z.number(),
  })
  .openapi('CompositionItem');

export const UpsertCollectionRequestSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    kind: CollectionKindSchema.optional(),
    color: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    sortIndex: z.number().int().optional(),
  })
  .openapi('UpsertCollectionRequest');

export const UpdateCollectionRequestSchema = UpsertCollectionRequestSchema.omit({ id: true }).partial().openapi('UpdateCollectionRequest');

export const UpsertCollectionItemRequestSchema = z
  .object({
    id: z.string().optional(),
    subjectType: SpaceSubjectTypeSchema,
    assetId: z.string().optional(),
    variantId: z.string().optional(),
    role: z.string().optional(),
    pinnedVariantId: z.string().nullable().optional(),
    sortIndex: z.number().int().optional(),
  })
  .openapi('UpsertCollectionItemRequest');

export const UpsertStylePresetRequestSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    stylePrompt: z.string().optional(),
    collectionId: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
    isDefault: z.boolean().optional(),
  })
  .openapi('UpsertStylePresetRequest');

export const UpdateStylePresetRequestSchema = UpsertStylePresetRequestSchema.omit({ id: true, name: true }).extend({
  name: z.string().min(1).optional(),
}).openapi('UpdateStylePresetRequest');

export const UpdateCollectionItemRequestSchema = z
  .object({
    role: z.string().optional(),
    pinnedVariantId: z.string().nullable().optional(),
    sortIndex: z.number().int().optional(),
  })
  .openapi('UpdateCollectionItemRequest');

export const ReorderItemsRequestSchema = z
  .object({
    itemIds: z.array(z.string()),
  })
  .openapi('ReorderItemsRequest');

export const UpsertRelationRequestSchema = z
  .object({
    id: z.string().optional(),
    subject: SpaceSubjectSchema,
    object: SpaceSubjectSchema,
    relationType: SpaceRelationTypeSchema,
    label: z.string().nullable().optional(),
    context: z.union([z.string(), z.record(z.string(), z.unknown())]).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    sortIndex: z.number().int().optional(),
  })
  .openapi('UpsertRelationRequest');

export const UpdateRelationRequestSchema = z
  .object({
    relationType: SpaceRelationTypeSchema.optional(),
    label: z.string().nullable().optional(),
    context: z.union([z.string(), z.record(z.string(), z.unknown())]).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    sortIndex: z.number().int().optional(),
  })
  .openapi('UpdateRelationRequest');

export const UpsertCompositionRequestSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    status: CompositionStatusSchema.optional(),
    outputAssetId: z.string().nullable().optional(),
    outputVariantId: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    sortIndex: z.number().int().optional(),
  })
  .openapi('UpsertCompositionRequest');

export const UpdateCompositionRequestSchema = UpsertCompositionRequestSchema.omit({ id: true, name: true }).extend({
  name: z.string().min(1).optional(),
}).openapi('UpdateCompositionRequest');

export const UpsertCompositionItemRequestSchema = z
  .object({
    id: z.string().optional(),
    role: CompositionItemRoleSchema,
    label: z.string().nullable().optional(),
    assetId: z.string().nullable().optional(),
    variantId: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
    sortIndex: z.number().int().optional(),
  })
  .openapi('UpsertCompositionItemRequest');

export const UpdateCompositionItemRequestSchema = z
  .object({
    role: CompositionItemRoleSchema.optional(),
    label: z.string().nullable().optional(),
    assetId: z.string().nullable().optional(),
    variantId: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    sortIndex: z.number().int().optional(),
  })
  .openapi('UpdateCompositionItemRequest');

export const ListCollectionsResponseSchema = z
  .object({
    success: z.literal(true),
    collections: z.array(SpaceCollectionSchema),
  })
  .openapi('ListCollectionsResponse');

export const CollectionResponseSchema = z
  .object({
    success: z.literal(true),
    collection: SpaceCollectionSchema,
  })
  .openapi('CollectionResponse');

export const ListCollectionItemsResponseSchema = z
  .object({
    success: z.literal(true),
    items: z.array(CollectionItemSchema),
  })
  .openapi('ListCollectionItemsResponse');

export const CollectionItemResponseSchema = z
  .object({
    success: z.literal(true),
    item: CollectionItemSchema,
  })
  .openapi('CollectionItemResponse');

export const ListStyleReferenceCollectionsResponseSchema = z
  .object({
    success: z.literal(true),
    collections: z.array(StyleReferenceCollectionSchema),
  })
  .openapi('ListStyleReferenceCollectionsResponse');

export const ListStylePresetsResponseSchema = z
  .object({
    success: z.literal(true),
    presets: z.array(StylePresetSchema),
  })
  .openapi('ListStylePresetsResponse');

export const StylePresetResponseSchema = z
  .object({
    success: z.literal(true),
    preset: StylePresetSchema,
  })
  .openapi('StylePresetResponse');

export const ListRelationsResponseSchema = z
  .object({
    success: z.literal(true),
    relations: z.array(SpaceRelationSchema),
  })
  .openapi('ListRelationsResponse');

export const RelationResponseSchema = z
  .object({
    success: z.literal(true),
    relation: SpaceRelationSchema,
  })
  .openapi('RelationResponse');

export const ListCompositionsResponseSchema = z
  .object({
    success: z.literal(true),
    compositions: z.array(CompositionSchema),
  })
  .openapi('ListCompositionsResponse');

export const CompositionResponseSchema = z
  .object({
    success: z.literal(true),
    composition: CompositionSchema,
  })
  .openapi('CompositionResponse');

export const ListCompositionItemsResponseSchema = z
  .object({
    success: z.literal(true),
    items: z.array(CompositionItemSchema),
  })
  .openapi('ListCompositionItemsResponse');

export const CompositionItemResponseSchema = z
  .object({
    success: z.literal(true),
    item: CompositionItemSchema,
  })
  .openapi('CompositionItemResponse');

export const UsageSummaryQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export const PlatformUsageTypeSummarySchema = z
  .object({
    usageType: PlatformUsageTypeSchema,
    unit: PlatformUsageUnitSchema,
    quantity: z.number().int(),
    events: z.number().int().nonnegative(),
  })
  .openapi('PlatformUsageTypeSummary');

export const PlatformUsageMediaKindSummarySchema = z
  .object({
    mediaKind: MediaKindSchema.nullable(),
    storageBytes: z.number().int(),
    workflowRuns: z.number().int(),
    deliveryBytes: z.number().int(),
    events: z.number().int().nonnegative(),
  })
  .openapi('PlatformUsageMediaKindSummary');

export const PlatformUsageSummaryResponseSchema = z
  .object({
    success: z.literal(true),
    spaceId: z.string(),
    period: z.object({
      from: z.string().nullable(),
      to: z.string().nullable(),
    }),
    totals: z.object({
      storageBytes: z.number().int(),
      workflowRuns: z.number().int(),
      deliveryBytes: z.number().int(),
    }),
    byType: z.array(PlatformUsageTypeSummarySchema),
    byMediaKind: z.array(PlatformUsageMediaKindSummarySchema),
  })
  .openapi('PlatformUsageSummaryResponse');

export const ProviderSpendSummaryQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  user_id: z.string().optional(),
  userId: z.string().optional(),
  space_id: z.string().optional(),
  spaceId: z.string().optional(),
  provider: z.string().optional(),
  media_kind: MediaKindSchema.optional(),
  mediaKind: MediaKindSchema.optional(),
});

export const ProviderSpendAggregateSchema = z
  .object({
    amountMicroUsd: z.number().int(),
    amountUsd: z.number(),
    quantity: z.number(),
    entries: z.number().int().nonnegative(),
    unpricedEntries: z.number().int().nonnegative(),
  })
  .openapi('ProviderSpendAggregate');

export const ProviderSpendSummaryResponseSchema = z
  .object({
    success: z.literal(true),
    period: z.object({
      from: z.string().nullable(),
      to: z.string().nullable(),
    }),
    filters: z.object({
      userId: z.number().int().nullable(),
      spaceId: z.string().nullable(),
      provider: z.string().nullable(),
      mediaKind: MediaKindSchema.nullable(),
    }),
    totals: ProviderSpendAggregateSchema,
    byProvider: z.array(ProviderSpendAggregateSchema.extend({
      provider: z.string(),
    })),
    byModel: z.array(ProviderSpendAggregateSchema.extend({
      provider: z.string(),
      providerModel: z.string(),
    })),
    byMediaKind: z.array(ProviderSpendAggregateSchema.extend({
      mediaKind: MediaKindSchema.nullable(),
    })),
    byMeterEventName: z.array(ProviderSpendAggregateSchema.extend({
      meterEventName: z.string().nullable(),
    })),
    bySpace: z.array(ProviderSpendAggregateSchema.extend({
      spaceId: z.string().nullable(),
    })),
    byAsset: z.array(ProviderSpendAggregateSchema.extend({
      spaceId: z.string().nullable(),
      assetId: z.string().nullable(),
    })),
  })
  .openapi('ProviderSpendSummaryResponse');

export const BillingEntitlementSchema = z
  .enum(['none', 'paid', 'internal'])
  .openapi('BillingEntitlement');

export const BillingPlanStatusSchema = z
  .enum(['inactive', 'active', 'internal'])
  .openapi('BillingPlanStatus');

export const BillingPlanStatusResponseSchema = z
  .object({
    key: z.literal('paid_generation'),
    displayName: z.string(),
    status: BillingPlanStatusSchema,
    checkoutAvailable: z.boolean(),
    portalAvailable: z.boolean(),
  })
  .openapi('BillingPlanStatusResponse');

export const BillingMeterStatusSchema = z
  .object({
    name: z.string(),
    consumed: z.number(),
    credited: z.number(),
    remaining: z.number(),
    percentUsed: z.number(),
    hasLimit: z.boolean(),
    status: z.enum(['ok', 'warning', 'critical', 'exceeded']),
  })
  .openapi('BillingMeterStatus');

export const BillingStatusResponseSchema = z
  .object({
    configured: z.boolean(),
    available: z.boolean(),
    hasSubscription: z.boolean(),
    entitlement: BillingEntitlementSchema,
    plan: BillingPlanStatusResponseSchema,
    meters: z.array(BillingMeterStatusSchema),
    subscription: z.object({
      status: z.string(),
      periodStart: z.string().nullable().optional(),
      renewsAt: z.string().nullable(),
    }).nullable(),
    portalUrl: z.string().nullable(),
    error: z.string().optional(),
  })
  .openapi('BillingStatusResponse');

export const BillingUsageMeterSchema = z
  .object({
    used: z.number(),
    limit: z.number().nullable(),
    remaining: z.number().nullable(),
    costUsd: z.number().optional(),
  })
  .openapi('BillingUsageMeter');

export const BillingUsageResponseSchema = z
  .object({
    period: z.object({
      start: z.string(),
      end: z.string(),
    }),
    usage: z.record(z.string(), BillingUsageMeterSchema),
    estimatedCost: z.object({
      amount: z.number(),
      currency: z.string(),
    }).optional(),
  })
  .openapi('BillingUsageResponse');

export const BillingUrlResponseSchema = z
  .object({
    url: z.string(),
  })
  .openapi('BillingUrlResponse');

export const BillingUrlQuerySchema = z.object({
  return_url: z.string().optional(),
  success_url: z.string().optional(),
});

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
    operation: z.string().optional(),
    prompt: z.string().optional(),
    model: z.string().optional(),
    provider: z.string().optional(),
    providerMetadata: z.string().optional(),
    generationProvenance: z.string().optional(),
    lineage: z.string().optional(),
    activeVariantBehavior: z.string().optional(),
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
    lineage: z.array(LineageSchema).optional(),
  })
  .openapi('UploadMediaResponse');

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
export type ProviderKeyProvider = z.infer<typeof ProviderKeyProviderSchema>;
export type ProviderKeySummary = z.infer<typeof ProviderKeySummarySchema>;
export type ListProviderKeysResponse = z.infer<typeof ListProviderKeysResponseSchema>;
export type UpsertProviderKeyRequest = z.infer<typeof UpsertProviderKeyRequestSchema>;
export type ProviderKeyResponse = z.infer<typeof ProviderKeyResponseSchema>;
export type Space = z.infer<typeof SpaceSchema>;
export type CreateSpaceRequest = z.infer<typeof CreateSpaceRequestSchema>;
export type CreateSpaceResponse = z.infer<typeof CreateSpaceResponseSchema>;
export type ListSpacesResponse = z.infer<typeof ListSpacesResponseSchema>;
export type GetSpaceResponse = z.infer<typeof GetSpaceResponseSchema>;
export type ListSpaceAssetsResponse = z.infer<typeof ListSpaceAssetsResponseSchema>;
export type SpaceSubjectType = z.infer<typeof SpaceSubjectTypeSchema>;
export type CollectionKind = z.infer<typeof CollectionKindSchema>;
export type SpaceRelationType = z.infer<typeof SpaceRelationTypeSchema>;
export type CompositionItemRole = z.infer<typeof CompositionItemRoleSchema>;
export type CompositionStatus = z.infer<typeof CompositionStatusSchema>;
export type SpaceSubject = z.infer<typeof SpaceSubjectSchema>;
export type SpaceCollection = z.infer<typeof SpaceCollectionSchema>;
export type CollectionItem = z.infer<typeof CollectionItemSchema>;
export type SpaceRelation = z.infer<typeof SpaceRelationSchema>;
export type Composition = z.infer<typeof CompositionSchema>;
export type CompositionItem = z.infer<typeof CompositionItemSchema>;
export type UpsertCollectionRequest = z.infer<typeof UpsertCollectionRequestSchema>;
export type UpdateCollectionRequest = z.infer<typeof UpdateCollectionRequestSchema>;
export type UpsertCollectionItemRequest = z.infer<typeof UpsertCollectionItemRequestSchema>;
export type UpdateCollectionItemRequest = z.infer<typeof UpdateCollectionItemRequestSchema>;
export type ReorderItemsRequest = z.infer<typeof ReorderItemsRequestSchema>;
export type UpsertRelationRequest = z.infer<typeof UpsertRelationRequestSchema>;
export type UpdateRelationRequest = z.infer<typeof UpdateRelationRequestSchema>;
export type UpsertCompositionRequest = z.infer<typeof UpsertCompositionRequestSchema>;
export type UpdateCompositionRequest = z.infer<typeof UpdateCompositionRequestSchema>;
export type UpsertCompositionItemRequest = z.infer<typeof UpsertCompositionItemRequestSchema>;
export type UpdateCompositionItemRequest = z.infer<typeof UpdateCompositionItemRequestSchema>;
export type ListCollectionsResponse = z.infer<typeof ListCollectionsResponseSchema>;
export type CollectionResponse = z.infer<typeof CollectionResponseSchema>;
export type ListCollectionItemsResponse = z.infer<typeof ListCollectionItemsResponseSchema>;
export type CollectionItemResponse = z.infer<typeof CollectionItemResponseSchema>;
export type ListRelationsResponse = z.infer<typeof ListRelationsResponseSchema>;
export type RelationResponse = z.infer<typeof RelationResponseSchema>;
export type ListCompositionsResponse = z.infer<typeof ListCompositionsResponseSchema>;
export type CompositionResponse = z.infer<typeof CompositionResponseSchema>;
export type ListCompositionItemsResponse = z.infer<typeof ListCompositionItemsResponseSchema>;
export type CompositionItemResponse = z.infer<typeof CompositionItemResponseSchema>;
export type PlatformUsageTypeSummary = z.infer<typeof PlatformUsageTypeSummarySchema>;
export type PlatformUsageMediaKindSummary = z.infer<typeof PlatformUsageMediaKindSummarySchema>;
export type PlatformUsageSummaryResponse = z.infer<typeof PlatformUsageSummaryResponseSchema>;
export type ProviderSpendSummaryResponse = z.infer<typeof ProviderSpendSummaryResponseSchema>;
export type BillingMeterStatus = z.infer<typeof BillingMeterStatusSchema>;
export type BillingPlanStatus = z.infer<typeof BillingPlanStatusSchema>;
export type BillingPlanStatusResponse = z.infer<typeof BillingPlanStatusResponseSchema>;
export type BillingStatusResponse = z.infer<typeof BillingStatusResponseSchema>;
export type BillingUrlResponse = z.infer<typeof BillingUrlResponseSchema>;
export type BillingUsageMeter = z.infer<typeof BillingUsageMeterSchema>;
export type BillingUsageResponse = z.infer<typeof BillingUsageResponseSchema>;
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
export type Lineage = z.infer<typeof LineageSchema>;
export type UploadMediaRequest = z.infer<typeof UploadMediaRequestSchema>;
export type UploadMediaResponse = z.infer<typeof UploadMediaResponseSchema>;
