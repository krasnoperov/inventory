import { useParams as useTanStackParams } from '@tanstack/react-router';

/**
 * Hook to access route params
 */
export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T {
  const params = useTanStackParams({ strict: false }) as Record<string, string | undefined>;

  if (params.id && params.assetId) {
    return {
      ...params,
      spaceId: params.id,
    } as unknown as T;
  }

  return params as unknown as T;
}

export default useParams;
