import assert from 'node:assert/strict';
import test from 'node:test';
import type { StaticDataRouteOption } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import { SPA_ROUTES, type SpaRouteMeta } from './spaRoutes';

interface RouteTreeNode {
  options?: {
    staticData?: StaticDataRouteOption;
  };
  children?: Record<string, RouteTreeNode>;
}

const collectRouteMetas = (route: RouteTreeNode): SpaRouteMeta[] => {
  const meta = route.options?.staticData?.meta;
  const children = Object.values(route.children ?? {}).flatMap(collectRouteMetas);

  return meta ? [meta, ...children] : children;
};

test('generated TanStack file routes expose the current SPA route metadata', () => {
  const metasByPage = new Map(
    collectRouteMetas(routeTree as RouteTreeNode).map((meta) => [meta.page, meta]),
  );

  assert.equal(metasByPage.size, Object.keys(SPA_ROUTES).length);

  for (const expectedMeta of Object.values(SPA_ROUTES)) {
    assert.deepStrictEqual(metasByPage.get(expectedMeta.page), expectedMeta);
  }
});
