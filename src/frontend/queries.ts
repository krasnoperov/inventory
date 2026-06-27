import { type QueryClient, queryOptions } from '@tanstack/react-query';
import { ApiFetchError, apiFetch, type FetchLike } from '../api/client';
import { loadSession } from './config';
import type { SpaceAccessRole, SpaceSharingResponse } from '../shared/api/schemas';
import type { ProviderSpendSummaryResponse, Space, UserProfile } from '../api/types';
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
export const providerKeysQueryKey = ['provider-keys'] as const;
export const spaceSharingQueryKey = (spaceId: string) => ['spaces', spaceId, 'sharing'] as const;

export interface AdminSpendFilters {
  from?: string;
  to?: string;
  userId?: string;
  spaceId?: string;
  provider?: string;
  mediaKind?: 'image' | 'audio' | 'video';
}

export function clearUserScopedQueries(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: spacesQueryKey });
  queryClient.removeQueries({ queryKey: userProfileQueryKey });
  queryClient.removeQueries({ queryKey: providerKeysQueryKey });
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

export function spaceSharingQueryOptions(
  spaceId: string,
  baseUrl?: string,
  headers?: HeadersInit,
  fetchImpl?: FetchLike,
) {
  return queryOptions({
    queryKey: spaceSharingQueryKey(spaceId),
    queryFn: (): Promise<SpaceSharingResponse> =>
      apiFetch('GET /api/spaces/:id/sharing', {
        params: { id: spaceId },
        baseUrl,
        headers,
        fetch: fetchImpl,
      }),
  });
}

export function inviteSpaceEmail(spaceId: string, email: string, role: SpaceAccessRole) {
  return apiFetch('POST /api/spaces/:id/invitations', {
    params: { id: spaceId },
    json: { email, role },
  });
}

export function approveSpaceAccessRequest(spaceId: string, requestId: string, role: SpaceAccessRole) {
  return apiFetch('POST /api/spaces/:id/access-requests/:requestId/approve', {
    params: { id: spaceId, requestId },
    json: { role },
  });
}

export function rejectSpaceAccessRequest(spaceId: string, requestId: string) {
  return apiFetch('POST /api/spaces/:id/access-requests/:requestId/reject', {
    params: { id: spaceId, requestId },
  });
}

export function revokeSpaceInvitation(spaceId: string, invitationId: string) {
  return apiFetch('POST /api/spaces/:id/invitations/:invitationId/revoke', {
    params: { id: spaceId, invitationId },
  });
}

export function updateSpaceMemberRole(spaceId: string, userId: string, role: SpaceAccessRole) {
  return fetchJson<{ success: boolean }>(`/api/spaces/${spaceId}/members/${userId}`, undefined, {
    'Content-Type': 'application/json',
  }, undefined, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

export function revokeSpaceMember(spaceId: string, userId: string) {
  return fetchJson<{ success: boolean }>(`/api/spaces/${spaceId}/members/${userId}`, undefined, undefined, undefined, {
    method: 'DELETE',
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

export function providerKeysQueryOptions(baseUrl?: string, headers?: HeadersInit, fetchImpl?: FetchLike) {
  return queryOptions({
    queryKey: providerKeysQueryKey,
    queryFn: () =>
      apiFetch('GET /api/user/provider-keys', { baseUrl, headers, fetch: fetchImpl }).then((data) => data.providers),
  });
}

export function adminSpendQueryOptions(
  filters: AdminSpendFilters,
  baseUrl?: string,
  headers?: HeadersInit,
  fetchImpl?: FetchLike,
) {
  return queryOptions({
    queryKey: ['admin', 'spend', filters],
    queryFn: (): Promise<ProviderSpendSummaryResponse> =>
      apiFetch('GET /api/billing/spend/summary', {
        baseUrl,
        headers,
        fetch: fetchImpl,
        query: {
          from: filters.from,
          to: filters.to,
          user_id: filters.userId,
          space_id: filters.spaceId,
          provider: filters.provider,
          media_kind: filters.mediaKind,
        },
      }),
    retry: false,
  });
}
