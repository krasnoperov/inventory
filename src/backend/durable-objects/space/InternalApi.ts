/**
 * Internal API Router
 *
 * Hono-based router for internal HTTP endpoints called by workflows.
 * Extracts ~150 lines of routing logic from SpaceDO for cleaner separation.
 *
 * All routes are prefixed with /internal and handle:
 * - Asset CRUD operations
 * - Variant operations
 * - Lineage queries
 * - Chat history
 * - Job status updates
 * - Workflow results
 */

import { Hono } from 'hono';
import type { Variant } from './types';
import type { ChatWorkflowOutput, GenerationWorkflowOutput } from '../../workflows/types';
import { NotFoundError, ValidationError } from './controllers/types';

// ============================================================================
// Controller Interface
// ============================================================================

/**
 * Controller dependencies required by InternalApi.
 * SpaceDO passes these after initialization.
 */
export interface InternalApiControllers {
  asset: {
    httpCreate(data: {
      id?: string;
      name: string;
      type: string;
      parentAssetId?: string;
      createdBy: string;
    }): Promise<unknown>;
    httpGetDetails(assetId: string): Promise<unknown>;
    httpGetChildren(assetId: string): Promise<unknown>;
    httpGetAncestors(assetId: string): Promise<unknown>;
    httpReparent(assetId: string, parentAssetId: string | null): Promise<unknown>;
    httpSpawn(data: {
      sourceVariantId: string;
      name: string;
      type: string;
      parentAssetId?: string;
      createdBy: string;
    }): Promise<unknown>;
    httpSetActive(assetId: string, variantId: string): Promise<unknown>;
  };
  variant: {
    httpApplyVariant(data: {
      jobId: string;
      variantId: string;
      assetId: string;
      imageKey: string;
      thumbKey: string;
      recipe: string;
      createdBy: string;
      parentVariantIds?: string[];
      relationType?: 'derived' | 'composed';
    }): Promise<{ created: boolean; variant: Variant }>;
    httpStar(variantId: string, starred: boolean): Promise<unknown>;
  };
  lineage: {
    httpGetLineage(variantId: string): Promise<unknown>;
    httpGetGraph(variantId: string): Promise<unknown>;
    httpAddLineage(data: {
      parentVariantId: string;
      childVariantId: string;
      relationType: 'derived' | 'composed' | 'spawned';
    }): Promise<unknown>;
    httpSever(lineageId: string): Promise<void>;
  };
  chat: {
    httpStoreMessage(data: {
      senderType: 'user' | 'bot';
      senderId: string;
      content: string;
      metadata?: string | null;
    }): Promise<unknown>;
    httpGetHistory(): Promise<unknown>;
    httpClearHistory(): Promise<void>;
  };
  sync: {
    httpGetState(): Promise<unknown>;
  };
  generation: {
    httpJobProgress(jobId: string, status: string): void;
    httpJobCompleted(jobId: string, variant: Variant): void;
    httpJobFailed(jobId: string, error: string): void;
    httpChatResult(result: ChatWorkflowOutput): void;
    httpGenerationResult(result: GenerationWorkflowOutput): void;
    httpCompleteVariant(data: {
      variantId: string;
      imageKey: string;
      thumbKey: string;
    }): Promise<{ success: boolean; variant: Variant }>;
    httpFailVariant(data: {
      variantId: string;
      error: string;
    }): Promise<{ success: boolean; variant: Variant }>;
  };
}

// ============================================================================
// Hono App Factory
// ============================================================================

/**
 * Creates a Hono app with all internal routes.
 * Controllers are injected to avoid circular dependencies.
 */
export function createInternalApi(controllers: InternalApiControllers): Hono {
  const app = new Hono();

  // Error handling middleware
  app.onError((err, c) => {
    if (err instanceof NotFoundError) {
      return c.json({ error: err.message }, 404);
    }
    if (err instanceof ValidationError) {
      return c.json({ error: err.message }, 400);
    }
    console.error('[InternalApi] Error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  // ==========================================================================
  // Asset Routes
  // ==========================================================================

  app.post('/internal/create-asset', async (c) => {
    const data = await c.req.json();
    const asset = await controllers.asset.httpCreate(data);
    return c.json({ success: true, asset });
  });

  app.get('/internal/asset/:assetId', async (c) => {
    const assetId = c.req.param('assetId');
    const result = await controllers.asset.httpGetDetails(assetId);
    return c.json({ success: true, ...(result as object) });
  });

  app.get('/internal/asset/:assetId/children', async (c) => {
    const assetId = c.req.param('assetId');
    const children = await controllers.asset.httpGetChildren(assetId);
    return c.json({ success: true, children });
  });

  app.get('/internal/asset/:assetId/ancestors', async (c) => {
    const assetId = c.req.param('assetId');
    const ancestors = await controllers.asset.httpGetAncestors(assetId);
    return c.json({ success: true, ancestors });
  });

  app.patch('/internal/asset/:assetId/parent', async (c) => {
    const assetId = c.req.param('assetId');
    const data = (await c.req.json()) as { parentAssetId: string | null };
    const asset = await controllers.asset.httpReparent(assetId, data.parentAssetId);
    return c.json({ success: true, asset });
  });

  app.post('/internal/spawn', async (c) => {
    const data = await c.req.json();
    const result = await controllers.asset.httpSpawn(data);
    return c.json({ success: true, ...(result as object) });
  });

  app.post('/internal/set-active', async (c) => {
    const data = (await c.req.json()) as { assetId: string; variantId: string };
    await controllers.asset.httpSetActive(data.assetId, data.variantId);
    return c.json({ success: true });
  });

  // ==========================================================================
  // Variant Routes
  // ==========================================================================

  app.post('/internal/apply-variant', async (c) => {
    const data = await c.req.json();
    const result = await controllers.variant.httpApplyVariant(data);
    return c.json(result);
  });

  app.patch('/internal/variant/:variantId/star', async (c) => {
    const variantId = c.req.param('variantId');
    const data = (await c.req.json()) as { starred: boolean };
    const variant = await controllers.variant.httpStar(variantId, data.starred);
    return c.json({ success: true, variant });
  });

  // ==========================================================================
  // Lineage Routes
  // ==========================================================================

  app.get('/internal/lineage/:variantId', async (c) => {
    const variantId = c.req.param('variantId');
    const result = await controllers.lineage.httpGetLineage(variantId);
    return c.json({ success: true, ...(result as object) });
  });

  app.get('/internal/lineage/:variantId/graph', async (c) => {
    const variantId = c.req.param('variantId');
    const graph = await controllers.lineage.httpGetGraph(variantId);
    return c.json({ success: true, ...(graph as object) });
  });

  app.post('/internal/add-lineage', async (c) => {
    const data = await c.req.json();
    const lineage = await controllers.lineage.httpAddLineage(data);
    return c.json({ success: true, id: (lineage as { id: string }).id });
  });

  app.patch('/internal/lineage/:lineageId/sever', async (c) => {
    const lineageId = c.req.param('lineageId');
    await controllers.lineage.httpSever(lineageId);
    return c.json({ success: true });
  });

  // ==========================================================================
  // Chat Routes
  // ==========================================================================

  app.post('/internal/chat', async (c) => {
    const data = await c.req.json();
    const message = await controllers.chat.httpStoreMessage(data);
    return c.json({ success: true, message });
  });

  app.get('/internal/chat/history', async (c) => {
    const messages = await controllers.chat.httpGetHistory();
    return c.json({ success: true, messages });
  });

  app.delete('/internal/chat/history', async (c) => {
    await controllers.chat.httpClearHistory();
    return c.json({ success: true });
  });

  // ==========================================================================
  // State Route
  // ==========================================================================

  app.get('/internal/state', async (c) => {
    const state = await controllers.sync.httpGetState();
    return c.json(state);
  });

  // ==========================================================================
  // Job Status Routes
  // ==========================================================================

  app.post('/internal/job/progress', async (c) => {
    const data = (await c.req.json()) as { jobId: string; status: string };
    controllers.generation.httpJobProgress(data.jobId, data.status);
    return c.json({ success: true });
  });

  app.post('/internal/job/completed', async (c) => {
    const data = (await c.req.json()) as { jobId: string; variant: Variant };
    controllers.generation.httpJobCompleted(data.jobId, data.variant);
    return c.json({ success: true });
  });

  app.post('/internal/job/failed', async (c) => {
    const data = (await c.req.json()) as { jobId: string; error: string };
    controllers.generation.httpJobFailed(data.jobId, data.error);
    return c.json({ success: true });
  });

  // ==========================================================================
  // Variant Lifecycle Routes (new flow)
  // ==========================================================================

  app.post('/internal/complete-variant', async (c) => {
    const data = (await c.req.json()) as {
      variantId: string;
      imageKey: string;
      thumbKey: string;
    };
    const result = await controllers.generation.httpCompleteVariant(data);
    return c.json(result);
  });

  app.post('/internal/fail-variant', async (c) => {
    const data = (await c.req.json()) as {
      variantId: string;
      error: string;
    };
    const result = await controllers.generation.httpFailVariant(data);
    return c.json(result);
  });

  // ==========================================================================
  // Workflow Result Routes (deprecated - use variant lifecycle routes)
  // ==========================================================================

  app.post('/internal/chat-result', async (c) => {
    const result = (await c.req.json()) as ChatWorkflowOutput;
    controllers.generation.httpChatResult(result);
    return c.json({ success: true });
  });

  app.post('/internal/generation-result', async (c) => {
    const result = (await c.req.json()) as GenerationWorkflowOutput;
    controllers.generation.httpGenerationResult(result);
    return c.json({ success: true });
  });

  return app;
}
