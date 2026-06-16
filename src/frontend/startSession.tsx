import { createContext, useContext, type ReactNode } from 'react';
import type { User } from './contexts/AuthContext';

export interface StartSession {
  config: {
    googleClientId: string;
    environment?: string;
  };
  user: User | null;
}

declare global {
  interface Window {
    __INVENTORY_START_SESSION__?: StartSession;
  }
}

const StartSessionContext = createContext<StartSession | undefined>(undefined);

export function StartSessionProvider({
  children,
  session,
}: {
  children: ReactNode;
  session: StartSession;
}) {
  return (
    <StartSessionContext.Provider value={session}>
      {children}
    </StartSessionContext.Provider>
  );
}

export function useStartSession() {
  return useContext(StartSessionContext);
}

export function getBrowserStartSession(): StartSession | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return window.__INVENTORY_START_SESSION__;
}
