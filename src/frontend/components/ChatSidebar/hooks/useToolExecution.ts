import { useCallback, useRef, useEffect, useMemo } from 'react';
import { useForgeTrayStore } from '../../../stores/forgeTrayStore';
import type { Asset, Variant, DescribeRequestParams, CompareRequestParams, DescribeResponseResult, CompareResponseResult } from '../../../hooks/useSpaceWebSocket';
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
  allAssets: Asset[];
  allVariants: Variant[];
  // Forge operations (matching ForgeTray UI)
  onGenerate?: (params: { name: string; type: string; prompt: string; parentAssetId?: string }) => string | void;
  onFork?: (params: { sourceAssetId: string; name: string; type: string; parentAssetId?: string }) => void;
  onDerive?: (params: { name: string; type: string; prompt: string; referenceAssetIds: string[]; parentAssetId?: string }) => string | void;
  onRefine?: (params: { assetId: string; prompt: string }) => string | void;
  // WebSocket methods for describe/compare
  sendDescribeRequest?: (params: DescribeRequestParams) => string;
  sendCompareRequest?: (params: CompareRequestParams) => string;
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
  /** Handle describe response from WebSocket */
  handleDescribeResponse: (response: DescribeResponseResult) => void;
  /** Handle compare response from WebSocket */
  handleCompareResponse: (response: CompareResponseResult) => void;
  /** Cleanup pending requests on WebSocket disconnect */
  cleanupPendingRequests: () => void;
}

// =============================================================================
// Constants
// =============================================================================

/** Maximum number of jobs to track for auto-review */
const MAX_TRACKED_JOBS = 50;
/** Time-to-live for job tracking entries (10 minutes) */
const JOB_TTL_MS = 10 * 60 * 1000;
/** Timeout for describe/compare requests (60 seconds) */
const VISION_REQUEST_TIMEOUT_MS = 60 * 1000;

// =============================================================================
// Hook
// =============================================================================

interface PendingVisionRequest {
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  createdAt: number;
}

export function useToolExecution(deps: ToolExecutionDeps): UseToolExecutionReturn {
  const { allAssets, allVariants, onGenerate, onFork, onDerive, onRefine } = deps;

  // Forge tray state
  const slots = useForgeTrayStore((state) => state.slots);
  const addSlot = useForgeTrayStore((state) => state.addSlot);
  const removeSlot = useForgeTrayStore((state) => state.removeSlot);
  const clearSlots = useForgeTrayStore((state) => state.clearSlots);
  const setPrompt = useForgeTrayStore((state) => state.setPrompt);

  // Job tracking for auto-review
  const trackedJobsRef = useRef<Map<string, TrackedJobInfo>>(new Map());

  // Pending vision (describe/compare) requests awaiting WebSocket response
  const pendingDescribeRef = useRef<Map<string, PendingVisionRequest>>(new Map());
  const pendingCompareRef = useRef<Map<string, PendingVisionRequest>>(new Map());

  // Cleanup stale jobs and vision requests periodically
  useEffect(() => {
    const cleanup = () => {
      const now = Date.now();

      // Cleanup jobs
      const jobs = trackedJobsRef.current;
      for (const [jobId, jobInfo] of jobs.entries()) {
        if (now - jobInfo.createdAt > JOB_TTL_MS) {
          jobs.delete(jobId);
        }
      }
      if (jobs.size > MAX_TRACKED_JOBS) {
        const entries = Array.from(jobs.entries())
          .sort((a, b) => a[1].createdAt - b[1].createdAt);
        const toRemove = entries.slice(0, jobs.size - MAX_TRACKED_JOBS);
        toRemove.forEach(([id]) => jobs.delete(id));
      }

      // Cleanup timed-out vision requests
      for (const [requestId, request] of pendingDescribeRef.current.entries()) {
        if (now - request.createdAt > VISION_REQUEST_TIMEOUT_MS) {
          request.reject(new Error('Request timed out'));
          pendingDescribeRef.current.delete(requestId);
        }
      }
      for (const [requestId, request] of pendingCompareRef.current.entries()) {
        if (now - request.createdAt > VISION_REQUEST_TIMEOUT_MS) {
          request.reject(new Error('Request timed out'));
          pendingCompareRef.current.delete(requestId);
        }
      }
    };

    const interval = setInterval(cleanup, 10000); // Every 10 seconds
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

  // Handle describe response from WebSocket
  const handleDescribeResponse = useCallback((response: DescribeResponseResult) => {
    const pending = pendingDescribeRef.current.get(response.requestId);
    if (pending) {
      pendingDescribeRef.current.delete(response.requestId);
      if (response.success && response.description) {
        pending.resolve(response.description);
      } else {
        pending.reject(new Error(response.error || 'Failed to describe image'));
      }
    }
  }, []);

  // Handle compare response from WebSocket
  const handleCompareResponse = useCallback((response: CompareResponseResult) => {
    const pending = pendingCompareRef.current.get(response.requestId);
    if (pending) {
      pendingCompareRef.current.delete(response.requestId);
      if (response.success && response.comparison) {
        pending.resolve(response.comparison);
      } else {
        pending.reject(new Error(response.error || 'Failed to compare images'));
      }
    }
  }, []);

  // Cleanup all pending requests on WebSocket disconnect
  const cleanupPendingRequests = useCallback(() => {
    // Reject all pending describe requests
    for (const [requestId, pending] of pendingDescribeRef.current.entries()) {
      pending.reject(new Error('WebSocket disconnected'));
      pendingDescribeRef.current.delete(requestId);
    }
    // Reject all pending compare requests
    for (const [requestId, pending] of pendingCompareRef.current.entries()) {
      pending.reject(new Error('WebSocket disconnected'));
      pendingCompareRef.current.delete(requestId);
    }
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

      // =======================================================================
      // FORGE OPERATIONS (5 tools matching ForgeTray UI)
      // =======================================================================

      case 'generate': {
        if (!onGenerate) return 'Generate not available';

        const parentAssetId = params.parentAssetId as string | undefined;
        if (parentAssetId && !allAssets.find(a => a.id === parentAssetId)) {
          return `Parent asset not found: ${parentAssetId}`;
        }

        const genParams = {
          name: params.name as string,
          type: params.type as string,
          prompt: params.prompt as string,
          parentAssetId,
        };
        const jobId = onGenerate(genParams);
        if (jobId) {
          trackJob(jobId, {
            assetName: genParams.name,
            prompt: genParams.prompt,
            createdAt: Date.now(),
          });
        }
        return `Started generating "${genParams.name}"`;
      }

      case 'fork': {
        if (!onFork) return 'Fork not available';

        const sourceAssetId = params.sourceAssetId as string;
        const sourceAsset = allAssets.find(a => a.id === sourceAssetId);
        if (!sourceAsset) {
          return `Source asset not found: ${sourceAssetId}`;
        }

        const parentAssetId = params.parentAssetId as string | undefined;
        if (parentAssetId && !allAssets.find(a => a.id === parentAssetId)) {
          return `Parent asset not found: ${parentAssetId}`;
        }

        onFork({
          sourceAssetId,
          name: params.name as string,
          type: params.type as string,
          parentAssetId,
        });
        return `Forked "${sourceAsset.name}" as "${params.name}"`;
      }

      case 'derive': {
        if (!onDerive) return 'Derive not available';

        const referenceAssetIds = params.referenceAssetIds as string[];
        if (!referenceAssetIds || referenceAssetIds.length === 0) {
          return 'At least 1 reference asset is required for deriving';
        }
        const invalidIds = referenceAssetIds.filter(id => !allAssets.find(a => a.id === id));
        if (invalidIds.length > 0) {
          return `Reference asset(s) not found: ${invalidIds.join(', ')}`;
        }

        const parentAssetId = params.parentAssetId as string | undefined;
        if (parentAssetId && !allAssets.find(a => a.id === parentAssetId)) {
          return `Parent asset not found: ${parentAssetId}`;
        }

        const deriveParams = {
          name: params.name as string,
          type: params.type as string,
          prompt: params.prompt as string,
          referenceAssetIds,
          parentAssetId,
        };
        const jobId = onDerive(deriveParams);
        if (jobId) {
          trackJob(jobId, {
            assetName: deriveParams.name,
            prompt: deriveParams.prompt,
            createdAt: Date.now(),
          });
        }
        const refNames = referenceAssetIds.map(id => allAssets.find(a => a.id === id)?.name).filter(Boolean).join(', ');
        return `Started deriving "${deriveParams.name}" from ${refNames}`;
      }

      case 'refine': {
        if (!onRefine) return 'Refine not available';

        const assetId = params.assetId as string;
        const asset = allAssets.find(a => a.id === assetId);
        if (!asset) {
          return `Asset not found: ${assetId}`;
        }

        const refineParams = {
          assetId,
          prompt: params.prompt as string,
        };
        const jobId = onRefine(refineParams);
        if (jobId) {
          trackJob(jobId, {
            assetName: asset.name,
            prompt: refineParams.prompt,
            createdAt: Date.now(),
          });
        }
        return `Started refining "${asset.name}"`;
      }

      // Note: 'search', 'describe', and 'compare' are now executed in the backend
      // during the agentic loop (see toolExecutor.ts). They're not handled here
      // because toolCalls are removed from the response before reaching the frontend.

      default:
        return `Unknown action: ${name}`;
    }
  }, [allAssets, allVariants, slots, addSlot, removeSlot, clearSlots, setPrompt, onGenerate, onFork, onDerive, onRefine, trackJob]);

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

  // Memoize return object to prevent unnecessary effect re-runs in consumers
  return useMemo(() => ({
    executeToolCall,
    executeToolCalls,
    trackJob,
    consumeTrackedJob,
    clearTrackedJobs,
    handleDescribeResponse,
    handleCompareResponse,
    cleanupPendingRequests,
  }), [
    executeToolCall,
    executeToolCalls,
    trackJob,
    consumeTrackedJob,
    clearTrackedJobs,
    handleDescribeResponse,
    handleCompareResponse,
    cleanupPendingRequests,
  ]);
}
