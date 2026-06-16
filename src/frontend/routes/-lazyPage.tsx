import { lazy, Suspense, type ComponentType } from 'react';

export const lazyPage = (loadPage: () => Promise<{ default: ComponentType }>) => {
  const Page = lazy(loadPage);

  return function LazyRoutePage() {
    return (
      <Suspense fallback={null}>
        <Page />
      </Suspense>
    );
  };
};
