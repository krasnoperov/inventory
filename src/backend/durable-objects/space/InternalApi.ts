/**
 * Internal API Router
 *
 * Hono-based router for internal HTTP endpoints called by workflows.
 * All routes are prefixed with /internal.
 *
 * Routes:
 * - Asset: CRUD, fork, set-active
 * - Variant: apply, star, status lifecycle (pending → processing → completed/failed)
 * - Lineage: queries, add, sever
 * - Chat: store messages, history, chat-result (for ChatWorkflow)
 * - State: sync state for clients
 */

import { Hono } from 'hono';
import type { Variant, PendingApproval, AutoExecuted, UserSession } from './types';
import type { SimplePlan } from '../../../shared/websocket-types';
import type { ChatWorkflowOutput } from '../../workflows/types';
import { NotFoundError, ValidationError } from './controllers/types';
import { loggers } from '../../../shared/logger';

const log = loggers.internalApi;

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
    httpFork(data: {
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
      relationType?: 'derived' | 'refined';
    }): Promise<{ created: boolean; variant: Variant }>;
    httpStar(variantId: string, starred: boolean): Promise<unknown>;
    // Upload placeholder flow (3-step: create placeholder → upload to R2 → complete/fail)
    httpCreateUploadPlaceholder(data: {
      variantId: string;
      assetId?: string;
      assetName?: string;
      assetType?: string;
      parentAssetId?: string | null;
      recipe: string;
      createdBy: string;
    }): Promise<{ variant: Variant; asset?: unknown; assetId: string }>;
    httpCompleteUpload(data: {
      variantId: string;
      imageKey: string;
      thumbKey: string;
    }): Promise<{ variant: Variant }>;
    httpFailUpload(data: {
      variantId: string;
      error: string;
    }): Promise<{ variant: Variant }>;
  };
  lineage: {
    httpGetLineage(variantId: string): Promise<unknown>;
    httpGetGraph(variantId: string): Promise<unknown>;
    httpAddLineage(data: {
      parentVariantId: string;
      childVariantId: string;
      relationType: 'derived' | 'refined' | 'forked';
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
    // httpGetHistory removed - chat history now via WebSocket
    httpClearHistory(): Promise<void>;
  };
  sync: {
    httpGetState(): Promise<unknown>;
  };
  generation: {
    // Chat workflow
    httpChatResult(result: ChatWorkflowOutput): void;
    // Variant lifecycle (GenerationWorkflow)
    httpUpdateVariantStatus(data: {
      variantId: string;
      status: string;
    }): Promise<{ success: boolean }>;
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
  approval: {
    httpCreateApproval(data: {
      id: string;
      requestId: string;
      planId?: string | null;
      planStepId?: string | null;
      tool: string;
      params: string;
      description: string;
      createdBy: string;
    }): Promise<PendingApproval>;
    httpExecuteApproval(approvalId: string, resultJobId: string): Promise<PendingApproval>;
    httpFailApproval(approvalId: string, errorMessage: string): Promise<PendingApproval>;
    httpGetPending(): Promise<PendingApproval[]>;
    httpGetById(approvalId: string): Promise<PendingApproval | null>;
    httpCreateAutoExecuted(data: {
      id: string;
      requestId: string;
      tool: string;
      params: string;
      result: string;
      success: boolean;
      error?: string;
    }): Promise<AutoExecuted>;
  };
  session: {
    httpGetSession(userId: string): Promise<UserSession | null>;
    httpUpsertSession(data: {
      userId: string;
      viewingAssetId?: string | null;
      viewingVariantId?: string | null;
      forgeContext?: string | null;
    }): Promise<UserSession>;
  };
  plan: {
    httpUpsertPlan(data: {
      sessionId: string;
      content: string;
      createdBy: string;
    }): Promise<SimplePlan>;
    httpGetActivePlan(sessionId: string): Promise<SimplePlan | null>;
    httpArchivePlan(planId: string): Promise<void>;
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
    log.error('Internal server error', { error: err instanceof Error ? err.message : String(err) });
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

  app.post('/internal/fork', async (c) => {
    const data = await c.req.json();
    const result = await controllers.asset.httpFork(data);
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

  // Upload placeholder flow (3-step: create placeholder → upload to R2 → complete/fail)
  app.post('/internal/upload-placeholder', async (c) => {
    const data = (await c.req.json()) as {
      variantId: string;
      assetId?: string;
      assetName?: string;
      assetType?: string;
      parentAssetId?: string | null;
      recipe: string;
      createdBy: string;
    };
    const result = await controllers.variant.httpCreateUploadPlaceholder(data);
    return c.json(result);
  });

  app.post('/internal/complete-upload', async (c) => {
    const data = (await c.req.json()) as {
      variantId: string;
      imageKey: string;
      thumbKey: string;
    };
    const result = await controllers.variant.httpCompleteUpload(data);
    return c.json(result);
  });

  app.post('/internal/fail-upload', async (c) => {
    const data = (await c.req.json()) as {
      variantId: string;
      error: string;
    };
    const result = await controllers.variant.httpFailUpload(data);
    return c.json(result);
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

  // NOTE: GET /internal/chat/history has been removed.
  // Chat history is now fetched via WebSocket chat:history messages.

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
  // Variant Lifecycle Routes (GenerationWorkflow)
  // ==========================================================================

  app.post('/internal/variant/status', async (c) => {
    const data = (await c.req.json()) as {
      variantId: string;
      status: string;
    };
    const result = await controllers.generation.httpUpdateVariantStatus(data);
    return c.json(result);
  });

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
  // Chat Workflow Result Route
  // ==========================================================================

  app.post('/internal/chat-result', async (c) => {
    const result = (await c.req.json()) as ChatWorkflowOutput;
    await controllers.generation.httpChatResult(result);
    return c.json({ success: true });
  });

  // ==========================================================================
  // Approval Routes
  // ==========================================================================

  app.post('/internal/approval', async (c) => {
    const data = await c.req.json();
    const approval = await controllers.approval.httpCreateApproval(data);
    return c.json({ success: true, approval });
  });

  app.get('/internal/approvals/pending', async (c) => {
    const approvals = await controllers.approval.httpGetPending();
    return c.json({ success: true, approvals });
  });

  app.get('/internal/approval/:approvalId', async (c) => {
    const approvalId = c.req.param('approvalId');
    const approval = await controllers.approval.httpGetById(approvalId);
    if (!approval) {
      return c.json({ error: 'Approval not found' }, 404);
    }
    return c.json({ success: true, approval });
  });

  app.post('/internal/approval/:approvalId/execute', async (c) => {
    const approvalId = c.req.param('approvalId');
    const data = (await c.req.json()) as { resultJobId: string };
    const approval = await controllers.approval.httpExecuteApproval(approvalId, data.resultJobId);
    return c.json({ success: true, approval });
  });

  app.post('/internal/approval/:approvalId/fail', async (c) => {
    const approvalId = c.req.param('approvalId');
    const data = (await c.req.json()) as { errorMessage: string };
    const approval = await controllers.approval.httpFailApproval(approvalId, data.errorMessage);
    return c.json({ success: true, approval });
  });

  // Auto-executed (safe tools that run without approval)
  app.post('/internal/auto-executed', async (c) => {
    const data = await c.req.json();
    const autoExecuted = await controllers.approval.httpCreateAutoExecuted(data);
    return c.json({ success: true, autoExecuted });
  });

  // ==========================================================================
  // Session Routes
  // ==========================================================================

  app.get('/internal/session/:userId', async (c) => {
    const userId = c.req.param('userId');
    const session = await controllers.session.httpGetSession(userId);
    return c.json({ success: true, session });
  });

  app.post('/internal/session', async (c) => {
    const data = await c.req.json();
    const session = await controllers.session.httpUpsertSession(data);
    return c.json({ success: true, session });
  });

  // ==========================================================================
  // Plan Routes (SimplePlan - markdown-based)
  // ==========================================================================

  app.post('/internal/plan', async (c) => {
    const data = (await c.req.json()) as {
      sessionId: string;
      content: string;
      createdBy: string;
    };
    const plan = await controllers.plan.httpUpsertPlan(data);
    return c.json({ success: true, plan });
  });

  app.get('/internal/plan/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId');
    const plan = await controllers.plan.httpGetActivePlan(sessionId);
    return c.json({ success: true, plan });
  });

  app.delete('/internal/plan/:planId', async (c) => {
    const planId = c.req.param('planId');
    await controllers.plan.httpArchivePlan(planId);
    return c.json({ success: true });
  });

  return app;
}
