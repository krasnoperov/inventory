import { StrictMode, startTransition } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { RouterClient } from '@tanstack/react-router/ssr/client';
import App from './App';
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
