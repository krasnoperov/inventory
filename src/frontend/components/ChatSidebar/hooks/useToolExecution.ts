import { useCallback, useRef, useEffect } from 'react';
import { useForgeTrayStore } from '../../../stores/forgeTrayStore';
import type { Asset, Variant } from '../../../hooks/useSpaceWebSocket';
import type { ToolCall } from '../../../../api/types';

// =============================================================================
// Types
// =============================================================================

/** Job info tracked for auto-review */
export interface TrackedJobInfo {
  assetName: string;
  prompt: string;
  createdAt: number;
}

/** Dependencies injected into the hook */
export interface ToolExecutionDeps {
  spaceId: string;
  allAssets: Asset[];
  allVariants: Variant[];
  onGenerateAsset?: (params: { name: string; type: string; prompt: string; parentAssetId?: string; referenceAssetIds?: string[] }) => Promise<string | void>;
  onRefineAsset?: (params: { assetId: string; prompt: string }) => Promise<string | void>;
  onCombineAssets?: (params: { sourceAssetIds: string[]; prompt: string; targetName: string; targetType: string }) => Promise<string | void>;
}

export interface UseToolExecutionReturn {
  executeToolCall: (tool: ToolCall) => Promise<string>;
  executeToolCalls: (toolCalls: ToolCall[]) => Promise<string[]>;
  /** Track a job for auto-review */
  trackJob: (jobId: string, info: TrackedJobInfo) => void;
  /** Get and remove a tracked job (returns undefined if not found) */
  consumeTrackedJob: (jobId: string) => TrackedJobInfo | undefined;
  /** Clear all tracked jobs */
  clearTrackedJobs: () => void;
}

// =============================================================================
// Constants
// =============================================================================

/** Maximum number of jobs to track for auto-review */
const MAX_TRACKED_JOBS = 50;
/** Time-to-live for job tracking entries (10 minutes) */
const JOB_TTL_MS = 10 * 60 * 1000;

// =============================================================================
// Hook
// =============================================================================

export function useToolExecution(deps: ToolExecutionDeps): UseToolExecutionReturn {
  const { spaceId, allAssets, allVariants, onGenerateAsset, onRefineAsset, onCombineAssets } = deps;

  // Forge tray state
  const slots = useForgeTrayStore((state) => state.slots);
  const addSlot = useForgeTrayStore((state) => state.addSlot);
  const removeSlot = useForgeTrayStore((state) => state.removeSlot);
  const clearSlots = useForgeTrayStore((state) => state.clearSlots);
  const setPrompt = useForgeTrayStore((state) => state.setPrompt);

  // Job tracking for auto-review
  const trackedJobsRef = useRef<Map<string, TrackedJobInfo>>(new Map());

  // Cleanup stale jobs periodically
  useEffect(() => {
    const cleanupJobs = () => {
      const now = Date.now();
      const jobs = trackedJobsRef.current;

      // Remove entries older than TTL
      for (const [jobId, jobInfo] of jobs.entries()) {
        if (now - jobInfo.createdAt > JOB_TTL_MS) {
          jobs.delete(jobId);
        }
      }

      // If still over limit, remove oldest entries
      if (jobs.size > MAX_TRACKED_JOBS) {
        const entries = Array.from(jobs.entries())
          .sort((a, b) => a[1].createdAt - b[1].createdAt);
        const toRemove = entries.slice(0, jobs.size - MAX_TRACKED_JOBS);
        toRemove.forEach(([id]) => jobs.delete(id));
      }
    };

    const interval = setInterval(cleanupJobs, 60000); // Every minute
    return () => clearInterval(interval);
  }, []);

  // Track a job for auto-review
  const trackJob = useCallback((jobId: string, info: TrackedJobInfo) => {
    trackedJobsRef.current.set(jobId, info);
  }, []);

  // Get and remove a tracked job
  const consumeTrackedJob = useCallback((jobId: string): TrackedJobInfo | undefined => {
    const info = trackedJobsRef.current.get(jobId);
    if (info) {
      trackedJobsRef.current.delete(jobId);
    }
    return info;
  }, []);

  // Clear all tracked jobs
  const clearTrackedJobs = useCallback(() => {
    trackedJobsRef.current.clear();
  }, []);

  // Execute a single tool call
  const executeToolCall = useCallback(async (tool: ToolCall): Promise<string> => {
    const { name, params } = tool;

    switch (name) {
      case 'add_to_tray': {
        const assetId = params.assetId as string;
        const asset = allAssets.find(a => a.id === assetId);
        if (!asset) return `Asset not found: ${params.assetName}`;

        const targetVariantId = asset.active_variant_id;
        const variant = allVariants.find(v => v.id === targetVariantId);
        if (!variant) return `No variant found for "${asset.name}"`;

        const added = addSlot(variant, asset);
        return added ? `Added "${asset.name}" to tray` : `"${asset.name}" already in tray`;
      }

      case 'remove_from_tray': {
        const slotIndex = params.slotIndex as number;
        if (slots[slotIndex]) {
          const slotName = slots[slotIndex].asset.name;
          removeSlot(slots[slotIndex].id);
          return `Removed "${slotName}" from tray`;
        }
        return `No slot at index ${slotIndex}`;
      }

      case 'clear_tray':
        clearSlots();
        return 'Cleared the tray';

      case 'set_prompt': {
        const newPrompt = params.prompt as string;
        setPrompt(newPrompt);
        return `Set prompt: "${newPrompt.slice(0, 50)}${newPrompt.length > 50 ? '...' : ''}"`;
      }

      case 'generate_asset': {
        if (!onGenerateAsset) return 'Generation not available';
        const genParams = {
          name: params.name as string,
          type: params.type as string,
          prompt: params.prompt as string,
          parentAssetId: params.parentAssetId as string | undefined,
          referenceAssetIds: params.referenceAssetIds as string[] | undefined,
        };
        const jobId = await onGenerateAsset(genParams);
        // Track job for auto-review
        if (jobId) {
          trackJob(jobId, {
            assetName: genParams.name,
            prompt: genParams.prompt,
            createdAt: Date.now(),
          });
        }
        return `Started generating "${genParams.name}"`;
      }

      case 'refine_asset': {
        if (!onRefineAsset) return 'Refinement not available';
        const refineParams = {
          assetId: params.assetId as string,
          prompt: params.prompt as string,
        };
        const jobId = await onRefineAsset(refineParams);
        const asset = allAssets.find(a => a.id === refineParams.assetId);
        // Track job for auto-review
        if (jobId) {
          trackJob(jobId, {
            assetName: asset?.name || 'asset',
            prompt: refineParams.prompt,
            createdAt: Date.now(),
          });
        }
        return `Started refining "${asset?.name || 'asset'}"`;
      }

      case 'combine_assets': {
        if (!onCombineAssets) return 'Combining not available';
        const combineParams = {
          sourceAssetIds: params.sourceAssetIds as string[],
          prompt: params.prompt as string,
          targetName: params.targetName as string,
          targetType: params.targetType as string,
        };
        const jobId = await onCombineAssets(combineParams);
        // Track job for auto-review
        if (jobId) {
          trackJob(jobId, {
            assetName: combineParams.targetName,
            prompt: combineParams.prompt,
            createdAt: Date.now(),
          });
        }
        return `Started combining assets into "${combineParams.targetName}"`;
      }

      case 'search_assets': {
        const query = (params.query as string || '').toLowerCase();
        const matches = allAssets.filter(a =>
          a.name.toLowerCase().includes(query) ||
          a.type.toLowerCase().includes(query)
        );
        if (matches.length === 0) return `No assets found matching "${params.query}"`;
        return `Found: ${matches.map(a => a.name).join(', ')}`;
      }

      case 'describe_image': {
        const assetId = params.assetId as string;
        const variantId = params.variantId as string | undefined;
        const assetName = params.assetName as string;
        const focus = (params.focus as string) || 'general';
        const question = params.question as string | undefined;

        try {
          const response = await fetch(`/api/spaces/${spaceId}/chat/describe`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assetId, variantId, assetName, focus, question }),
          });

          if (!response.ok) {
            const error = await response.json() as { error?: string };
            return `Failed to describe image: ${error.error || 'Unknown error'}`;
          }

          const data = await response.json() as { success: boolean; description: string };
          return data.description;
        } catch (err) {
          return `Failed to describe image: ${err instanceof Error ? err.message : 'Network error'}`;
        }
      }

      case 'compare_variants': {
        const variantIds = params.variantIds as string[];
        const aspects = (params.aspectsToCompare as string[]) || ['style', 'composition', 'colors'];

        // Build labels from asset names
        const variantsWithLabels = variantIds.map(vid => {
          const variant = allVariants.find(v => v.id === vid);
          const asset = variant ? allAssets.find(a => a.id === variant.asset_id) : null;
          return {
            variantId: vid,
            label: asset?.name || `Variant ${vid.slice(0, 8)}`,
          };
        });

        try {
          const response = await fetch(`/api/spaces/${spaceId}/chat/compare`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ variantIds: variantsWithLabels, aspects }),
          });

          if (!response.ok) {
            const error = await response.json() as { error?: string };
            return `Failed to compare images: ${error.error || 'Unknown error'}`;
          }

          const data = await response.json() as { success: boolean; comparison: string };
          return data.comparison;
        } catch (err) {
          return `Failed to compare images: ${err instanceof Error ? err.message : 'Network error'}`;
        }
      }

      default:
        return `Unknown action: ${name}`;
    }
  }, [spaceId, allAssets, allVariants, slots, addSlot, removeSlot, clearSlots, setPrompt, onGenerateAsset, onRefineAsset, onCombineAssets, trackJob]);

  // Execute all tool calls, collecting results
  const executeToolCalls = useCallback(async (toolCalls: ToolCall[]): Promise<string[]> => {
    const results: string[] = [];
    for (const tool of toolCalls) {
      try {
        const result = await executeToolCall(tool);
        results.push(`✅ ${result}`);
      } catch (err) {
        results.push(`❌ Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
    return results;
  }, [executeToolCall]);

  return {
    executeToolCall,
    executeToolCalls,
    trackJob,
    consumeTrackedJob,
    clearTrackedJobs,
  };
}
