import { useMemo, type ReactNode } from 'react';
import type { GlobalProvider } from '@ladle/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '../src/frontend/queryClient';

// Global token + reset stylesheets, exactly as the app loads them in
// src/frontend/routes/__root.tsx. Without these the components render with no
// design tokens defined.
import '../src/frontend/styles/theme.css';
import '../src/frontend/styles/global.css';

/**
 * Wraps every story. Provides a QueryClient (wave-1 components don't query, but
 * future stories will) and paints a themed canvas using the design tokens so
 * each component sits on the real app background instead of bare white.
 */
export const Provider: GlobalProvider = ({ children }) => {
  const queryClient = useMemo(() => createQueryClient(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <div
        data-style-reference-root
        style={{
          minWidth: 'min(100%, 32rem)',
          minHeight: '100vh',
          padding: '24px',
          color: 'var(--color-text)',
          background: 'var(--color-bg)',
        }}
      >
        {children as ReactNode}
      </div>
    </QueryClientProvider>
  );
};
