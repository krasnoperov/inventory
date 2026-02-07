import type { Hono } from 'hono';
import type { Bindings } from '../index';
import type { createContainer } from '../../core/container';

export type AppContext = {
  Bindings: Bindings;
  Variables: {
    container: ReturnType<typeof createContainer>;
    userId?: number;
  };
};

export type AppType = Hono<AppContext>;