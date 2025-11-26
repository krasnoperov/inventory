import { Hono } from 'hono';
import type { Env } from '../core/types';
import { createContainer } from '../core/container';
import { registerRoutes } from './routes';
import { uploadSecurityMiddleware } from './middleware/upload-security';
import type { AppContext } from './routes/types';
import { handleGenerationQueue } from './services/generationConsumer';

export type Bindings = Env;

const app = new Hono<AppContext>();

// Middleware to set up container
app.use('*', async (c, next) => {
  const container = createContainer(c.env);
  c.set('container', container);
  await next();
});

// Apply upload security middleware to upload routes
app.use('/api/upload/*', uploadSecurityMiddleware());

// Register all routes
registerRoutes(app);

// Queue handler - delegates to generation consumer
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleQueue(batch: MessageBatch<any>, env: Env): Promise<void> {
  await handleGenerationQueue(batch, env);
}

// No custom notFound handler needed!
// With not_found_handling = "single-page-application" in wrangler.toml:
// - API routes that match will return their responses
// - Unmatched routes fall through to Assets middleware
// - Assets serves the file if it exists, or index.html for SPA routing

// Export as default for standalone use
export default {
  fetch: app.fetch,
  queue: handleQueue,
};

// Also export the app and handleQueue for the unified worker
export { app, handleQueue };