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
 * - State: sync state for clients
 */

import { Hono } from 'hono';
import type {
  Lineage,
  MediaKind,
  Variant,
  PendingApproval,
  AutoExecuted,
  UserSession,
  SpaceCollection,
  CollectionItem,
  StylePresetPreview,
  StyleReferenceCollectionPreview,
} from './types';
import type { ParentHierarchyBackfillResult } from './repository/SpaceRepository';
import { ConflictError, NotFoundError, ValidationError } from './controllers/types';
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
      mediaKind?: MediaKind;
      createdBy: string;
    }): Promise<unknown>;
    httpGetDetails(assetId: string): Promise<unknown>;
    httpFork(data: {
      sourceVariantId: string;
      name: string;
      type: string;
      mediaKind?: MediaKind;
      createdBy: string;
    }): Promise<unknown>;
    httpSetActive(assetId: string, variantId: string): Promise<unknown>;
  };
  variant: {
    httpApplyVariant(data: {
      jobId: string | null;
      variantId: string;
      assetId: string;
      imageKey: string;
      thumbKey: string;
      mediaKey?: string | null;
      mediaMimeType?: string | null;
      mediaSizeBytes?: number | null;
      mediaWidth?: number | null;
      mediaHeight?: number | null;
      mediaDurationMs?: number | null;
      transcriptKey?: string | null;
      transcriptMimeType?: string | null;
      transcriptSizeBytes?: number | null;
      wordTimingsKey?: string | null;
      wordTimingsMimeType?: string | null;
      wordTimingsSizeBytes?: number | null;
      renderMetadataKey?: string | null;
      renderMetadataMimeType?: string | null;
      renderMetadataSizeBytes?: number | null;
      recipe: string;
      createdBy: string;
      mediaKind?: MediaKind;
      parentVariantIds?: string[];
      relationType?: 'derived' | 'refined';
      generationProvenance?: Record<string, unknown> | string | null;
      providerMetadata?: Record<string, unknown> | string | null;
    }): Promise<{ created: boolean; variant: Variant }>;
    httpGetById(variantId: string): Promise<Variant & { asset_name?: string }>;
    httpStar(variantId: string, starred: boolean): Promise<unknown>;
    // Upload placeholder flow (3-step: create placeholder → upload to R2 → complete/fail)
    httpCreateUploadPlaceholder(data: {
      variantId: string;
      assetId?: string;
      assetName?: string;
      assetType?: string;
      mediaKind?: MediaKind;
      recipe: string;
      createdBy: string;
    }): Promise<{ variant: Variant; asset?: unknown; assetId: string }>;
    httpCompleteUpload(data: {
      variantId: string;
      imageKey: string | null;
      thumbKey: string | null;
      mediaKey?: string | null;
      mediaMimeType?: string | null;
      mediaSizeBytes?: number | null;
      mediaWidth?: number | null;
      mediaHeight?: number | null;
      mediaDurationMs?: number | null;
      transcriptKey?: string | null;
      transcriptMimeType?: string | null;
      transcriptSizeBytes?: number | null;
      wordTimingsKey?: string | null;
      wordTimingsMimeType?: string | null;
      wordTimingsSizeBytes?: number | null;
      renderMetadataKey?: string | null;
      renderMetadataMimeType?: string | null;
      renderMetadataSizeBytes?: number | null;
      providerMetadata?: Record<string, unknown> | string | null;
      activeVariantBehavior?: 'if_missing' | 'set_active' | 'keep';
      lineage?: Array<{
        parentVariantId: string;
        relationType: 'derived' | 'refined' | 'forked';
      }>;
    }): Promise<{ variant: Variant; lineage?: Lineage[] }>;
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
      severed?: boolean;
    }): Promise<unknown>;
    httpSever(lineageId: string): Promise<void>;
  };
  sync: {
    httpGetState(): Promise<unknown>;
  };
  generation: {
    // Variant lifecycle (GenerationWorkflow)
    httpUpdateVariantStatus(data: {
      variantId: string;
      status: string;
    }): Promise<{ success: boolean }>;
    httpCompleteVariant(data: {
      variantId: string;
      imageKey?: string | null;
      thumbKey?: string | null;
      mediaKey?: string | null;
      mediaMimeType?: string | null;
      mediaSizeBytes?: number | null;
      mediaWidth?: number | null;
      mediaHeight?: number | null;
      mediaDurationMs?: number | null;
      transcriptKey?: string | null;
      transcriptMimeType?: string | null;
      transcriptSizeBytes?: number | null;
      wordTimingsKey?: string | null;
      wordTimingsMimeType?: string | null;
      wordTimingsSizeBytes?: number | null;
      renderMetadataKey?: string | null;
      renderMetadataMimeType?: string | null;
      renderMetadataSizeBytes?: number | null;
      providerMetadata?: Record<string, unknown> | string | null;
      requestId?: string | null;
      audioProvider?: string | null;
      audioModel?: string | null;
      audioUsage?: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
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
  organization: {
    httpListCollections(): Promise<SpaceCollection[]>;
    httpCreateCollection(data: unknown): Promise<SpaceCollection>;
    httpUpdateCollection(collectionId: string, data: unknown): Promise<SpaceCollection>;
    httpDeleteCollection(collectionId: string): Promise<void>;
    httpListCollectionItems(collectionId: string): Promise<CollectionItem[]>;
    httpCreateCollectionItem(collectionId: string, data: unknown): Promise<CollectionItem>;
    httpUpdateCollectionItem(collectionId: string, itemId: string, data: unknown): Promise<CollectionItem>;
    httpReorderCollectionItems(collectionId: string, itemIds: unknown): Promise<CollectionItem[]>;
    httpDeleteCollectionItem(collectionId: string, itemId: string): Promise<void>;
    httpBackfillParentHierarchy(data?: unknown): Promise<ParentHierarchyBackfillResult>;
  };
  stylePreset: {
    httpListStyleReferenceCollections(): Promise<StyleReferenceCollectionPreview[]>;
    httpListStylePresets(): Promise<StylePresetPreview[]>;
    httpCreateStylePreset(data: unknown): Promise<StylePresetPreview>;
    httpUpdateStylePreset(presetId: string, data: unknown): Promise<StylePresetPreview>;
    httpDeleteStylePreset(presetId: string): Promise<void>;
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
    if (err instanceof ConflictError) {
      return c.json({ error: err.message, code: 'DEFAULT_STYLE_PRESET_CONFLICT' }, 409);
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

  app.get('/internal/variant/:variantId', async (c) => {
    const variantId = c.req.param('variantId');
    const variant = await controllers.variant.httpGetById(variantId);
    return c.json(variant);
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
      mediaKind?: MediaKind;
      recipe: string;
      createdBy: string;
    };
    const result = await controllers.variant.httpCreateUploadPlaceholder(data);
    return c.json(result);
  });

  app.post('/internal/complete-upload', async (c) => {
    const data = (await c.req.json()) as {
      variantId: string;
      imageKey: string | null;
      thumbKey: string | null;
      mediaKey?: string | null;
      mediaMimeType?: string | null;
      mediaSizeBytes?: number | null;
      mediaWidth?: number | null;
      mediaHeight?: number | null;
      mediaDurationMs?: number | null;
      transcriptKey?: string | null;
      transcriptMimeType?: string | null;
      transcriptSizeBytes?: number | null;
      wordTimingsKey?: string | null;
      wordTimingsMimeType?: string | null;
      wordTimingsSizeBytes?: number | null;
      renderMetadataKey?: string | null;
      renderMetadataMimeType?: string | null;
      renderMetadataSizeBytes?: number | null;
      providerMetadata?: Record<string, unknown> | string | null;
      activeVariantBehavior?: 'if_missing' | 'set_active' | 'keep';
      lineage?: Array<{
        parentVariantId: string;
        relationType: 'derived' | 'refined' | 'forked';
      }>;
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
      imageKey?: string | null;
      thumbKey?: string | null;
      mediaKey?: string | null;
      mediaMimeType?: string | null;
      mediaSizeBytes?: number | null;
      mediaWidth?: number | null;
      mediaHeight?: number | null;
      mediaDurationMs?: number | null;
      transcriptKey?: string | null;
      transcriptMimeType?: string | null;
      transcriptSizeBytes?: number | null;
      wordTimingsKey?: string | null;
      wordTimingsMimeType?: string | null;
      wordTimingsSizeBytes?: number | null;
      renderMetadataKey?: string | null;
      renderMetadataMimeType?: string | null;
      renderMetadataSizeBytes?: number | null;
      providerMetadata?: Record<string, unknown> | string | null;
      requestId?: string | null;
      audioProvider?: string | null;
      audioModel?: string | null;
      audioUsage?: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
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
  // Organization Routes
  // ==========================================================================

  app.post('/internal/backfill-parent-hierarchy', async (c) => {
    const data = parseOptionalJsonObject(await c.req.text(), 'backfill options');
    const result = await controllers.organization.httpBackfillParentHierarchy(data);
    return c.json({ success: true, result });
  });

  app.get('/internal/collections', async (c) => {
    const collections = await controllers.organization.httpListCollections();
    return c.json({ success: true, collections });
  });

  app.post('/internal/collections', async (c) => {
    const collection = await controllers.organization.httpCreateCollection(await c.req.json());
    return c.json({ success: true, collection });
  });

  app.patch('/internal/collections/:collectionId', async (c) => {
    const collection = await controllers.organization.httpUpdateCollection(
      c.req.param('collectionId'),
      await c.req.json()
    );
    return c.json({ success: true, collection });
  });

  app.delete('/internal/collections/:collectionId', async (c) => {
    await controllers.organization.httpDeleteCollection(c.req.param('collectionId'));
    return c.json({ success: true });
  });

  app.get('/internal/collections/:collectionId/items', async (c) => {
    const items = await controllers.organization.httpListCollectionItems(c.req.param('collectionId'));
    return c.json({ success: true, items });
  });

  app.post('/internal/collections/:collectionId/items', async (c) => {
    const item = await controllers.organization.httpCreateCollectionItem(
      c.req.param('collectionId'),
      await c.req.json()
    );
    return c.json({ success: true, item });
  });

  app.patch('/internal/collections/:collectionId/items/:itemId', async (c) => {
    const item = await controllers.organization.httpUpdateCollectionItem(
      c.req.param('collectionId'),
      c.req.param('itemId'),
      await c.req.json()
    );
    return c.json({ success: true, item });
  });

  app.post('/internal/collections/:collectionId/items/reorder', async (c) => {
    const data = (await c.req.json()) as { itemIds?: unknown };
    const items = await controllers.organization.httpReorderCollectionItems(
      c.req.param('collectionId'),
      data.itemIds
    );
    return c.json({ success: true, items });
  });

  app.delete('/internal/collections/:collectionId/items/:itemId', async (c) => {
    await controllers.organization.httpDeleteCollectionItem(
      c.req.param('collectionId'),
      c.req.param('itemId')
    );
    return c.json({ success: true });
  });

  // ==========================================================================
  // Style Preset Routes
  // ==========================================================================

  app.get('/internal/style-reference-collections', async (c) => {
    const collections = await controllers.stylePreset.httpListStyleReferenceCollections();
    return c.json({ success: true, collections });
  });

  app.get('/internal/style-presets', async (c) => {
    const presets = await controllers.stylePreset.httpListStylePresets();
    return c.json({ success: true, presets });
  });

  app.post('/internal/style-presets', async (c) => {
    const preset = await controllers.stylePreset.httpCreateStylePreset(await c.req.json());
    return c.json({ success: true, preset });
  });

  app.patch('/internal/style-presets/:presetId', async (c) => {
    const preset = await controllers.stylePreset.httpUpdateStylePreset(
      c.req.param('presetId'),
      await c.req.json()
    );
    return c.json({ success: true, preset });
  });

  app.delete('/internal/style-presets/:presetId', async (c) => {
    await controllers.stylePreset.httpDeleteStylePreset(c.req.param('presetId'));
    return c.json({ success: true });
  });

  return app;
}

function parseOptionalJsonObject(rawBody: string, label: string): unknown {
  if (rawBody.trim() === '') return {};
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new ValidationError(`${label} must be valid JSON`);
  }
}
