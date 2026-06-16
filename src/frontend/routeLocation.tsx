import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { matchSpaRoute, type RoutePage, type RouteParams } from './spaRoutes';
import { useRouteStore } from './stores/routeStore';

interface RouteLocation {
  path: string;
  search: string;
  page: RoutePage;
  params: RouteParams;
}

const RouteLocationContext = createContext<RouteLocation | undefined>(undefined);

export function RouteLocationProvider({
  children,
  path,
  search,
}: {
  children: ReactNode;
  path: string;
  search: string;
}) {
  const location = useMemo<RouteLocation>(() => {
    const matched = matchSpaRoute(path);
    return {
      path,
      search,
      page: matched.page,
      params: matched.params,
    };
  }, [path, search]);

  return (
    <RouteLocationContext.Provider value={location}>
      {children}
    </RouteLocationContext.Provider>
  );
}

export function useRoutePage(): RoutePage {
  const location = useContext(RouteLocationContext);
  const storePage = useRouteStore((state) => state.page);
  return location?.page ?? storePage;
}

export function useRouteParams(): RouteParams {
  const location = useContext(RouteLocationContext);
  const storeParams = useRouteStore((state) => state.params);
  return location?.params ?? storeParams;
}

export function useRouteSearch(): string {
  const location = useContext(RouteLocationContext);
  const storeSearch = useRouteStore((state) => state.search);
  return location?.search ?? storeSearch;
}
