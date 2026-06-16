import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Bindings } from '../index';
import type { createContainer } from '../../core/container';

export type AppContext = {
  Bindings: Bindings;
  Variables: {
    container: ReturnType<typeof createContainer>;
    userId?: number;
  };
};

export type AppType = OpenAPIHono<AppContext>;
