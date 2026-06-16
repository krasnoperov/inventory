import { useMemo } from 'react';
import { navigate } from '../navigation/navigator';
import { useRouteSearch } from '../routeLocation';

/**
 * Hook to access URL search params
 * Replacement for React Router's useSearchParams
 */
export function useSearchParams(): [URLSearchParams, (params: URLSearchParams) => void] {
  const search = useRouteSearch();

  const searchParams = useMemo(
    () => new URLSearchParams(search),
    [search]
  );

  // For now, setSearchParams updates the URL directly
  // In the future, this could be enhanced to work with the navigation system
  const setSearchParams = (params: URLSearchParams) => {
    const newSearch = params.toString();
    const newUrl = `${window.location.pathname}${newSearch ? `?${newSearch}` : ''}`;
    navigate(newUrl);
  };

  return [searchParams, setSearchParams];
}

export default useSearchParams;
