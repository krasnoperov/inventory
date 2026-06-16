import { lazy, Suspense, type ComponentType } from 'react';

export const lazyPage = (loadPage: () => Promise<{ default: ComponentType }>) => {
  let loadPromise: Promise<{ default: ComponentType }> | undefined;
  const load = () => {
    loadPromise ??= loadPage();
    return loadPromise;
  };
  const Page = lazy(load);

  function LazyRoutePage() {
    return (
      <Suspense fallback={null}>
        <Page />
      </Suspense>
    );
  }

  LazyRoutePage.preload = () => load().then(() => undefined);

  return LazyRoutePage;
};
