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
import type { GenerateRequestParams, RefineRequestParams, ForkParams } from './useSpaceWebSocket';

export interface UseForgeOperationsParams {
  /** WebSocket function to send generate requests */
  sendGenerateRequest: (params: GenerateRequestParams) => string;
  /** WebSocket function to send refine requests */
  sendRefineRequest: (params: RefineRequestParams) => string;
  /** WebSocket function to fork an asset - creates 'forked' lineage */
  forkAsset?: (params: ForkParams) => void;
}

export interface UseForgeOperationsReturn {
  /** Submit a forge operation (generate, refine, combine, fork) */
  handleForgeSubmit: (params: ForgeSubmitParams) => string;

  /** Chat callback: Generate a new asset (optionally with reference images) */
  onGenerateAsset: (params: {
    name: string;
    type: string;
    prompt: string;
    parentAssetId?: string;
    referenceAssetIds?: string[];
  }) => string;

  /** Chat callback: Refine an existing asset with a new variant */
  onRefineAsset: (params: {
    assetId: string;
    prompt: string;
  }) => string;

  /** Chat callback: Combine multiple assets into a new one */
  onCombineAssets: (params: {
    sourceAssetIds: string[];
    prompt: string;
    targetName: string;
    targetType: string;
  }) => string;
}

export function useForgeOperations({
  sendGenerateRequest,
  sendRefineRequest,
  forkAsset,
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
    const { prompt, referenceVariantIds = [], referenceAssetIds, destination, operation } = params;
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
      });
    }
  }, [sendGenerateRequest, sendRefineRequest, forkAsset]);

  /**
   * Chat callback: Generate a new asset
   * Passes referenceAssetIds directly - backend resolves to default variants
   */
  const onGenerateAsset = useCallback((params: {
    name: string;
    type: string;
    prompt: string;
    parentAssetId?: string;
    referenceAssetIds?: string[];
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
      operation: params.referenceAssetIds?.length ? 'create' : 'generate',
    });
  }, [handleForgeSubmit]);

  /**
   * Chat callback: Refine an existing asset
   * Passes assetId only - backend resolves sourceVariantId from asset's active variant
   */
  const onRefineAsset = useCallback((params: {
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

  /**
   * Chat callback: Combine multiple assets
   * Passes asset IDs directly - backend resolves to default variants
   */
  const onCombineAssets = useCallback((params: {
    sourceAssetIds: string[];
    prompt: string;
    targetName: string;
    targetType: string;
  }): string => {
    return handleForgeSubmit({
      prompt: params.prompt,
      referenceAssetIds: params.sourceAssetIds,
      destination: {
        type: 'new_asset',
        assetName: params.targetName,
        assetType: params.targetType,
        parentAssetId: null,
      },
      operation: 'combine',
    });
  }, [handleForgeSubmit]);

  return {
    handleForgeSubmit,
    onGenerateAsset,
    onRefineAsset,
    onCombineAssets,
  };
}
