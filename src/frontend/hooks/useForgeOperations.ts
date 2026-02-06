/**
 * useForgeOperations - Shared hook for asset generation operations
 *
 * Centralizes all forge operations (generate, refine, combine) for both
 * SpacePage and AssetDetailPage. Works at the asset level - backend
 * resolves asset IDs to default variants.
 *
 * All operations use WebSocket for real-time communication with the backend.
 * The backend triggers Cloudflare Workflows for async processing.
 */

import { useCallback } from 'react';
import type { ForgeSubmitParams } from '../components/ForgeTray';
import type { GenerateRequestParams, RefineRequestParams, ForkParams, BatchRequestParams } from './useSpaceWebSocket';

export interface UseForgeOperationsParams {
  /** WebSocket function to send generate requests */
  sendGenerateRequest: (params: GenerateRequestParams) => string;
  /** WebSocket function to send refine requests */
  sendRefineRequest: (params: RefineRequestParams) => string;
  /** WebSocket function to fork an asset - creates 'forked' lineage */
  forkAsset?: (params: ForkParams) => void;
  /** WebSocket function to send batch requests */
  sendBatchRequest?: (params: BatchRequestParams) => string;
}

export interface UseForgeOperationsReturn {
  /** Submit a forge operation (generate, fork, derive, refine) */
  handleForgeSubmit: (params: ForgeSubmitParams) => string;

  /** Generate: Create new asset from prompt only (no references) */
  onGenerate: (params: {
    name: string;
    type: string;
    prompt: string;
    parentAssetId?: string;
  }) => string;

  /** Fork: Copy asset to new asset without AI generation */
  onFork: (params: {
    sourceAssetId: string;
    name: string;
    type: string;
    parentAssetId?: string;
  }) => void;

  /** Derive: Create new asset using one or more references as inspiration */
  onDerive: (params: {
    name: string;
    type: string;
    prompt: string;
    referenceAssetIds: string[];
    parentAssetId?: string;
  }) => string;

  /** Refine: Add variant to existing asset */
  onRefine: (params: {
    assetId: string;
    prompt: string;
  }) => string;
}

export function useForgeOperations({
  sendGenerateRequest,
  sendRefineRequest,
  forkAsset,
  sendBatchRequest,
}: UseForgeOperationsParams): UseForgeOperationsReturn {

  /**
   * Submit a forge operation via WebSocket.
   *
   * Supports two reference modes (backend resolves appropriately):
   * - referenceAssetIds: Asset-level refs (from Chat/Claude) - backend resolves to default variants
   * - referenceVariantIds: Explicit variant refs (from ForgeTray UI) - used as-is
   *
   * Fork operations use forkAsset to create 'forked' lineage.
   * Returns requestId for tracking the operation (or empty string for fork).
   */
  const handleForgeSubmit = useCallback((params: ForgeSubmitParams): string => {
    const { prompt, referenceVariantIds = [], referenceAssetIds, destination, operation, batchCount, batchMode, disableStyle } = params;
    const hasVariantRefs = referenceVariantIds.length > 0;
    const hasAssetRefs = referenceAssetIds && referenceAssetIds.length > 0;

    // Fork operation: use forkAsset to create 'forked' lineage
    if (operation === 'fork' && hasVariantRefs && forkAsset) {
      forkAsset({
        sourceVariantId: referenceVariantIds[0],
        name: destination.assetName || 'Forked Asset',
        assetType: destination.assetType || 'character',
        parentAssetId: destination.parentAssetId || undefined,
      });
      return ''; // forkAsset is synchronous, no requestId
    }

    // Batch request: create multiple variants/assets in parallel
    if (batchCount && batchCount > 1 && destination.type === 'new_asset' && sendBatchRequest) {
      return sendBatchRequest({
        name: destination.assetName || 'Generated Asset',
        assetType: destination.assetType || 'character',
        prompt,
        count: batchCount,
        mode: batchMode || 'explore',
        referenceAssetIds: hasAssetRefs ? referenceAssetIds : undefined,
        referenceVariantIds: hasVariantRefs ? referenceVariantIds : undefined,
        aspectRatio: params.aspectRatio,
        parentAssetId: destination.parentAssetId || undefined,
        disableStyle,
      });
    }

    if (destination.type === 'existing_asset' && destination.assetId) {
      // Add variant to existing asset (refine/combine operation) - prompt is required
      if (!prompt) {
        throw new Error('Prompt is required for refine operations');
      }

      return sendRefineRequest({
        assetId: destination.assetId,
        prompt,
        // Pass all source variants for combine-into-existing scenarios
        sourceVariantIds: hasVariantRefs ? referenceVariantIds : undefined,
        referenceAssetIds: hasAssetRefs ? referenceAssetIds : undefined,
        disableStyle,
      });
    } else {
      // Create new asset (generate, create, or combine)
      return sendGenerateRequest({
        name: destination.assetName || 'Generated Asset',
        assetType: destination.assetType || 'character',
        prompt,
        referenceAssetIds: hasAssetRefs ? referenceAssetIds : undefined,
        referenceVariantIds: hasVariantRefs ? referenceVariantIds : undefined,
        parentAssetId: destination.parentAssetId || undefined,
        disableStyle,
      });
    }
  }, [sendGenerateRequest, sendRefineRequest, forkAsset, sendBatchRequest]);

  /**
   * Generate: Create new asset from prompt only (no references)
   */
  const onGenerate = useCallback((params: {
    name: string;
    type: string;
    prompt: string;
    parentAssetId?: string;
  }): string => {
    return handleForgeSubmit({
      prompt: params.prompt,
      destination: {
        type: 'new_asset',
        assetName: params.name,
        assetType: params.type,
        parentAssetId: params.parentAssetId || null,
      },
      operation: 'generate',
    });
  }, [handleForgeSubmit]);

  /**
   * Fork: Copy asset to new asset without AI generation
   * Backend resolves asset ID to its active variant
   */
  const onFork = useCallback((params: {
    sourceAssetId: string;
    name: string;
    type: string;
    parentAssetId?: string;
  }): void => {
    if (!forkAsset) {
      console.error('[useForgeOperations] forkAsset not provided');
      return;
    }
    forkAsset({
      sourceAssetId: params.sourceAssetId,
      name: params.name,
      assetType: params.type,
      parentAssetId: params.parentAssetId,
    });
  }, [forkAsset]);

  /**
   * Derive: Create new asset using one or more references as inspiration
   */
  const onDerive = useCallback((params: {
    name: string;
    type: string;
    prompt: string;
    referenceAssetIds: string[];
    parentAssetId?: string;
  }): string => {
    return handleForgeSubmit({
      prompt: params.prompt,
      referenceAssetIds: params.referenceAssetIds,
      destination: {
        type: 'new_asset',
        assetName: params.name,
        assetType: params.type,
        parentAssetId: params.parentAssetId || null,
      },
      operation: 'derive',
    });
  }, [handleForgeSubmit]);

  /**
   * Refine: Add variant to existing asset
   */
  const onRefine = useCallback((params: {
    assetId: string;
    prompt: string;
  }): string => {
    return handleForgeSubmit({
      prompt: params.prompt,
      destination: {
        type: 'existing_asset',
        assetId: params.assetId,
      },
      operation: 'refine',
    });
  }, [handleForgeSubmit]);

  return {
    handleForgeSubmit,
    onGenerate,
    onFork,
    onDerive,
    onRefine,
  };
}
