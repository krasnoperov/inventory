// Unified Worker: Frontend + API + Queue + Scheduled (for local dev)
// In stage/production, queue processing and workflows are handled by the separate processing worker
// But for local development, everything runs in one worker for simplicity

import 'reflect-metadata';
import { app, handleQueue, handleScheduled } from '../backend/index';

// Export unified worker with all capabilities (used in local dev)
// In stage/production deployments, this worker only handles HTTP (see wrangler.toml)
export default {
  // HTTP handler - Hono app handles ALL requests
  // API routes return responses, static files fall through to Assets via notFound handler
  // Assets binding serves files or returns 404
  fetch: app.fetch,

  // Queue consumer handler (only used in local dev)
  queue: handleQueue,

  // Scheduled handler - syncs usage events to Polar (cron trigger)
  scheduled: handleScheduled,
};

// --- FUTURE: Export your Workflow classes here (only used in local dev) ---
// Example:
// export { MyWorkflow } from '../backend/workflows/MyWorkflow';

// Export Durable Objects
export { SpaceDO } from '../backend/durable-objects/SpaceDO';