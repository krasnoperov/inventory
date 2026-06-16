import { useMemo } from 'react';
import { useLocation } from '@tanstack/react-router';
import { navigate } from '../navigation/navigator';

/**
 * Hook to access URL search params
 */
export function useSearchParams(): [URLSearchParams, (params: URLSearchParams) => void] {
  const location = useLocation();
  const search = location.searchStr;

  const searchParams = useMemo(
    () => new URLSearchParams(search),
    [search]
  );

  // For now, setSearchParams updates the URL directly
  // In the future, this could be enhanced to work with the navigation system
  const setSearchParams = (params: URLSearchParams) => {
    const newSearch = params.toString();
    const pathname = typeof window !== 'undefined' ? window.location.pathname : location.pathname;
    const newUrl = `${pathname}${newSearch ? `?${newSearch}` : ''}`;
    navigate(newUrl);
  };

  return [searchParams, setSearchParams];
}

export default useSearchParams;
