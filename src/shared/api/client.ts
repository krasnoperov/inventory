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
  ListSpacesResponseSchema,
  SpaceIdParamsSchema,
  SuccessResponseSchema,
  UpdateUserProfileRequestSchema,
  UpdateUserSettingsRequestSchema,
  UserProfileSchema,
  UserProfileUpdateResponseSchema,
  UserSettingsResponseSchema,
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
  'DELETE /api/spaces/:id': {
    method: 'DELETE',
    path: '/api/spaces/:id',
    paramsSchema: SpaceIdParamsSchema,
    responseSchema: DeleteSpaceResponseSchema,
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
type ResponseOf<K extends ApiEndpointKey> =
  Endpoint<K> extends { responseSchema: infer S extends z.ZodType }
    ? z.output<S>
    : never;
type NeedsOptions<K extends ApiEndpointKey> =
  Endpoint<K> extends { paramsSchema: z.ZodType } | { jsonSchema: z.ZodType }
    ? true
    : false;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ApiFetchOptions<K extends ApiEndpointKey> =
  Omit<RequestInit, 'body' | 'method'> & {
    baseUrl?: string;
    fetch?: FetchLike;
  } & (ParamsOf<K> extends never ? { params?: never } : { params: ParamsOf<K> })
    & (JsonOf<K> extends never ? { json?: never } : { json: JsonOf<K> });

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

  if (json !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(json);
  }

  const response = await fetchImpl(resolveUrl(path, options.baseUrl), init);
  const data = await readJson(response);

  if (!response.ok) {
    const parsedError = ErrorResponseSchema.safeParse(data);
    const message = parsedError.success ? parsedError.data.error : response.statusText;
    throw new ApiFetchError(message, response.status, data, response);
  }

  return endpoint.responseSchema.parse(data) as ResponseOf<K>;
}
