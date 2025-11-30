import type { Hono } from 'hono';
import type { Bindings } from '../index';
import type { createContainer } from '../../core/container';
import type { UploadSecurity } from '../middleware/upload-security';

export type AppContext = {
  Bindings: Bindings;
  Variables: {
    container: ReturnType<typeof createContainer>;
    uploadSecurity?: UploadSecurity;
    userId?: number;
  };
};

export type AppType = Hono<AppContext>;