import { z } from '@hono/zod-openapi';
import {
  AuthGoogleResponseSchema,
  AuthSessionResponseSchema,
  ApproveSpaceAccessRequestRequestSchema,
  BillingStatusResponseSchema,
  BillingUrlQuerySchema,
  BillingUrlResponseSchema,
  BillingUsageResponseSchema,
  CollectionIdParamsSchema,
  CollectionItemParamsSchema,
  CollectionItemResponseSchema,
  CollectionResponseSchema,
  CompositionIdParamsSchema,
  CompositionItemParamsSchema,
  CompositionItemResponseSchema,
  CompositionResponseSchema,
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
  ListCompositionItemsResponseSchema,
  ListCompositionsResponseSchema,
  ListSpaceAssetsResponseSchema,
  ListStylePresetsResponseSchema,
  ListStyleReferenceCollectionsResponseSchema,
  ListProductionRecordsResponseSchema,
  ListProviderKeysResponseSchema,
  ListProductionsResponseSchema,
  ListRelationsResponseSchema,
  ListSpacesResponseSchema,
  PlaceProductionRecordRequestSchema,
  PlatformUsageSummaryResponseSchema,
  ProviderSpendSummaryQuerySchema,
  ProviderSpendSummaryResponseSchema,
  ProviderKeyParamsSchema,
  ProviderKeyResponseSchema,
  DeleteAccountRequestSchema,
  DeleteAccountResponseSchema,
  ProductionChildParamsSchema,
  ProductionCueResponseSchema,
  ProductionDetailResponseSchema,
  ProductionIdParamsSchema,
  ProductionPlacementResponseSchema,
  ProductionRecordParamsSchema,
  ProductionRecordResponseSchema,
  ProductionResponseSchema,
  ProductionShotResponseSchema,
  RelationParamsSchema,
  RelationResponseSchema,
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
  UpdateCompositionItemRequestSchema,
  UpdateCompositionRequestSchema,
  UpdateRelationRequestSchema,
  UpdateStylePresetRequestSchema,
  UpsertCollectionItemRequestSchema,
  UpsertCollectionRequestSchema,
  UpsertCompositionItemRequestSchema,
  UpsertCompositionRequestSchema,
  UpsertProductionCueRequestSchema,
  UpsertProductionPlacementRequestSchema,
  UpsertProductionRequestSchema,
  UpsertProductionShotRequestSchema,
  UpsertRelationRequestSchema,
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

export const apiEndpoints = {
  'GET /api/auth/session': {
    method: 'GET',
    path: '/api/auth/session',
    responseSchema: AuthSessionResponseSchema,
  },
  'POST /api/auth/google': {
    method: 'POST',
    path: '/api/auth/google',
    jsonSchema: GoogleAuthRequestSchema,
    responseSchema: AuthGoogleResponseSchema,
  },
  'POST /api/auth/logout': {
    method: 'POST',
    path: '/api/auth/logout',
    responseSchema: SuccessResponseSchema,
  },
  'PUT /api/user/settings': {
    method: 'PUT',
    path: '/api/user/settings',
    jsonSchema: UpdateUserSettingsRequestSchema,
    responseSchema: UserSettingsResponseSchema,
  },
  'GET /api/user/profile': {
    method: 'GET',
    path: '/api/user/profile',
    responseSchema: UserProfileSchema,
  },
  'PATCH /api/user/profile': {
    method: 'PATCH',
    path: '/api/user/profile',
    jsonSchema: UpdateUserProfileRequestSchema,
    responseSchema: UserProfileUpdateResponseSchema,
  },
  'GET /api/user/provider-keys': {
    method: 'GET',
    path: '/api/user/provider-keys',
    responseSchema: ListProviderKeysResponseSchema,
  },
  'PUT /api/user/provider-keys/:provider': {
    method: 'PUT',
    path: '/api/user/provider-keys/:provider',
    paramsSchema: ProviderKeyParamsSchema,
    jsonSchema: UpsertProviderKeyRequestSchema,
    responseSchema: ProviderKeyResponseSchema,
  },
  'DELETE /api/user/provider-keys/:provider': {
    method: 'DELETE',
    path: '/api/user/provider-keys/:provider',
    paramsSchema: ProviderKeyParamsSchema,
    responseSchema: ProviderKeyResponseSchema,
  },
  'DELETE /api/user/account': {
    method: 'DELETE',
    path: '/api/user/account',
    jsonSchema: DeleteAccountRequestSchema,
    responseSchema: DeleteAccountResponseSchema,
  },
  'POST /api/spaces': {
    method: 'POST',
    path: '/api/spaces',
    jsonSchema: CreateSpaceRequestSchema,
    responseSchema: CreateSpaceResponseSchema,
  },
  'GET /api/spaces': {
    method: 'GET',
    path: '/api/spaces',
    responseSchema: ListSpacesResponseSchema,
  },
  'GET /api/spaces/:id': {
    method: 'GET',
    path: '/api/spaces/:id',
    paramsSchema: SpaceIdParamsSchema,
    responseSchema: GetSpaceResponseSchema,
  },
  'GET /api/spaces/:id/access': {
    method: 'GET',
    path: '/api/spaces/:id/access',
    paramsSchema: SpaceIdParamsSchema,
    responseSchema: GetSpaceAccessResponseSchema,
  },
  'POST /api/spaces/:id/access-requests': {
    method: 'POST',
    path: '/api/spaces/:id/access-requests',
    paramsSchema: SpaceIdParamsSchema,
    jsonSchema: CreateSpaceAccessRequestRequestSchema,
    responseSchema: SpaceAccessRequestResponseSchema,
  },
  'DELETE /api/spaces/:id/access-requests/me': {
    method: 'DELETE',
    path: '/api/spaces/:id/access-requests/me',
    paramsSchema: SpaceIdParamsSchema,
    responseSchema: CancelSpaceAccessRequestResponseSchema,
  },
  'GET /api/spaces/:id/sharing': {
    method: 'GET',
    path: '/api/spaces/:id/sharing',
    paramsSchema: SpaceIdParamsSchema,
    responseSchema: SpaceSharingResponseSchema,
  },
  'POST /api/spaces/:id/invitations': {
    method: 'POST',
    path: '/api/spaces/:id/invitations',
    paramsSchema: SpaceIdParamsSchema,
    jsonSchema: CreateSpaceInvitationRequestSchema,
    responseSchema: SpaceInvitationResponseSchema,
  },
  'POST /api/spaces/:id/access-requests/:requestId/approve': {
    method: 'POST',
    path: '/api/spaces/:id/access-requests/:requestId/approve',
    paramsSchema: SpaceAccessRequestParamsSchema,
    jsonSchema: ApproveSpaceAccessRequestRequestSchema.optional(),
    responseSchema: SpaceAccessRequestResponseSchema,
  },
  'POST /api/spaces/:id/access-requests/:requestId/reject': {
    method: 'POST',
    path: '/api/spaces/:id/access-requests/:requestId/reject',
    paramsSchema: SpaceAccessRequestParamsSchema,
    responseSchema: SpaceAccessRequestResponseSchema,
  },
  'POST /api/spaces/:id/invitations/:invitationId/revoke': {
    method: 'POST',
    path: '/api/spaces/:id/invitations/:invitationId/revoke',
    paramsSchema: SpaceInvitationParamsSchema,
    responseSchema: SpaceInvitationResponseSchema,
  },
  'POST /api/spaces/:id/invitations/:invitationId/accept': {
    method: 'POST',
    path: '/api/spaces/:id/invitations/:invitationId/accept',
    paramsSchema: SpaceInvitationParamsSchema,
    responseSchema: SpaceInvitationResponseSchema,
  },
  'GET /api/support/spaces/:id': {
    method: 'GET',
    path: '/api/support/spaces/:id',
    paramsSchema: SpaceIdParamsSchema,
    responseSchema: GetSupportSpaceResponseSchema,
  },
  'POST /api/support/spaces/:id/restore': {
    method: 'POST',
    path: '/api/support/spaces/:id/restore',
    paramsSchema: SpaceIdParamsSchema,
    responseSchema: RestoreSupportSpaceResponseSchema,
  },
  'GET /api/spaces/:id/assets': {
    method: 'GET',
    path: '/api/spaces/:id/assets',
    paramsSchema: SpaceIdParamsSchema,
    responseSchema: ListSpaceAssetsResponseSchema,
  },
  'GET /api/spaces/:id/collections': {
    method: 'GET',
    path: '/api/spaces/:id/collections',
    paramsSchema: SpaceIdParamsSchema,
    responseSchema: ListCollectionsResponseSchema,
  },
  'POST /api/spaces/:id/collections': {
    method: 'POST',
    path: '/api/spaces/:id/collections',
    paramsSchema: SpaceIdParamsSchema,
    jsonSchema: UpsertCollectionRequestSchema,
    responseSchema: CollectionResponseSchema,
  },
  'PATCH /api/spaces/:id/collections/:collectionId': {
    method: 'PATCH',
    path: '/api/spaces/:id/collections/:collectionId',
    paramsSchema: CollectionIdParamsSchema,
    jsonSchema: UpdateCollectionRequestSchema,
    responseSchema: CollectionResponseSchema,
  },
  'DELETE /api/spaces/:id/collections/:collectionId': {
    method: 'DELETE',
    path: '/api/spaces/:id/collections/:collectionId',
    paramsSchema: CollectionIdParamsSchema,
    responseSchema: SuccessResponseSchema,
  },
  'GET /api/spaces/:id/collections/:collectionId/items': {
    method: 'GET',
    path: '/api/spaces/:id/collections/:collectionId/items',
    paramsSchema: CollectionIdParamsSchema,
    responseSchema: ListCollectionItemsResponseSchema,
  },
  'POST /api/spaces/:id/collections/:collectionId/items': {
    method: 'POST',
    path: '/api/spaces/:id/collections/:collectionId/items',
    paramsSchema: CollectionIdParamsSchema,
    jsonSchema: UpsertCollectionItemRequestSchema,
    responseSchema: CollectionItemResponseSchema,
  },
  'PATCH /api/spaces/:id/collections/:collectionId/items/:itemId': {
    method: 'PATCH',
    path: '/api/spaces/:id/collections/:collectionId/items/:itemId',
    paramsSchema: CollectionItemParamsSchema,
    jsonSchema: UpdateCollectionItemRequestSchema,
    responseSchema: CollectionItemResponseSchema,
  },
  'POST /api/spaces/:id/collections/:collectionId/items/reorder': {
    method: 'POST',
    path: '/api/spaces/:id/collections/:collectionId/items/reorder',
    paramsSchema: CollectionIdParamsSchema,
    jsonSchema: ReorderItemsRequestSchema,
    responseSchema: ListCollectionItemsResponseSchema,
  },
  'DELETE /api/spaces/:id/collections/:collectionId/items/:itemId': {
    method: 'DELETE',
    path: '/api/spaces/:id/collections/:collectionId/items/:itemId',
    paramsSchema: CollectionItemParamsSchema,
    responseSchema: SuccessResponseSchema,
  },
  'GET /api/spaces/:id/style-reference-collections': {
    method: 'GET',
    path: '/api/spaces/:id/style-reference-collections',
    paramsSchema: SpaceIdParamsSchema,
    responseSchema: ListStyleReferenceCollectionsResponseSchema,
  },
  'GET /api/spaces/:id/style-presets': {
    method: 'GET',
    path: '/api/spaces/:id/style-presets',
    paramsSchema: SpaceIdParamsSchema,
    responseSchema: ListStylePresetsResponseSchema,
  },
  'POST /api/spaces/:id/style-presets': {
    method: 'POST',
    path: '/api/spaces/:id/style-presets',
    paramsSchema: SpaceIdParamsSchema,
    jsonSchema: UpsertStylePresetRequestSchema,
    responseSchema: StylePresetResponseSchema,
  },
  'PATCH /api/spaces/:id/style-presets/:presetId': {
    method: 'PATCH',
    path: '/api/spaces/:id/style-presets/:presetId',
    paramsSchema: StylePresetParamsSchema,
    jsonSchema: UpdateStylePresetRequestSchema,
    responseSchema: StylePresetResponseSchema,
  },
  'DELETE /api/spaces/:id/style-presets/:presetId': {
    method: 'DELETE',
    path: '/api/spaces/:id/style-presets/:presetId',
    paramsSchema: StylePresetParamsSchema,
    responseSchema: SuccessResponseSchema,
  },
  'GET /api/spaces/:id/relations': {
    method: 'GET',
    path: '/api/spaces/:id/relations',
    paramsSchema: SpaceIdParamsSchema,
    responseSchema: ListRelationsResponseSchema,
  },
  'POST /api/spaces/:id/relations': {
    method: 'POST',
    path: '/api/spaces/:id/relations',
    paramsSchema: SpaceIdParamsSchema,
    jsonSchema: UpsertRelationRequestSchema,
    responseSchema: RelationResponseSchema,
  },
  'PATCH /api/spaces/:id/relations/:relationId': {
    method: 'PATCH',
    path: '/api/spaces/:id/relations/:relationId',
    paramsSchema: RelationParamsSchema,
    jsonSchema: UpdateRelationRequestSchema,
    responseSchema: RelationResponseSchema,
  },
  'DELETE /api/spaces/:id/relations/:relationId': {
    method: 'DELETE',
    path: '/api/spaces/:id/relations/:relationId',
    paramsSchema: RelationParamsSchema,
    responseSchema: SuccessResponseSchema,
  },
  'GET /api/spaces/:id/compositions': {
    method: 'GET',
    path: '/api/spaces/:id/compositions',
    paramsSchema: SpaceIdParamsSchema,
    responseSchema: ListCompositionsResponseSchema,
  },
  'POST /api/spaces/:id/compositions': {
    method: 'POST',
    path: '/api/spaces/:id/compositions',
    paramsSchema: SpaceIdParamsSchema,
    jsonSchema: UpsertCompositionRequestSchema,
    responseSchema: CompositionResponseSchema,
  },
  'PATCH /api/spaces/:id/compositions/:compositionId': {
    method: 'PATCH',
    path: '/api/spaces/:id/compositions/:compositionId',
    paramsSchema: CompositionIdParamsSchema,
    jsonSchema: UpdateCompositionRequestSchema,
    responseSchema: CompositionResponseSchema,
  },
  'DELETE /api/spaces/:id/compositions/:compositionId': {
    method: 'DELETE',
    path: '/api/spaces/:id/compositions/:compositionId',
    paramsSchema: CompositionIdParamsSchema,
    responseSchema: SuccessResponseSchema,
  },
  'GET /api/spaces/:id/compositions/:compositionId/items': {
    method: 'GET',
    path: '/api/spaces/:id/compositions/:compositionId/items',
    paramsSchema: CompositionIdParamsSchema,
    responseSchema: ListCompositionItemsResponseSchema,
  },
  'POST /api/spaces/:id/compositions/:compositionId/items': {
    method: 'POST',
    path: '/api/spaces/:id/compositions/:compositionId/items',
    paramsSchema: CompositionIdParamsSchema,
    jsonSchema: UpsertCompositionItemRequestSchema,
    responseSchema: CompositionItemResponseSchema,
  },
  'PATCH /api/spaces/:id/compositions/:compositionId/items/:itemId': {
    method: 'PATCH',
    path: '/api/spaces/:id/compositions/:compositionId/items/:itemId',
    paramsSchema: CompositionItemParamsSchema,
    jsonSchema: UpdateCompositionItemRequestSchema,
    responseSchema: CompositionItemResponseSchema,
  },
  'POST /api/spaces/:id/compositions/:compositionId/items/reorder': {
    method: 'POST',
    path: '/api/spaces/:id/compositions/:compositionId/items/reorder',
    paramsSchema: CompositionIdParamsSchema,
    jsonSchema: ReorderItemsRequestSchema,
    responseSchema: ListCompositionItemsResponseSchema,
  },
  'DELETE /api/spaces/:id/compositions/:compositionId/items/:itemId': {
    method: 'DELETE',
    path: '/api/spaces/:id/compositions/:compositionId/items/:itemId',
    paramsSchema: CompositionItemParamsSchema,
    responseSchema: SuccessResponseSchema,
  },
  'GET /api/spaces/:id/usage/summary': {
    method: 'GET',
    path: '/api/spaces/:id/usage/summary',
    paramsSchema: SpaceIdParamsSchema,
    querySchema: UsageSummaryQuerySchema,
    responseSchema: PlatformUsageSummaryResponseSchema,
  },
  'GET /api/billing/status': {
    method: 'GET',
    path: '/api/billing/status',
    responseSchema: BillingStatusResponseSchema,
  },
  'GET /api/billing/usage': {
    method: 'GET',
    path: '/api/billing/usage',
    responseSchema: BillingUsageResponseSchema,
  },
  'GET /api/billing/checkout': {
    method: 'GET',
    path: '/api/billing/checkout',
    querySchema: BillingUrlQuerySchema,
    responseSchema: BillingUrlResponseSchema,
  },
  'GET /api/billing/portal': {
    method: 'GET',
    path: '/api/billing/portal',
    querySchema: BillingUrlQuerySchema,
    responseSchema: BillingUrlResponseSchema,
  },
  'GET /api/billing/spend/summary': {
    method: 'GET',
    path: '/api/billing/spend/summary',
    querySchema: ProviderSpendSummaryQuerySchema,
    responseSchema: ProviderSpendSummaryResponseSchema,
  },
  'GET /api/spaces/:id/productions': {
    method: 'GET',
    path: '/api/spaces/:id/productions',
    paramsSchema: SpaceIdParamsSchema,
    responseSchema: ListProductionsResponseSchema,
  },
  'POST /api/spaces/:id/productions': {
    method: 'POST',
    path: '/api/spaces/:id/productions',
    paramsSchema: SpaceIdParamsSchema,
    jsonSchema: UpsertProductionRequestSchema,
    responseSchema: ProductionResponseSchema,
  },
  'GET /api/spaces/:id/productions/:productionId': {
    method: 'GET',
    path: '/api/spaces/:id/productions/:productionId',
    paramsSchema: ProductionIdParamsSchema,
    responseSchema: ProductionDetailResponseSchema,
  },
  'DELETE /api/spaces/:id/productions/:productionId': {
    method: 'DELETE',
    path: '/api/spaces/:id/productions/:productionId',
    paramsSchema: ProductionIdParamsSchema,
    responseSchema: SuccessResponseSchema,
  },
  'POST /api/spaces/:id/productions/:productionId/shots': {
    method: 'POST',
    path: '/api/spaces/:id/productions/:productionId/shots',
    paramsSchema: ProductionIdParamsSchema,
    jsonSchema: UpsertProductionShotRequestSchema,
    responseSchema: ProductionShotResponseSchema,
  },
  'DELETE /api/spaces/:id/productions/:productionId/shots/:childId': {
    method: 'DELETE',
    path: '/api/spaces/:id/productions/:productionId/shots/:childId',
    paramsSchema: ProductionChildParamsSchema,
    responseSchema: SuccessResponseSchema,
  },
  'POST /api/spaces/:id/productions/:productionId/cues': {
    method: 'POST',
    path: '/api/spaces/:id/productions/:productionId/cues',
    paramsSchema: ProductionIdParamsSchema,
    jsonSchema: UpsertProductionCueRequestSchema,
    responseSchema: ProductionCueResponseSchema,
  },
  'DELETE /api/spaces/:id/productions/:productionId/cues/:childId': {
    method: 'DELETE',
    path: '/api/spaces/:id/productions/:productionId/cues/:childId',
    paramsSchema: ProductionChildParamsSchema,
    responseSchema: SuccessResponseSchema,
  },
  'POST /api/spaces/:id/productions/:productionId/placements': {
    method: 'POST',
    path: '/api/spaces/:id/productions/:productionId/placements',
    paramsSchema: ProductionIdParamsSchema,
    jsonSchema: UpsertProductionPlacementRequestSchema,
    responseSchema: ProductionPlacementResponseSchema,
  },
  'DELETE /api/spaces/:id/productions/:productionId/placements/:childId': {
    method: 'DELETE',
    path: '/api/spaces/:id/productions/:productionId/placements/:childId',
    paramsSchema: ProductionChildParamsSchema,
    responseSchema: SuccessResponseSchema,
  },
  'GET /api/spaces/:id/productions/:productionId/records': {
    method: 'GET',
    path: '/api/spaces/:id/productions/:productionId/records',
    paramsSchema: ProductionIdParamsSchema,
    responseSchema: ListProductionRecordsResponseSchema,
  },
  'POST /api/spaces/:id/production/placements': {
    method: 'POST',
    path: '/api/spaces/:id/production/placements',
    paramsSchema: SpaceIdParamsSchema,
    jsonSchema: PlaceProductionRecordRequestSchema,
    responseSchema: ProductionRecordResponseSchema,
  },
  'DELETE /api/spaces/:id/production/records/:recordId': {
    method: 'DELETE',
    path: '/api/spaces/:id/production/records/:recordId',
    paramsSchema: ProductionRecordParamsSchema,
    responseSchema: SuccessResponseSchema,
  },
  'DELETE /api/spaces/:id': {
    method: 'DELETE',
    path: '/api/spaces/:id',
    paramsSchema: SpaceIdParamsSchema,
    responseSchema: DeleteSpaceResponseSchema,
  },
  'POST /api/spaces/:id/upload': {
    method: 'POST',
    path: '/api/spaces/:id/upload',
    paramsSchema: SpaceIdParamsSchema,
    formSchema: UploadMediaRequestSchema,
    responseSchema: UploadMediaResponseSchema,
  },
  'GET /api/spaces/:spaceId/variants/:variantId/media': {
    method: 'GET',
    path: '/api/spaces/:spaceId/variants/:variantId/media',
    paramsSchema: VariantMediaParamsSchema,
    responseType: 'response',
    successStatuses: [200, 206, 304],
  },
  'GET /api/spaces/:spaceId/variants/:variantId/poster': {
    method: 'GET',
    path: '/api/spaces/:spaceId/variants/:variantId/poster',
    paramsSchema: VariantMediaParamsSchema,
    responseType: 'response',
    successStatuses: [200, 304],
  },
} as const;

export type ApiEndpointKey = keyof typeof apiEndpoints;
type Endpoint<K extends ApiEndpointKey> = (typeof apiEndpoints)[K];
type ParamsOf<K extends ApiEndpointKey> =
  Endpoint<K> extends { paramsSchema: infer S extends z.ZodType }
    ? z.input<S>
    : never;
type JsonOf<K extends ApiEndpointKey> =
  Endpoint<K> extends { jsonSchema: infer S extends z.ZodType }
    ? z.input<S>
    : never;
type JsonOption<K extends ApiEndpointKey> =
  JsonOf<K> extends never
    ? { json?: never }
    : undefined extends JsonOf<K>
    ? { json?: Exclude<JsonOf<K>, undefined> | undefined }
    : { json: JsonOf<K> };
type QueryOf<K extends ApiEndpointKey> =
  Endpoint<K> extends { querySchema: infer S extends z.ZodType }
    ? z.input<S>
    : never;
type FormOf<K extends ApiEndpointKey> =
  Endpoint<K> extends { formSchema: infer S extends z.ZodType }
    ? z.input<S>
    : never;
type ResponseOf<K extends ApiEndpointKey> =
  Endpoint<K> extends { responseType: 'response' }
    ? Response
    : Endpoint<K> extends { responseSchema: infer S extends z.ZodType }
    ? z.output<S>
    : never;
type NeedsOptions<K extends ApiEndpointKey> =
  Endpoint<K> extends { paramsSchema: z.ZodType } | { querySchema: z.ZodType } | { jsonSchema: z.ZodType } | { formSchema: z.ZodType }
    ? true
    : false;

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ApiFetchOptions<K extends ApiEndpointKey> =
  Omit<RequestInit, 'body' | 'method'> & {
    baseUrl?: string;
    fetch?: FetchLike;
  } & (ParamsOf<K> extends never ? { params?: never } : { params: ParamsOf<K> })
    & (QueryOf<K> extends never ? { query?: never } : { query?: QueryOf<K> })
    & JsonOption<K>
    & (FormOf<K> extends never ? { form?: never } : { form: FormOf<K> });

export class ApiFetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: unknown,
    readonly response: Response,
  ) {
    super(message);
    this.name = 'ApiFetchError';
  }
}

function buildPath(path: string, params: Record<string, unknown> | undefined): string {
  if (!params) {
    return path;
  }

  return path.replace(/:([A-Za-z0-9_]+)/g, (_match, key: string) => {
    const value = params[key];
    if (value === undefined || value === null) {
      throw new Error(`Missing path parameter: ${key}`);
    }
    return encodeURIComponent(String(value));
  });
}

function resolveUrl(path: string, baseUrl: string | undefined): string {
  if (baseUrl) {
    return new URL(path, baseUrl).toString();
  }
  return path;
}

function appendQuery(path: string, query: Record<string, unknown> | undefined): string {
  if (!query) {
    return path;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  if (!search) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${search}`;
}

function buildFormData(form: Record<string, unknown>): FormData {
  const formData = new FormData();

  for (const [key, value] of Object.entries(form)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) {
          formData.append(key, item instanceof Blob ? item : String(item));
        }
      }
      continue;
    }
    formData.append(key, value instanceof Blob ? value : String(value));
  }

  return formData;
}

function isSuccessfulResponse<K extends ApiEndpointKey>(
  endpoint: Endpoint<K>,
  response: Response,
): boolean {
  if ('successStatuses' in endpoint) {
    return (endpoint.successStatuses as readonly number[]).includes(response.status);
  }
  return response.ok;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function apiFetch<K extends ApiEndpointKey>(
  key: K,
  ...args: NeedsOptions<K> extends true
    ? [options: ApiFetchOptions<K>]
    : [options?: ApiFetchOptions<K>]
): Promise<ResponseOf<K>> {
  const endpoint = apiEndpoints[key];
  const options = (args[0] ?? {}) as ApiFetchOptions<K>;
  const fetchImpl = options.fetch ?? fetch;
  const params =
    'paramsSchema' in endpoint
      ? endpoint.paramsSchema.parse(options.params)
      : undefined;
  const json =
    'jsonSchema' in endpoint
      ? endpoint.jsonSchema.parse(options.json)
      : undefined;
  const query =
    'querySchema' in endpoint
      ? endpoint.querySchema.parse(options.query ?? {})
      : undefined;
  const form =
    'formSchema' in endpoint
      ? endpoint.formSchema.parse(options.form)
      : undefined;
  const path = appendQuery(buildPath(endpoint.path, params as Record<string, unknown> | undefined), query as Record<string, unknown> | undefined);
  const headers = new Headers(options.headers);
  const init: RequestInit = {
    ...options,
    method: endpoint.method,
    headers,
    credentials: options.credentials ?? 'include',
  };

  delete (init as { baseUrl?: string }).baseUrl;
  delete (init as { fetch?: FetchLike }).fetch;
  delete (init as { params?: unknown }).params;
  delete (init as { query?: unknown }).query;
  delete (init as { json?: unknown }).json;
  delete (init as { form?: unknown }).form;

  if (json !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(json);
  }
  if (form !== undefined) {
    init.body = buildFormData(form as Record<string, unknown>);
  }

  const response = await fetchImpl(resolveUrl(path, options.baseUrl), init);

  if ('responseType' in endpoint && endpoint.responseType === 'response' && isSuccessfulResponse(endpoint, response)) {
    return response as ResponseOf<K>;
  }

  const data = await readJson(response);

  if (!isSuccessfulResponse(endpoint, response)) {
    const parsedError = ErrorResponseSchema.safeParse(data);
    const message = parsedError.success ? parsedError.data.error : response.statusText;
    throw new ApiFetchError(message, response.status, data, response);
  }

  if ('responseSchema' in endpoint) {
    return endpoint.responseSchema.parse(data) as ResponseOf<K>;
  }

  return data as ResponseOf<K>;
}
