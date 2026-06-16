import { StrictMode, startTransition } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { RouterClient } from '@tanstack/react-router/ssr/client';
import { setNavigationBridge } from './navigation/navigator';
import { getRouter } from './router';
import { getBrowserStartSession, StartSessionProvider } from './startSession';
import './styles/theme.css';
import './styles/global.css';

const root = document.getElementById('root') as HTMLElement;
const session = getBrowserStartSession();
const router = getRouter({ initialSession: session });

setNavigationBridge((url, options) => router.navigate({
  href: `${url.pathname}${url.search}${url.hash}`,
  replace: options?.replace,
}));

if (document.documentElement.dataset.inventorySsr === 'tanstack-router' && session) {
  startTransition(() => {
    hydrateRoot(
      root,
      <StrictMode>
        <StartSessionProvider session={session}>
          <RouterClient router={router} />
        </StartSessionProvider>
      </StrictMode>,
    );
  });
} else {
  createRoot(root).render(
    <StrictMode>
      <RouterClient router={router} />
    </StrictMode>,
  );
}
