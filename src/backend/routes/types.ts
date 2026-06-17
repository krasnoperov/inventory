import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Bindings } from '../index';
import type { createContainer } from '../../core/container';
import type { FetchLike } from '../../shared/api/client';

export type AppContext = {
  Bindings: Bindings;
  Variables: {
    container: ReturnType<typeof createContainer>;
    userId?: number;
    // In-process dispatcher to this same worker, used by SSR route loaders so
    // they don't issue a self-origin subrequest (which fails under
    // run_worker_first). Set by the root middleware in src/backend/index.ts.
    serverFetch?: FetchLike;
  };
};

export type AppType = OpenAPIHono<AppContext>;
