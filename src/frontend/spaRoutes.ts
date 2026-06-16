import type { StaticDataRouteOption } from '@tanstack/react-router';

export const SPA_ROUTES = {
  landing: {
    page: 'landing',
    path: '/',
    params: [],
  },
  login: {
    page: 'login',
    path: '/login',
    params: [],
  },
  profile: {
    page: 'profile',
    path: '/profile',
    params: [],
  },
  oauthApprove: {
    page: 'oauthApprove',
    path: '/oauth/approve',
    params: [],
  },
  dashboard: {
    page: 'dashboard',
    path: '/dashboard',
    params: [],
  },
  space: {
    page: 'space',
    path: '/spaces/$id',
    params: ['id'],
  },
  asset: {
    page: 'asset',
    path: '/spaces/$id/assets/$assetId',
    params: ['spaceId', 'assetId'],
  },
  unknown: {
    page: 'unknown',
    path: '*',
    params: [],
  },
} as const;

export type SpaRouteKey = keyof typeof SPA_ROUTES;
export type SpaRouteMeta = (typeof SPA_ROUTES)[SpaRouteKey];
export type RoutePage = SpaRouteMeta['page'];

export interface RouteParams {
  [key: string]: string | undefined;
}

export interface MatchedSpaRoute {
  page: RoutePage;
  params: RouteParams;
}

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    meta?: SpaRouteMeta;
  }
}

export const spaRouteStaticData = (meta: SpaRouteMeta): StaticDataRouteOption => ({
  meta,
});

export const matchSpaRoute = (path: string): MatchedSpaRoute => {
  if (path === '/' || path === '') {
    return { page: SPA_ROUTES.landing.page, params: {} };
  }

  if (path === '/login') {
    return { page: SPA_ROUTES.login.page, params: {} };
  }

  if (path === '/profile') {
    return { page: SPA_ROUTES.profile.page, params: {} };
  }

  if (path === '/oauth/approve') {
    return { page: SPA_ROUTES.oauthApprove.page, params: {} };
  }

  if (path === '/dashboard') {
    return { page: SPA_ROUTES.dashboard.page, params: {} };
  }

  const assetMatch = path.match(/^\/spaces\/([^/]+)\/assets\/([^/]+)$/);
  if (assetMatch) {
    return {
      page: SPA_ROUTES.asset.page,
      params: { spaceId: assetMatch[1], assetId: assetMatch[2] },
    };
  }

  const spaceMatch = path.match(/^\/spaces\/([^/]+)$/);
  if (spaceMatch) {
    return { page: SPA_ROUTES.space.page, params: { id: spaceMatch[1] } };
  }

  return { page: SPA_ROUTES.unknown.page, params: {} };
};
