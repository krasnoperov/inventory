/**
 * useForgeOperations - Shared hook for asset generation operations
 *
 * Centralizes all forge operations (generate, refine, combine) for both
 * SpacePage and AssetDetailPage. Works at the asset level - backend
 * resolves asset IDs to default variants.
 */

import { useCallback } from 'react';
import type { ForgeSubmitParams } from '../components/ForgeTray';
import type { JobContext } from './useSpaceWebSocket';

export interface UseForgeOperationsParams {
  spaceId: string;
  trackJob: (jobId: string, context?: JobContext) => void;
}

export interface UseForgeOperationsReturn {
  /** Submit a forge operation (generate, refine, combine, fork) */
  handleForgeSubmit: (params: ForgeSubmitParams) => Promise<string>;

  /** Chat callback: Generate a new asset (optionally with reference images) */
  onGenerateAsset: (params: {
    name: string;
    type: string;
    prompt: string;
    parentAssetId?: string;
    referenceAssetIds?: string[];
  }) => Promise<string | void>;

  /** Chat callback: Refine an existing asset with a new variant */
  onRefineAsset: (params: {
    assetId: string;
    prompt: string;
  }) => Promise<string | void>;

  /** Chat callback: Combine multiple assets into a new one */
  onCombineAssets: (params: {
    sourceAssetIds: string[];
    prompt: string;
    targetName: string;
    targetType: string;
  }) => Promise<string | void>;
}

export function useForgeOperations({
  spaceId,
  trackJob,
}: UseForgeOperationsParams): UseForgeOperationsReturn {

  /**
   * Submit a forge operation to the backend.
   *
   * Supports two reference modes (backend resolves appropriately):
   * - referenceAssetIds: Asset-level refs (from Chat/Claude) - backend resolves to default variants
   * - referenceVariantIds: Explicit variant refs (from ForgeTray UI) - used as-is
   */
  const handleForgeSubmit = useCallback(async (params: ForgeSubmitParams): Promise<string> => {
    const { prompt, referenceVariantIds = [], referenceAssetIds, destination } = params;
    const hasVariantRefs = referenceVariantIds.length > 0;
    const hasAssetRefs = referenceAssetIds && referenceAssetIds.length > 0;

    if (destination.type === 'existing_asset' && destination.assetId) {
      // Add variant to existing asset (refine operation)
      // sourceVariantId is optional - backend resolves from asset's active variant if not provided
      const sourceVariantId = hasVariantRefs ? referenceVariantIds[0] : undefined;

      const response = await fetch(`/api/spaces/${spaceId}/assets/${destination.assetId}/variants`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceVariantId,
          prompt,
          referenceAssetIds: hasAssetRefs ? referenceAssetIds : undefined,
          referenceVariantIds: !hasAssetRefs && referenceVariantIds.length > 1 ? referenceVariantIds.slice(1) : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || 'Failed to start variant generation');
      }

      const result = await response.json() as { success: boolean; jobId: string };
      const refCount = hasAssetRefs ? referenceAssetIds.length : referenceVariantIds.length;
      trackJob(result.jobId, {
        jobType: refCount > 1 ? 'compose' : 'derive',
        prompt,
        assetId: destination.assetId,
        assetName: destination.assetName,
      });
      return result.jobId;
    } else {
      // Create new asset
      const response = await fetch(`/api/spaces/${spaceId}/assets`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: destination.assetName || 'Generated Asset',
          type: destination.assetType || 'character',
          parentAssetId: destination.parentAssetId || undefined,
          prompt,
          referenceAssetIds: hasAssetRefs ? referenceAssetIds : undefined,
          referenceVariantIds: !hasAssetRefs && hasVariantRefs ? referenceVariantIds : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || 'Failed to start generation');
      }

      const result = await response.json() as { success: boolean; jobId: string; mode: string; assetId: string };
      trackJob(result.jobId, {
        jobType: result.mode as 'generate' | 'derive' | 'compose',
        prompt,
        assetId: result.assetId,
        assetName: destination.assetName,
      });
      return result.jobId;
    }
  }, [spaceId, trackJob]);

  /**
   * Chat callback: Generate a new asset
   * Passes referenceAssetIds directly - backend resolves to default variants
   */
  const onGenerateAsset = useCallback(async (params: {
    name: string;
    type: string;
    prompt: string;
    parentAssetId?: string;
    referenceAssetIds?: string[];
  }): Promise<string | void> => {
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
  const onRefineAsset = useCallback(async (params: {
    assetId: string;
    prompt: string;
  }): Promise<string | void> => {
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
  const onCombineAssets = useCallback(async (params: {
    sourceAssetIds: string[];
    prompt: string;
    targetName: string;
    targetType: string;
  }): Promise<string | void> => {
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
