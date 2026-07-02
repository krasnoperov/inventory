/**
 * Central route registration file
 * Organizes all API routes into logical groups
 */
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Handler } from 'hono';
import type { AppContext } from './types';

// Import route modules
import { healthRoutes } from './health';
import { oauthRoutes } from './oauth';
import { authRoutes } from './auth';
import { userRoutes } from './user';
import { spaceRoutes } from './space';
import { memberRoutes } from './member';
import { sharingRoutes } from './sharing';
import { jobRoutes } from './job';
import { imageRoutes } from './image';
import { memoryRoutes } from './memory';
import { websocketRoutes } from './websocket';
import { exportRoutes } from './export';
import { billingRoutes } from './billing';
import { webhookRoutes } from './webhooks';
import { uploadRoutes } from './upload';
import { voicesRoutes } from './voices';
import { renderStartApp } from '../frontend-start-ssr';

/**
 * Register all routes with the main app
 */
export function registerRoutes(
  app: OpenAPIHono<AppContext>,
  documentHandler: Handler<AppContext> = (c) => renderStartApp(c),
) {
  // Health check routes
  app.route('/', healthRoutes);

  // OAuth/OpenID Connect routes
  app.route('/', oauthRoutes);

  // Authentication routes
  app.route('/', authRoutes);

  // User profile routes
  app.route('/', userRoutes);

  // Space management routes (Phase 1)
  app.route('/', spaceRoutes);
  app.route('/', memberRoutes);
  app.route('/', sharingRoutes);

  // Generation job routes (Phase 2)
  app.route('/', jobRoutes);

  // Image serving routes
  app.route('/', imageRoutes);

  // Memory & personalization routes (Phase 2)
  app.route('/', memoryRoutes);

  // WebSocket routes (Phase 3: Durable Object)
  app.route('/', websocketRoutes);

  // Export/Import routes
  app.route('/', exportRoutes);

  // Billing routes (Polar.sh integration)
  app.route('/', billingRoutes);

  // Webhook routes (Polar.sh, etc.)
  app.route('/', webhookRoutes);

  // Upload routes (image upload to create variants)
  app.route('/', uploadRoutes);

  // Voice listing routes (ElevenLabs audio provider)
  app.route('/', voicesRoutes);

  app.doc('/api/openapi.json', {
    openapi: '3.0.0',
    info: {
      version: '0.0.0',
      title: 'Make Effects API',
    },
  });

  // Catch-all: document navigations are SSR-rendered through TanStack Router;
  // static asset requests are delegated to the ASSETS binding unchanged.
  // Requires wrangler's run_worker_first = ["/*"] so the worker sees all
  // traffic — API routes above still match first because they're registered
  // earlier on the Hono app.
  app.all('*', documentHandler);
}
