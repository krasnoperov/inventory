/**
 * Central route registration file
 * Organizes all API routes into logical groups
 */
import type { Hono } from 'hono';
import type { AppContext } from './types';

// Import route modules
import { healthRoutes } from './health';
import { oauthRoutes } from './oauth';
import { authRoutes } from './auth';
import { userRoutes } from './user';
import { spaceRoutes } from './space';
import { memberRoutes } from './member';
import { jobRoutes } from './job';
import { imageRoutes } from './image';
import { memoryRoutes } from './memory';
import { websocketRoutes } from './websocket';
import { exportRoutes } from './export';
import { billingRoutes } from './billing';
import { webhookRoutes } from './webhooks';
import { uploadRoutes } from './upload';
import { trainingExportRoutes } from './training-export';

/**
 * Register all routes with the main app
 */
export function registerRoutes(app: Hono<AppContext>) {
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

  // Training data export routes
  app.route('/', trainingExportRoutes);

  // --- Domain routes will be added per ARCHITECTURE.md ---
}
