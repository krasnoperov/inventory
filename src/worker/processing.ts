// Processing Worker: Workflows + Workflow Status API
// This worker handles all background processing

import 'reflect-metadata';
import { Hono } from 'hono';
import type { Env } from '../core/types';

// Simple Hono app for health checks and future workflow status endpoints
const app = new Hono<{ Bindings: Env }>();

// Workflow status endpoint - check generation workflow status
app.get('/api/workflow/generation/:instanceId', async (c) => {
  const { instanceId } = c.req.param();
  try {
    if (!c.env.GENERATION_WORKFLOW) {
      return c.json({ error: 'GENERATION_WORKFLOW not configured' }, 500);
    }
    const instance = await c.env.GENERATION_WORKFLOW.get(instanceId);
    const status = await instance.status();
    return c.json({ instanceId, type: 'generation', status });
  } catch (error) {
    console.error('Error fetching generation workflow status:', error);
    return c.json({
      error: 'Failed to fetch workflow status',
      instanceId,
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// Health check endpoint
app.get('/api/health', (c) => {
  console.log('[Processing Worker] Health check request received');
  return c.json({ status: 'ok', worker: 'processing' });
});

// Export processing worker
export default {
  // HTTP handler for health checks and workflow status
  fetch: app.fetch,
};

// Export Workflow classes
export { GenerationWorkflow } from '../backend/workflows/GenerationWorkflow';
