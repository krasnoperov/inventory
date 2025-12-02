import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useForgeTrayStore } from '../../stores/forgeTrayStore';
import {
  useChatStore,
  useChatMessages,
  useChatInputBuffer,
  useChatMode,
  useChatPlan,
  useChatPlanStatus,
  usePendingApprovals,
  type ChatMessage,
} from '../../stores/chatStore';
import {
  type Asset,
  type Variant,
  getVariantThumbnailUrl,
  type ChatRequestParams,
  type ChatResponseResult,
  type DescribeRequestParams,
  type CompareRequestParams,
  type DescribeResponseResult,
  type CompareResponseResult,
  type ForgeContext as WsForgeContext,
  type ViewingContext as WsViewingContext,
} from '../../hooks/useSpaceWebSocket';
import {
  type ForgeContext,
  type ViewingContext,
  type BotResponse,
} from '../../../api/types';
import { useToolExecution } from './hooks/useToolExecution';
import { useLimitedUsage, invalidateUsageCache, formatMeterName } from '../../hooks/useLimitedUsage';
import { MessageList } from './MessageList';
import { PlanPanel } from './PlanPanel';
import { ChatInput } from './ChatInput';
import { PreferencesPanel } from './PreferencesPanel';
import styles from './ChatSidebar.module.css';

// =============================================================================
// Types
// =============================================================================

/** Job completion data passed from parent */
export interface JobCompletionData {
  jobId: string;
  variantId: string;
  assetId?: string;
  assetName?: string;
  prompt?: string;
  thumbKey?: string; // Pass directly to avoid race condition with allVariants
}

export interface ChatSidebarProps {
  spaceId: string;
  isOpen: boolean;
  onClose: () => void;
  currentAsset?: Asset | null;
  /** The currently selected/viewed variant */
  currentVariant?: Variant | null;
  allAssets?: Asset[];
  allVariants?: Variant[];
  onGenerateAsset?: (params: { name: string; type: string; prompt: string; parentAssetId?: string; referenceAssetIds?: string[] }) => string | void;
  onRefineAsset?: (params: { assetId: string; prompt: string }) => string | void;
  onCombineAssets?: (params: { sourceAssetIds: string[]; prompt: string; targetName: string; targetType: string }) => string | void;
  lastCompletedJob?: JobCompletionData | null;
  /** WebSocket chat request function (required for chat communication) */
  sendChatRequest: (params: ChatRequestParams) => string;
  /** Latest chat response from WebSocket workflow */
  chatResponse: ChatResponseResult | null;
  /** WebSocket describe request function (for tool calls) */
  sendDescribeRequest?: (params: DescribeRequestParams) => string;
  /** WebSocket compare request function (for tool calls) */
  sendCompareRequest?: (params: CompareRequestParams) => string;
  /** Latest describe response from WebSocket */
  describeResponse?: DescribeResponseResult | null;
  /** Latest compare response from WebSocket */
  compareResponse?: CompareResponseResult | null;
}

// Re-export ChatMessage type for consumers
export type { ChatMessage };

// =============================================================================
// Component
// =============================================================================

export function ChatSidebar({
  spaceId,
  isOpen,
  onClose,
  currentAsset,
  currentVariant,
  allAssets = [],
  allVariants = [],
  onGenerateAsset,
  onRefineAsset,
  onCombineAssets,
  lastCompletedJob,
  sendChatRequest,
  chatResponse,
  sendDescribeRequest,
  sendCompareRequest,
  describeResponse,
  compareResponse,
}: ChatSidebarProps) {
  // Store state (persisted) - use hooks that don't recreate selectors
  const messages = useChatMessages(spaceId);
  const inputValue = useChatInputBuffer(spaceId);
  const mode = useChatMode(spaceId);
  const activePlan = useChatPlan(spaceId);
  const planStatus = useChatPlanStatus(spaceId);
  const pendingApprovals = usePendingApprovals(spaceId);

  // Store actions
  const {
    setMessages,
    addMessage,
    clearMessages,
    setInputBuffer,
    setMode,
    setPlan,
    approvePlan,
    rejectPlan,
    startStep,
    completeStep,
    failStep,
    cancelPlan,
    resetPlan,
    // Trust zone actions
    setPendingApprovals,
    approveApproval,
    rejectApproval,
    clearPendingApprovals,
  } = useChatStore();

  // Local state (transient - not persisted)
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isAutoReviewing, setIsAutoReviewing] = useState(false);
  const [isExecutingStep, setIsExecutingStep] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  // Track if we've attempted to load history for this space (prevents re-fetch on message changes)
  const hasAttemptedHistoryLoad = useRef(false);
  // Track which meters have shown 90% warning this session
  const [warnedMeters, setWarnedMeters] = useState<Set<string>>(new Set());
  const warnedMetersRef = useRef(warnedMeters);
  warnedMetersRef.current = warnedMeters;
  // Track plan step waiting for ForgeTray completion (step index, or null if none)
  const [forgeTrayStepIndex, setForgeTrayStepIndex] = useState<number | null>(null);
  // Track pending WebSocket chat request
  const pendingChatRequestRef = useRef<{ requestId: string; messageToSend: string; modeToUse: 'advisor' | 'actor' } | null>(null);
  // Track pending auto-review request
  const pendingAutoReviewRef = useRef<{ requestId: string; assetName: string; prompt: string } | null>(null);

  // Usage tracking for 90% warnings
  const { meters, refresh: refreshUsage } = useLimitedUsage();
  const metersRef = useRef(meters);
  metersRef.current = meters;

  // Tool execution hook
  const toolExec = useToolExecution({
    allAssets,
    allVariants,
    onGenerateAsset,
    onRefineAsset,
    onCombineAssets,
    sendDescribeRequest,
    sendCompareRequest,
  });

  // Handle describe responses from WebSocket (consolidated handler)
  // Routes to either auto-review or tool execution based on requestId
  useEffect(() => {
    if (!describeResponse) return;

    // Check if this is an auto-review response first
    const autoReviewPending = pendingAutoReviewRef.current;
    if (autoReviewPending && describeResponse.requestId === autoReviewPending.requestId) {
      // Handle auto-review
      pendingAutoReviewRef.current = null;

      if (describeResponse.success && describeResponse.description) {
        const reviewMessage = `**Review of "${autoReviewPending.assetName}":**\n\n${describeResponse.description}\n\n**Original prompt:** "${autoReviewPending.prompt.slice(0, 100)}${autoReviewPending.prompt.length > 100 ? '...' : ''}"`;
        addMessage(spaceId, {
          role: 'assistant',
          content: reviewMessage,
          timestamp: Date.now(),
        });
      } else {
        addMessage(spaceId, {
          role: 'assistant',
          content: `Generated "${autoReviewPending.assetName}" successfully! (Auto-review unavailable)`,
          timestamp: Date.now(),
        });
      }
      setIsAutoReviewing(false);
      return;
    }

    // Otherwise, route to tool execution handler
    toolExec.handleDescribeResponse(describeResponse);
  }, [describeResponse, spaceId, addMessage, toolExec]);

  // Handle compare responses from WebSocket
  useEffect(() => {
    if (compareResponse) {
      toolExec.handleCompareResponse(compareResponse);
    }
  }, [compareResponse, toolExec]);

  // Forge tray state for context
  const slots = useForgeTrayStore((state) => state.slots);
  const prompt = useForgeTrayStore((state) => state.prompt);
  const prefillFromStep = useForgeTrayStore((state) => state.prefillFromStep);

  // Build forge context
  const forgeContext = useMemo<ForgeContext>(() => {
    const slotCount = slots.length;
    let operation: string;
    if (slotCount === 0) operation = 'generate';
    else if (slotCount === 1) operation = prompt ? 'refine' : 'fork';
    else operation = 'combine';

    return {
      operation,
      slots: slots.map(s => ({
        assetId: s.asset.id,
        assetName: s.asset.name,
        variantId: s.variant.id,
      })),
      prompt,
    };
  }, [slots, prompt]);

  // Build viewing context with variant info
  const viewingContext = useMemo<ViewingContext>(() => {
    if (currentAsset) {
      // Get variants for this asset
      const assetVariants = allVariants.filter(v => v.asset_id === currentAsset.id);
      // Determine which variant we're viewing
      const viewedVariant = currentVariant || assetVariants.find(v => v.id === currentAsset.active_variant_id);
      const variantIndex = viewedVariant
        ? assetVariants.findIndex(v => v.id === viewedVariant.id) + 1
        : 1;

      return {
        type: 'asset',
        assetId: currentAsset.id,
        assetName: currentAsset.name,
        variantId: viewedVariant?.id,
        variantCount: assetVariants.length,
        variantIndex,
      };
    }
    return { type: 'catalog' };
  }, [currentAsset, currentVariant, allVariants]);

  // ==========================================================================
  // Chat History - Load from server if store is empty
  // ==========================================================================

  const loadChatHistory = useCallback(async () => {
    // Check store directly to avoid depending on messages.length (which changes on every message)
    const existingMessages = useChatStore.getState().sessions[spaceId]?.messages;
    if (existingMessages && existingMessages.length > 0) {
      return;
    }

    try {
      setIsLoadingHistory(true);
      const response = await fetch(`/api/spaces/${spaceId}/chat/history`, {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json() as { success: boolean; messages: Array<{
          sender_type: 'user' | 'bot';
          content: string;
          created_at: number;
        }> };

        if (data.success && data.messages && data.messages.length > 0) {
          const formattedMessages: ChatMessage[] = data.messages.map((msg, idx) => ({
            id: `history_${idx}_${msg.created_at}`,
            role: msg.sender_type === 'user' ? 'user' : 'assistant',
            content: msg.content,
            timestamp: msg.created_at,
          }));
          setMessages(spaceId, formattedMessages);
        }
      }
    } catch (err) {
      console.error('Failed to load chat history:', err);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [spaceId, setMessages]);

  // Load history once when sidebar opens (use ref to prevent re-fetch on message changes)
  useEffect(() => {
    if (isOpen && spaceId && !hasAttemptedHistoryLoad.current) {
      hasAttemptedHistoryLoad.current = true;
      loadChatHistory();
    }
  }, [isOpen, spaceId, loadChatHistory]);

  // Reset history load flag when spaceId changes
  useEffect(() => {
    hasAttemptedHistoryLoad.current = false;
  }, [spaceId]);

  // Clear job tracking when sidebar closes
  useEffect(() => {
    if (!isOpen) {
      toolExec.clearTrackedJobs();
    }
  }, [isOpen, toolExec]);

  // ==========================================================================
  // Auto-Review
  // ==========================================================================

  useEffect(() => {
    if (!lastCompletedJob || !isOpen) return;

    const jobInfo = toolExec.consumeTrackedJob(lastCompletedJob.jobId);
    if (!jobInfo) return;

    const autoReviewJob = async () => {
      setIsAutoReviewing(true);

      // Use thumbKey directly from job completion (avoids race condition with allVariants)
      // Fallback to looking up in allVariants if thumbKey not provided
      const variant = allVariants.find(v => v.id === lastCompletedJob.variantId);
      const thumbnailUrl = lastCompletedJob.thumbKey
        ? `/api/images/${lastCompletedJob.thumbKey}`
        : variant ? getVariantThumbnailUrl(variant) : undefined;

      addMessage(spaceId, {
        role: 'assistant',
        content: `Generation complete for "${jobInfo.assetName}"! Let me review the result...`,
        timestamp: Date.now(),
        thumbnail: thumbnailUrl ? {
          url: thumbnailUrl,
          assetName: jobInfo.assetName,
          assetId: lastCompletedJob.assetId,
        } : undefined,
      });

      // Use WebSocket describe request for auto-review
      if (sendDescribeRequest && lastCompletedJob.assetId) {
        const requestId = sendDescribeRequest({
          assetId: lastCompletedJob.assetId,
          variantId: lastCompletedJob.variantId,
          assetName: jobInfo.assetName,
          focus: 'general',
        });
        // Store pending request for response handler
        pendingAutoReviewRef.current = {
          requestId,
          assetName: jobInfo.assetName,
          prompt: jobInfo.prompt,
        };
        // Response will be handled by the useEffect watching describeResponse
      } else {
        // Fallback if WebSocket not available
        addMessage(spaceId, {
          role: 'assistant',
          content: `Generated "${jobInfo.assetName}" successfully!`,
          timestamp: Date.now(),
        });
        setIsAutoReviewing(false);
      }
    };

    autoReviewJob();
  }, [lastCompletedJob, isOpen, spaceId, toolExec, addMessage, allVariants, sendDescribeRequest]);

  // ==========================================================================
  // ForgeTray Step Completion (when user submits manually from ForgeTray)
  // ==========================================================================

  useEffect(() => {
    // If a plan step is waiting for ForgeTray completion and a job just finished
    if (forgeTrayStepIndex !== null && lastCompletedJob && activePlan) {
      const step = activePlan.steps[forgeTrayStepIndex];
      if (step && step.status === 'in_progress') {
        // Complete the step
        completeStep(spaceId, forgeTrayStepIndex, `Generated via ForgeTray (job: ${lastCompletedJob.jobId})`);
        setForgeTrayStepIndex(null);

        // Check for remaining steps
        const nextIndex = activePlan.steps.findIndex((s, i) => i > forgeTrayStepIndex && s.status === 'pending');
        if (nextIndex !== -1) {
          addMessage(spaceId, {
            role: 'assistant',
            content: `Step ${forgeTrayStepIndex + 1} completed! Ready for step ${nextIndex + 1}. Click "Next Step" to continue.`,
            timestamp: Date.now(),
          });
        } else {
          addMessage(spaceId, {
            role: 'assistant',
            content: 'Plan completed successfully!',
            timestamp: Date.now(),
          });
          setTimeout(() => resetPlan(spaceId), 2000);
        }
      }
    }
  }, [lastCompletedJob, forgeTrayStepIndex, activePlan, spaceId, completeStep, addMessage, resetPlan]);

  // ==========================================================================
  // WebSocket Chat Response Handler
  // ==========================================================================

  useEffect(() => {
    if (!chatResponse || !pendingChatRequestRef.current) return;

    // Check if this response matches our pending request
    if (chatResponse.requestId !== pendingChatRequestRef.current.requestId) return;

    const { messageToSend, modeToUse } = pendingChatRequestRef.current;
    pendingChatRequestRef.current = null;
    setIsLoading(false);

    if (!chatResponse.success) {
      // Handle error
      addMessage(spaceId, {
        role: 'assistant',
        content: chatResponse.error || 'Failed to process message',
        timestamp: Date.now(),
        isError: true,
        retryPayload: { message: messageToSend, mode: modeToUse },
      });
      return;
    }

    const botResponse = chatResponse.response as BotResponse | undefined;
    if (!botResponse) {
      addMessage(spaceId, {
        role: 'assistant',
        content: 'Received empty response from assistant',
        timestamp: Date.now(),
        isError: true,
      });
      return;
    }

    // Process the bot response (same logic as HTTP handler)
    if (botResponse.type === 'plan' && (botResponse as any).plan) {
      setPlan(spaceId, (botResponse as any).plan);
      addMessage(spaceId, {
        role: 'assistant',
        content: botResponse.message || '',
        timestamp: Date.now(),
      });
    } else if (botResponse.type === 'action') {
      const messageParts: string[] = [botResponse.message || ''];

      // Auto-execute safe tools (toolCalls)
      if ((botResponse as any).toolCalls && (botResponse as any).toolCalls.length > 0) {
        toolExec.executeToolCalls((botResponse as any).toolCalls).then(results => {
          const updatedParts = [...messageParts, '\n**Auto-executed:**', results.join('\n')];
          addMessage(spaceId, {
            role: 'assistant',
            content: updatedParts.join('\n'),
            timestamp: Date.now(),
          });
        });
        return;
      }

      // Store pending approvals
      if ((botResponse as any).pendingApprovals && (botResponse as any).pendingApprovals.length > 0) {
        setPendingApprovals(spaceId, (botResponse as any).pendingApprovals);
        messageParts.push('\n**Awaiting approval:**');
        (botResponse as any).pendingApprovals.forEach((pa: any) => {
          messageParts.push(`⏳ ${pa.description}`);
        });
        messageParts.push('\n_Use the approval panel below to approve or reject._');
      }

      addMessage(spaceId, {
        role: 'assistant',
        content: messageParts.join('\n'),
        timestamp: Date.now(),
      });
    } else {
      addMessage(spaceId, {
        role: 'assistant',
        content: botResponse.message || 'Response received',
        timestamp: Date.now(),
      });
    }

    // Check for 90% usage warning after successful response
    // Use refs to access current values without adding to dependency array
    invalidateUsageCache();
    refreshUsage().then(() => {
      const currentMeters = metersRef.current;
      const currentWarnedMeters = warnedMetersRef.current;
      for (const meter of currentMeters) {
        if (meter.percentUsed >= 90 && !currentWarnedMeters.has(meter.name)) {
          setWarnedMeters(prev => new Set(prev).add(meter.name));
          addMessage(spaceId, {
            role: 'assistant',
            content: `⚠️ You've used ${Math.round(meter.percentUsed)}% of your ${formatMeterName(meter.name)} this month.`,
            timestamp: Date.now(),
          });
          break;
        }
      }
    });
  }, [chatResponse, spaceId, addMessage, setPlan, setPendingApprovals, toolExec, refreshUsage]);

  // ==========================================================================
  // Plan Execution
  // ==========================================================================

  const executeStep = useCallback(async (stepIndex: number) => {
    if (!activePlan) return;

    setIsExecutingStep(true);
    startStep(spaceId, stepIndex);

    const step = activePlan.steps[stepIndex];
    try {
      const result = await toolExec.executeToolCall({
        name: step.action,
        params: step.params,
      });

      completeStep(spaceId, stepIndex, result);

      addMessage(spaceId, {
        role: 'assistant',
        content: `Step ${stepIndex + 1}: ${step.description}\n${result}`,
        timestamp: Date.now(),
      });

      // Check if more steps remain
      const nextIndex = activePlan.steps.findIndex((s, i) => i > stepIndex && s.status === 'pending');
      if (nextIndex !== -1) {
        addMessage(spaceId, {
          role: 'assistant',
          content: `Ready for step ${nextIndex + 1}. Click "Next Step" to continue or "Cancel" to stop.`,
          timestamp: Date.now(),
        });
      } else {
        addMessage(spaceId, {
          role: 'assistant',
          content: 'Plan completed successfully!',
          timestamp: Date.now(),
        });
        setTimeout(() => resetPlan(spaceId), 2000);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed';
      failStep(spaceId, stepIndex, error);

      addMessage(spaceId, {
        role: 'assistant',
        content: `Step ${stepIndex + 1} failed: ${error}`,
        timestamp: Date.now(),
      });
    } finally {
      setIsExecutingStep(false);
    }
  }, [activePlan, spaceId, startStep, completeStep, failStep, resetPlan, addMessage, toolExec]);

  const handleApprove = useCallback(() => {
    approvePlan(spaceId);
    if (activePlan) {
      addMessage(spaceId, {
        role: 'assistant',
        content: `Starting plan: "${activePlan.goal}"\nExecuting step 1...`,
        timestamp: Date.now(),
      });
      executeStep(0);
    }
  }, [spaceId, activePlan, approvePlan, addMessage, executeStep]);

  const handleContinue = useCallback(() => {
    if (!activePlan) return;
    const nextIndex = activePlan.steps.findIndex(s => s.status === 'pending');
    if (nextIndex === -1) return;

    const step = activePlan.steps[nextIndex];

    // For create steps with references, prefill ForgeTray for review
    if (step.action === 'create') {
      const referenceAssetIds = step.params.referenceAssetIds as string[] | undefined;
      const stepPrompt = step.params.prompt as string || '';

      if (referenceAssetIds && referenceAssetIds.length > 0) {
        // Prefill ForgeTray with references and prompt
        prefillFromStep(referenceAssetIds, stepPrompt, allAssets, allVariants);

        // Update step status to in_progress
        startStep(spaceId, nextIndex);

        // Track that this step is waiting for ForgeTray completion
        setForgeTrayStepIndex(nextIndex);

        // Inform user to review in ForgeTray
        const assetName = step.params.name as string || 'New Asset';
        addMessage(spaceId, {
          role: 'assistant',
          content: `Step ${nextIndex + 1}: ${step.description}\n\nForgeTray has been loaded with:\n• ${referenceAssetIds.length} reference image(s)\n• Prompt: "${stepPrompt.slice(0, 100)}${stepPrompt.length > 100 ? '...' : ''}"\n• Target: "${assetName}"\n\nReview and adjust in the ForgeTray below, then click Generate when ready.`,
          timestamp: Date.now(),
        });
        return;
      }
    }

    // For other steps, execute directly
    executeStep(nextIndex);
  }, [activePlan, executeStep, prefillFromStep, allAssets, allVariants, spaceId, startStep, addMessage]);

  const handleCancel = useCallback(() => {
    if (activePlan) {
      const completedCount = activePlan.steps.filter(s => s.status === 'completed').length;
      addMessage(spaceId, {
        role: 'assistant',
        content: `Plan cancelled. ${completedCount}/${activePlan.steps.length} steps were completed.`,
        timestamp: Date.now(),
      });
    }
    cancelPlan(spaceId);
  }, [spaceId, activePlan, cancelPlan, addMessage]);

  const handleReject = useCallback(() => {
    rejectPlan(spaceId);
  }, [spaceId, rejectPlan]);

  // ==========================================================================
  // Approval Handlers (Trust Zones)
  // ==========================================================================

  const handleApproveToolCall = useCallback(async (approvalId: string) => {
    const approval = approveApproval(spaceId, approvalId);
    if (!approval) return;

    // Convert approval to tool call and execute
    const toolCall = {
      name: approval.tool,
      params: approval.params,
    };

    try {
      const result = await toolExec.executeToolCall(toolCall);
      addMessage(spaceId, {
        role: 'assistant',
        content: `✅ Approved and executed: ${approval.description}\n${result}`,
        timestamp: Date.now(),
      });

      // Clear this approval from pending list
      const remaining = pendingApprovals.filter(a => a.id !== approvalId);
      setPendingApprovals(spaceId, remaining);
    } catch (err) {
      addMessage(spaceId, {
        role: 'assistant',
        content: `❌ Failed to execute ${approval.description}: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: Date.now(),
        isError: true,
      });
    }
  }, [spaceId, approveApproval, pendingApprovals, setPendingApprovals, toolExec, addMessage]);

  const handleRejectToolCall = useCallback((approvalId: string) => {
    const approval = pendingApprovals.find(a => a.id === approvalId);
    if (!approval) return;

    rejectApproval(spaceId, approvalId);

    // Remove from pending list
    const remaining = pendingApprovals.filter(a => a.id !== approvalId);
    setPendingApprovals(spaceId, remaining);

    addMessage(spaceId, {
      role: 'assistant',
      content: `❌ Rejected: ${approval.description}`,
      timestamp: Date.now(),
    });
  }, [spaceId, pendingApprovals, rejectApproval, setPendingApprovals, addMessage]);

  const handleApproveAll = useCallback(async () => {
    for (const approval of pendingApprovals) {
      await handleApproveToolCall(approval.id);
    }
  }, [pendingApprovals, handleApproveToolCall]);

  const handleRejectAll = useCallback(() => {
    clearPendingApprovals(spaceId);
    addMessage(spaceId, {
      role: 'assistant',
      content: `❌ Rejected all pending actions`,
      timestamp: Date.now(),
    });
  }, [spaceId, clearPendingApprovals, addMessage]);

  // ==========================================================================
  // Message Sending
  // ==========================================================================

  const sendMessage = useCallback(async (overrideMessage?: string, overrideMode?: 'advisor' | 'actor') => {
    const messageToSend = overrideMessage ?? inputValue.trim();
    const modeToUse = overrideMode ?? mode;

    if (!messageToSend || isLoading) return;

    if (!overrideMessage) {
      setInputBuffer(spaceId, '');
    }
    setIsLoading(true);

    addMessage(spaceId, {
      role: 'user',
      content: messageToSend,
      timestamp: Date.now(),
    });

    // Convert forge context to WebSocket format
    const wsForgeContext: WsForgeContext | undefined = forgeContext.slots.length > 0 ? {
      items: forgeContext.slots.map(s => ({
        assetId: s.assetId,
        assetName: s.assetName,
        assetType: allAssets.find(a => a.id === s.assetId)?.type || 'unknown',
        variantId: s.variantId,
      })),
      prompt: forgeContext.prompt,
    } : undefined;

    // Convert viewing context to WebSocket format
    const wsViewingContext: WsViewingContext | undefined = viewingContext.type === 'asset' ? {
      assetId: viewingContext.assetId,
      variantId: viewingContext.variantId,
    } : undefined;

    // Send via WebSocket - response handled by chatResponse effect
    const requestId = sendChatRequest({
      message: messageToSend,
      mode: modeToUse,
      forgeContext: wsForgeContext,
      viewingContext: wsViewingContext,
    });

    // Store pending request info for response handler
    pendingChatRequestRef.current = { requestId, messageToSend, modeToUse };
  }, [inputValue, isLoading, spaceId, mode, forgeContext, viewingContext, setInputBuffer, addMessage, sendChatRequest, allAssets]);

  const retryMessage = useCallback((payload: { message: string; mode: 'advisor' | 'actor' }) => {
    // Remove the last error message
    const updatedMessages = messages.filter(m => !m.isError);
    setMessages(spaceId, updatedMessages);
    sendMessage(payload.message, payload.mode);
  }, [messages, spaceId, setMessages, sendMessage]);

  const clearChat = useCallback(async () => {
    // Clear local state
    clearMessages(spaceId);
    // Clear server-side history
    try {
      await fetch(`/api/spaces/${spaceId}/chat/history`, {
        method: 'DELETE',
        credentials: 'include',
      });
    } catch (err) {
      console.error('Failed to clear server chat history:', err);
    }
  }, [spaceId, clearMessages]);

  const handleInputChange = useCallback((value: string) => {
    setInputBuffer(spaceId, value);
  }, [spaceId, setInputBuffer]);

  const handleModeChange = useCallback((newMode: 'advisor' | 'actor') => {
    setMode(spaceId, newMode);
  }, [spaceId, setMode]);

  // ==========================================================================
  // Plan state adapter for PlanPanel
  // ==========================================================================

  const planState = useMemo(() => {
    if (planStatus === 'idle' || !activePlan) {
      return { status: 'idle' as const };
    }
    if (planStatus === 'awaiting_approval') {
      return { status: 'awaiting_approval' as const, plan: activePlan };
    }
    if (planStatus === 'executing') {
      return { status: 'executing' as const, plan: activePlan, currentStep: activePlan.currentStepIndex };
    }
    if (planStatus === 'paused') {
      return { status: 'paused' as const, plan: activePlan, currentStep: activePlan.currentStepIndex };
    }
    if (planStatus === 'completed') {
      return { status: 'completed' as const, plan: activePlan };
    }
    if (planStatus === 'failed') {
      return { status: 'failed' as const, plan: activePlan, error: 'Plan failed' };
    }
    return { status: 'idle' as const };
  }, [planStatus, activePlan]);

  // ==========================================================================
  // Render
  // ==========================================================================

  if (!isOpen) return null;

  const isExecuting = planStatus === 'executing' || isExecutingStep;

  return (
    <div className={styles.sidebar}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <svg className={styles.headerIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="20" height="20">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          <h3>Assistant</h3>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.settingsButton}
            onClick={() => setShowPreferences(true)}
            title="Preferences"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          </button>
          <button className={styles.closeButton} onClick={onClose} title="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Context Bar - Shows what the bot can see */}
      <div className={styles.contextBar}>
        {viewingContext.type === 'asset' && viewingContext.assetName ? (
          <div className={styles.contextAsset}>
            {/* Thumbnail of current variant */}
            {(() => {
              const variant = currentVariant || allVariants.find(v => v.id === viewingContext.variantId);
              const thumbUrl = variant ? getVariantThumbnailUrl(variant) : null;
              return thumbUrl ? (
                <img
                  src={thumbUrl}
                  alt={viewingContext.assetName}
                  className={styles.contextThumb}
                />
              ) : (
                <div className={styles.contextThumbPlaceholder}>🖼️</div>
              );
            })()}
            <div className={styles.contextAssetInfo}>
              <span className={styles.contextAssetName}>{viewingContext.assetName}</span>
              <span className={styles.contextVariantInfo}>
                Variant {viewingContext.variantIndex || 1} of {viewingContext.variantCount || 1}
              </span>
              <span className={styles.contextBotAccess}>
                Bot can analyze this image
              </span>
            </div>
          </div>
        ) : (
          <div className={styles.contextCatalog}>
            <span className={styles.contextIcon}>📁</span>
            <span>Viewing: Catalog ({allAssets.length} assets)</span>
          </div>
        )}

        {/* Forge tray context */}
        {forgeContext.slots.length > 0 && (
          <div className={styles.contextItem}>
            <span className={styles.contextIcon}>🔥</span>
            <span className={styles.contextLabel}>
              Tray: {forgeContext.slots.map(s => s.assetName).join(', ')}
            </span>
          </div>
        )}
        {forgeContext.prompt && (
          <div className={styles.contextItem}>
            <span className={styles.contextIcon}>✏️</span>
            <span className={styles.contextLabel}>
              Prompt: "{forgeContext.prompt.slice(0, 30)}{forgeContext.prompt.length > 30 ? '...' : ''}"
            </span>
          </div>
        )}
      </div>

      {/* Plan Panel */}
      <PlanPanel
        planState={planState}
        isExecuting={isExecuting}
        onApprove={handleApprove}
        onReject={handleReject}
        onContinue={handleContinue}
        onCancel={handleCancel}
      />

      {/* Approval Panel (Trust Zones) */}
      {pendingApprovals.length > 0 && (
        <div className={styles.approvalPanel}>
          <div className={styles.approvalHeader}>
            <span className={styles.approvalIcon}>⏳</span>
            <span className={styles.approvalTitle}>
              {pendingApprovals.length} action{pendingApprovals.length > 1 ? 's' : ''} awaiting approval
            </span>
          </div>
          <div className={styles.approvalList}>
            {pendingApprovals.map(approval => (
              <div key={approval.id} className={styles.approvalItem}>
                <div className={styles.approvalDescription}>
                  <span className={styles.approvalTool}>{approval.description}</span>
                  {typeof approval.params.prompt === 'string' && approval.params.prompt && (
                    <span className={styles.approvalPrompt}>
                      "{approval.params.prompt.slice(0, 50)}
                      {approval.params.prompt.length > 50 ? '...' : ''}"
                    </span>
                  )}
                </div>
                <div className={styles.approvalActions}>
                  <button
                    className={styles.approveButton}
                    onClick={() => handleApproveToolCall(approval.id)}
                    title="Approve"
                  >
                    ✓
                  </button>
                  <button
                    className={styles.rejectButton}
                    onClick={() => handleRejectToolCall(approval.id)}
                    title="Reject"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
          {pendingApprovals.length > 1 && (
            <div className={styles.approvalBulkActions}>
              <button
                className={styles.approveAllButton}
                onClick={handleApproveAll}
              >
                Approve All
              </button>
              <button
                className={styles.rejectAllButton}
                onClick={handleRejectAll}
              >
                Reject All
              </button>
            </div>
          )}
        </div>
      )}

      {/* Message List */}
      <MessageList
        messages={messages}
        isLoading={isLoading}
        isLoadingHistory={isLoadingHistory}
        isAutoReviewing={isAutoReviewing}
        onRetry={retryMessage}
        onSuggestionClick={handleInputChange}
      />

      {/* Chat Input */}
      <ChatInput
        value={inputValue}
        onChange={handleInputChange}
        onSend={() => sendMessage()}
        onClear={clearChat}
        mode={mode}
        onModeChange={handleModeChange}
        disabled={isLoading || isExecuting}
        showClear={messages.length > 0}
      />

      {/* Preferences Panel */}
      <PreferencesPanel
        isOpen={showPreferences}
        onClose={() => setShowPreferences(false)}
      />
    </div>
  );
}
