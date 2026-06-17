import ReactDOMServer from 'react-dom/server';
import { RouterProvider } from '@tanstack/react-router';
import { createRequestHandler } from '@tanstack/react-router/ssr/server';
import { getRouter } from './router';
import { StartSessionProvider, type StartSession } from './startSession';
import type { FetchLike } from '../api/client';

type SsrRouter = ReturnType<typeof getRouter>;

async function preloadMatchedRouteComponents(router: SsrRouter): Promise<void> {
  const routesById = router.routesById as unknown as Record<string, { options?: { component?: { preload?: () => Promise<void> } } }>;
  const preloaders = router.state.matches
    .map((match) => routesById[match.routeId]?.options?.component?.preload)
    .filter((preload): preload is () => Promise<void> => typeof preload === 'function');

  await Promise.all(preloaders.map((preload) => preload()));
}

export async function renderTanStackStartRoute(
  request: Request,
  session: StartSession,
  serverFetch?: FetchLike,
): Promise<{ html: string; status: number; headers: Record<string, string> }> {
  const handler = createRequestHandler({
    createRouter: () => getRouter({ initialSession: session, request, serverFetch }),
    request,
  });

  const response = await handler(async ({ router, responseHeaders }) => {
    await preloadMatchedRouteComponents(router);

    const stream = await ReactDOMServer.renderToReadableStream(
      <StartSessionProvider session={session}>
        <RouterProvider router={router} />
      </StartSessionProvider>,
      { signal: request.signal },
    );
    await stream.allReady;

    let html = await new Response(stream).text();
    router.serverSsr?.setRenderFinished();
    html += router.serverSsr?.takeBufferedHtml() ?? '';

    return new Response(html, {
      status: router.stores.statusCode.get(),
      headers: responseHeaders,
    });
  });

  // Surface response headers (notably Location on a redirect thrown by a route
  // beforeLoad) so the worker can emit a real redirect instead of dropping them.
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    html: await response.text(),
    status: response.status,
    headers,
  };
}
