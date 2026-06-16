import ReactDOMServer from 'react-dom/server';
import { RouterProvider } from '@tanstack/react-router';
import { createRequestHandler } from '@tanstack/react-router/ssr/server';
import { getRouter } from './router';
import { StartSessionProvider, type StartSession } from './startSession';

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
): Promise<{ html: string; status: number }> {
  const handler = createRequestHandler({
    createRouter: () => getRouter({ initialSession: session, request }),
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

  return {
    html: await response.text(),
    status: response.status,
  };
}
