// Unified Worker: Frontend + API + Scheduled (for local dev)
// In stage/production, workflows are handled by the separate processing worker
// But for local development, everything runs in one worker for simplicity

import 'reflect-metadata';
import { app, handleScheduled } from '../backend/index';

// Export unified worker with all capabilities (used in local dev)
// In stage/production deployments, this worker only handles HTTP (see wrangler.toml)
export default {
  // HTTP handler - Hono app handles ALL requests
  // API routes return responses, static files fall through to Assets via notFound handler
  // Assets binding serves files or returns 404
  fetch: app.fetch,

  // Scheduled handler - syncs usage events to Polar (cron trigger)
  scheduled: handleScheduled,
};

// Export Durable Objects
export { SpaceDO } from '../backend/durable-objects/SpaceDO';

// Export Workflow classes (used in local dev; in stage/prod only processing worker uses these)
export { ChatWorkflow } from '../backend/workflows/ChatWorkflow';
export { GenerationWorkflow } from '../backend/workflows/GenerationWorkflow';