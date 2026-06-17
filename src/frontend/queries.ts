import { type QueryClient, queryOptions } from '@tanstack/react-query';
import { ApiFetchError, apiFetch, type FetchLike } from '../api/client';
import { loadSession } from './config';
import type { Space, UserProfile } from '../api/types';
import type { Asset, Lineage, Variant } from './hooks/useSpaceWebSocket';
import type { ProductionRecord } from './productionHandoff';
import type { StartSession } from './app-context';

export interface Member {
  user_id: string;
  role: string;
  joined_at: number;
  user: {
    id: number;
    email: string;
    name: string;
  };
}

export interface SpacePageData {
  space: Space;
  members: Member[];
}

export interface AssetDetailsResponse {
  success: boolean;
  asset: Asset;
  variants: Variant[];
  lineage: Lineage[];
}

export const sessionQueryKey = ['start-session'] as const;
export const spacesQueryKey = ['spaces'] as const;
export const userProfileQueryKey = ['user-profile'] as const;

export function clearUserScopedQueries(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: spacesQueryKey });
  queryClient.removeQueries({ queryKey: userProfileQueryKey });
}

export function getCachedSession(
  queryClient: QueryClient,
  fallbackSession?: StartSession,
): StartSession | undefined {
  return queryClient.getQueryData<StartSession>(sessionQueryKey) ?? fallbackSession;
}

function fetchJson<T>(
  path: string,
  baseUrl?: string,
  headers?: HeadersInit,
  fetchImpl?: FetchLike,
  init?: RequestInit,
): Promise<T> {
  return (fetchImpl ?? fetch)(baseUrl ? new URL(path, baseUrl).toString() : path, {
    credentials: 'include',
    headers,
    ...init,
  }).then(async (response) => {
    const data = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const message = typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : response.statusText;
      throw new ApiFetchError(message, response.status, data, response);
    }
    return data as T;
  });
}

function mapSpaceError(error: unknown): Error {
  if (error instanceof ApiFetchError) {
    if (error.status === 403) {
      return new Error('You do not have access to this space');
    }
    if (error.status === 404) {
      return new Error('Space not found');
    }
  }
  return new Error('Failed to fetch space');
}

function mapAssetError(error: unknown): Error {
  if (error instanceof ApiFetchError) {
    if (error.status === 403) {
      return new Error('You do not have access to this asset');
    }
    if (error.status === 404) {
      return new Error('Asset not found');
    }
  }
  return new Error('Failed to fetch asset');
}

export function sessionQueryOptions(initialSession?: StartSession) {
  return queryOptions({
    queryKey: sessionQueryKey,
    queryFn: () => {
      if (initialSession && typeof window === 'undefined') {
        return Promise.resolve(initialSession);
      }
      return loadSession();
    },
    staleTime: 60_000,
  });
}

export function spacesQueryOptions(baseUrl?: string, headers?: HeadersInit, fetchImpl?: FetchLike) {
  return queryOptions({
    queryKey: spacesQueryKey,
    queryFn: () =>
      apiFetch('GET /api/spaces', { baseUrl, headers, fetch: fetchImpl }).then((data) => data.spaces || []),
  });
}

export function spacePageQueryOptions(
  spaceId: string,
  baseUrl?: string,
  headers?: HeadersInit,
  fetchImpl?: FetchLike,
) {
  return queryOptions({
    queryKey: ['spaces', spaceId, 'page'],
    queryFn: async (): Promise<SpacePageData> => {
      const [spaceResult, membersResult] = await Promise.allSettled([
        apiFetch('GET /api/spaces/:id', { params: { id: spaceId }, baseUrl, headers, fetch: fetchImpl }),
        fetchJson<{ success: boolean; members: Member[] }>(
          `/api/spaces/${spaceId}/members`,
          baseUrl,
          headers,
          fetchImpl,
        ),
      ]);

      if (spaceResult.status === 'rejected') {
        throw mapSpaceError(spaceResult.reason);
      }

      return {
        space: spaceResult.value.space,
        members: membersResult.status === 'fulfilled' ? membersResult.value.members || [] : [],
      };
    },
  });
}

export function assetDetailsQueryOptions(
  spaceId: string,
  assetId: string,
  baseUrl?: string,
  headers?: HeadersInit,
  fetchImpl?: FetchLike,
) {
  return queryOptions({
    queryKey: ['spaces', spaceId, 'assets', assetId],
    queryFn: async (): Promise<AssetDetailsResponse> => {
      try {
        const data = await fetchJson<AssetDetailsResponse>(
          `/api/spaces/${spaceId}/assets/${assetId}`,
          baseUrl,
          headers,
          fetchImpl,
        );
        return {
          ...data,
          variants: data.variants || [],
          lineage: data.lineage || [],
        };
      } catch (error) {
        throw mapAssetError(error);
      }
    },
  });
}

export function productionRecordsQueryOptions(
  spaceId: string,
  productionId: string,
  baseUrl?: string,
  headers?: HeadersInit,
) {
  return queryOptions({
    queryKey: ['spaces', spaceId, 'productions', productionId, 'records'],
    queryFn: async (): Promise<ProductionRecord[]> => {
      const data = await apiFetch('GET /api/spaces/:id/productions/:productionId/records', {
        params: { id: spaceId, productionId },
        baseUrl,
        headers,
      });
      return data.records || [];
    },
  });
}

export function userProfileQueryOptions(baseUrl?: string, headers?: HeadersInit, fetchImpl?: FetchLike) {
  return queryOptions({
    queryKey: userProfileQueryKey,
    queryFn: (): Promise<UserProfile> =>
      apiFetch('GET /api/user/profile', { baseUrl, headers, fetch: fetchImpl }),
  });
}
