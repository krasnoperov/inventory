import { useEffect, type ReactNode } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouter,
} from '@tanstack/react-router';
import { AuthProvider } from '../contexts/AuthContext';
import { setNavigationBridge } from '../navigation/navigator';
import { sessionQueryOptions } from '../queries';
import type { StartRouterContext, StartServerContext, StartSession } from '../app-context';
import '../styles/theme.css';
import '../styles/global.css';

const DESCRIPTION =
  'Make Effects helps agents and creative teams generate images, video, and audio with variants, prompt history, lineage, and production-ready media handoff.';
const SOCIAL_DESCRIPTION =
  'AI media production for agents and teams: generate images, video, and audio from the web app or makefx CLI.';

function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="theme-color" content="#7c5cff" />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

export const Route = createRootRouteWithContext<StartRouterContext>()({
  head: () => ({
    meta: [
      { title: 'Make Effects' },
      { name: 'description', content: DESCRIPTION },
      { property: 'og:site_name', content: 'Make Effects' },
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: 'Make Effects' },
      { property: 'og:description', content: SOCIAL_DESCRIPTION },
      { property: 'og:url', content: 'https://makefx.app/' },
      { name: 'twitter:card', content: 'summary' },
      { name: 'twitter:title', content: 'Make Effects' },
      { name: 'twitter:description', content: SOCIAL_DESCRIPTION },
    ],
    links: [
      { rel: 'alternate', type: 'text/plain', title: 'LLM overview', href: '/llms.txt' },
    ],
  }),
  beforeLoad: async (opts) => {
    const { context } = opts;
    // TanStack Start injects the per-request context as a top-level `serverContext`
    // param (a sibling of `context`, via router additionalContext), not nested in
    // `context`. It's absent from react-router's core types, so read it via a cast.
    const serverContext = (opts as { serverContext?: StartServerContext }).serverContext;

    // Seed the session query from the server bootstrap during SSR so loaders
    // don't self-fetch the worker origin; on the client it resolves from the
    // dehydrated cache (or a relative fetch on a cold client navigation). Only
    // the (secret-free) session is returned into context — the cookie and the
    // apiFetch function stay server-only and are read per-loader via ssrFetchArgs.
    const session = await context.queryClient.ensureQueryData(
      sessionQueryOptions(serverContext?.bootstrap?.session),
    );

    return { session };
  },
  component: RootComponent,
});

function RootComponent() {
  const { session } = Route.useRouteContext();

  return (
    <Document>
      <StartProviders session={session}>
        <Outlet />
      </StartProviders>
    </Document>
  );
}

// Bridge the app's custom navigator (Link/useNavigate/useSearchParams) to the
// router's client navigation. Runs after mount; the navigator falls back to the
// History API until it's wired, so first paint is unaffected.
function NavigationBridge() {
  const router = useRouter();
  useEffect(() => {
    setNavigationBridge((url, options) =>
      router.navigate({
        href: `${url.pathname}${url.search}${url.hash}`,
        replace: options?.replace,
      }),
    );
    return () => setNavigationBridge(undefined);
  }, [router]);
  return null;
}

function StartProviders({ children, session }: { children: ReactNode; session: StartSession }) {
  const clientId = session.config.googleClientId;
  const initialUser = session.user;

  if (!clientId) {
    return (
      <AuthProvider initialUser={initialUser}>
        <NavigationBridge />
        <div style={{ color: 'white', textAlign: 'center', padding: '2rem' }}>
          Google OAuth not configured. Please contact administrator.
        </div>
      </AuthProvider>
    );
  }

  return (
    <GoogleOAuthProvider clientId={clientId}>
      <AuthProvider initialUser={initialUser}>
        <NavigationBridge />
        {children}
      </AuthProvider>
    </GoogleOAuthProvider>
  );
}
