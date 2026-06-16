import { StrictMode, startTransition } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { RouterClient } from '@tanstack/react-router/ssr/client';
import App from './App';
import { setNavigationBridge } from './navigation/navigator';
import { getRouter } from './router';
import { getBrowserStartSession, StartSessionProvider } from './startSession';
import './styles/global.css';

const root = document.getElementById('root') as HTMLElement;

if (document.documentElement.dataset.inventorySsr === 'tanstack-start') {
  const session = getBrowserStartSession();

  if (!session) {
    createRoot(root).render(<App />);
  } else {
    const router = getRouter();
    setNavigationBridge((url, options) => router.navigate({
      href: `${url.pathname}${url.search}${url.hash}`,
      replace: options?.replace,
    }));

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
  }
} else {
  createRoot(root).render(<App />);
}
