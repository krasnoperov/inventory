import { create } from 'zustand';
import { subscribeToNavigation, initNavigator } from '../navigation/navigator';
import { matchSpaRoute, type RoutePage, type RouteParams } from '../spaRoutes';

interface RouteState {
  path: string;
  search: string;
  page: RoutePage;
  params: RouteParams;
  setLocation: (path: string, search: string) => void;
}

const shallowEqualParams = (a: RouteParams, b: RouteParams): boolean => {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
};

const initialPath = typeof window !== 'undefined' ? window.location.pathname : '/';
const initialSearch = typeof window !== 'undefined' ? window.location.search : '';
const initialRoute = matchSpaRoute(initialPath);

export const useRouteStore = create<RouteState>()((set, get) => ({
  path: initialPath,
  search: initialSearch,
  page: initialRoute.page,
  params: initialRoute.params,
  setLocation: (path, search) => {
    const next = matchSpaRoute(path);
    const state = get();
    if (
      state.path === path &&
      state.search === search &&
      state.page === next.page &&
      shallowEqualParams(state.params, next.params)
    ) {
      return;
    }

    set({
      path,
      search,
      page: next.page,
      params: next.params,
    });
  },
}));

// Initialize navigation system and connect to store
if (typeof window !== 'undefined') {
  initNavigator();

  // Subscribe to navigation events and update store
  subscribeToNavigation((url) => {
    useRouteStore.getState().setLocation(url.pathname, url.search);
  });
}
