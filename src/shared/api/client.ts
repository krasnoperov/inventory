import { z } from '@hono/zod-openapi';
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
  ListProductionRecordsResponseSchema,
  ListProductionsResponseSchema,
  ListSpacesResponseSchema,
  PlaceProductionRecordRequestSchema,
  ProductionChildParamsSchema,
  ProductionCueResponseSchema,
  ProductionDetailResponseSchema,
  ProductionIdParamsSchema,
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
  'GET /api/spaces/:id/assets': {
    method: 'GET',
    path: '/api/spaces/:id/assets',
    paramsSchema: SpaceIdParamsSchema,
    responseSchema: ListSpaceAssetsResponseSchema,
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
  'POST /api/spaces/:id/style-images': {
    method: 'POST',
    path: '/api/spaces/:id/style-images',
    paramsSchema: SpaceIdParamsSchema,
    formSchema: UploadStyleImageRequestSchema,
    responseSchema: UploadStyleImageResponseSchema,
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
  Endpoint<K> extends { paramsSchema: z.ZodType } | { jsonSchema: z.ZodType } | { formSchema: z.ZodType }
    ? true
    : false;

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ApiFetchOptions<K extends ApiEndpointKey> =
  Omit<RequestInit, 'body' | 'method'> & {
    baseUrl?: string;
    fetch?: FetchLike;
  } & (ParamsOf<K> extends never ? { params?: never } : { params: ParamsOf<K> })
    & (JsonOf<K> extends never ? { json?: never } : { json: JsonOf<K> })
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
  const form =
    'formSchema' in endpoint
      ? endpoint.formSchema.parse(options.form)
      : undefined;
  const path = buildPath(endpoint.path, params as Record<string, unknown> | undefined);
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
