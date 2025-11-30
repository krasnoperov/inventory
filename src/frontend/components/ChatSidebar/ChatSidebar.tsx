import { useState, useCallback, useEffect, useMemo } from 'react';
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
import { type Asset, type Variant, getVariantThumbnailUrl } from '../../hooks/useSpaceWebSocket';
import {
  isLimitErrorResponse,
  type ForgeContext,
  type ViewingContext,
  type BotResponse,
  type LimitErrorResponse,
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
  onGenerateAsset?: (params: { name: string; type: string; prompt: string; parentAssetId?: string; referenceAssetIds?: string[] }) => Promise<string | void>;
  onRefineAsset?: (params: { assetId: string; prompt: string }) => Promise<string | void>;
  onCombineAssets?: (params: { sourceAssetIds: string[]; prompt: string; targetName: string; targetType: string }) => Promise<string | void>;
  lastCompletedJob?: JobCompletionData | null;
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
    setLastAutoExecuted,
  } = useChatStore();

  // Local state (transient - not persisted)
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isAutoReviewing, setIsAutoReviewing] = useState(false);
  const [isExecutingStep, setIsExecutingStep] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  // Track which meters have shown 90% warning this session
  const [warnedMeters, setWarnedMeters] = useState<Set<string>>(new Set());
  // Track plan step waiting for ForgeTray completion (step index, or null if none)
  const [forgeTrayStepIndex, setForgeTrayStepIndex] = useState<number | null>(null);

  // Usage tracking for 90% warnings
  const { meters, refresh: refreshUsage } = useLimitedUsage();

  // Tool execution hook
  const toolExec = useToolExecution({
    spaceId,
    allAssets,
    allVariants,
    onGenerateAsset,
    onRefineAsset,
    onCombineAssets,
  });

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
    // Only load from server if we don't have messages in store
    if (messages.length > 0 || historyLoaded) {
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
      setHistoryLoaded(true);
    }
  }, [spaceId, messages.length, historyLoaded, setMessages]);

  useEffect(() => {
    if (isOpen && spaceId) {
      loadChatHistory();
    }
  }, [isOpen, spaceId, loadChatHistory]);

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

      try {
        const response = await fetch(`/api/spaces/${spaceId}/chat/describe`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            variantId: lastCompletedJob.variantId,
            assetName: jobInfo.assetName,
            focus: 'general',
          }),
        });

        if (response.ok) {
          const data = await response.json() as { success: boolean; description: string };
          const reviewMessage = `**Review of "${jobInfo.assetName}":**\n\n${data.description}\n\n**Original prompt:** "${jobInfo.prompt.slice(0, 100)}${jobInfo.prompt.length > 100 ? '...' : ''}"`;

          addMessage(spaceId, {
            role: 'assistant',
            content: reviewMessage,
            timestamp: Date.now(),
          });
        } else {
          addMessage(spaceId, {
            role: 'assistant',
            content: `Generated "${jobInfo.assetName}" successfully! (Auto-review unavailable)`,
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        console.error('Auto-review failed:', err);
        addMessage(spaceId, {
          role: 'assistant',
          content: `Generated "${jobInfo.assetName}" successfully!`,
          timestamp: Date.now(),
        });
      } finally {
        setIsAutoReviewing(false);
      }
    };

    autoReviewJob();
  }, [lastCompletedJob, isOpen, spaceId, toolExec, addMessage, allVariants]);

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

    // For generate_asset steps with references, prefill ForgeTray for review
    if (step.action === 'generate_asset') {
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

    try {
      const response = await fetch(`/api/spaces/${spaceId}/chat`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: messageToSend,
          mode: modeToUse,
          history: messages.slice(-10).map(m => ({
            role: m.role,
            content: m.content,
          })),
          forgeContext,
          viewingContext,
          activePlan,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();

        // Handle billing errors (402 quota exceeded, 429 rate limited)
        // @see LimitErrorResponse in api/types.ts
        // @see PreCheckResult in usageService.ts for backend implementation
        if (isLimitErrorResponse(errorData)) {
          const limitError = errorData as LimitErrorResponse;

          if (limitError.denyReason === 'quota_exceeded') {
            // HTTP 402: Show upgrade CTA, link to billing portal
            addMessage(spaceId, {
              role: 'assistant',
              content: limitError.message,
              timestamp: Date.now(),
              isError: true,
              quotaError: {
                service: 'claude',
                used: limitError.quota.used,
                limit: limitError.quota.limit,
              },
            });
            return; // Don't retry quota errors - user must upgrade
          }

          if (limitError.denyReason === 'rate_limited') {
            // HTTP 429: Show countdown timer until resetsAt
            const resetsAt = limitError.rateLimit.resetsAt;
            const remainingSeconds = resetsAt
              ? Math.max(0, Math.ceil((new Date(resetsAt).getTime() - Date.now()) / 1000))
              : 60; // Default to 60s if no reset time provided

            addMessage(spaceId, {
              role: 'assistant',
              content: limitError.message,
              timestamp: Date.now(),
              isError: true,
              rateLimitError: {
                resetsAt,
                remainingSeconds,
              },
            });
            return; // Don't retry rate limit errors - user must wait
          }
        }

        throw new Error((errorData as { error?: string }).error || 'Failed to send message');
      }

      const data = await response.json() as { success: boolean; response: BotResponse };
      const botResponse = data.response;

      if (botResponse.type === 'plan' && botResponse.plan) {
        setPlan(spaceId, botResponse.plan);
        addMessage(spaceId, {
          role: 'assistant',
          content: botResponse.message,
          timestamp: Date.now(),
        });
      } else if (botResponse.type === 'action') {
        // Trust Zones: Handle auto-execute vs pending approvals
        const messageParts: string[] = [botResponse.message];

        // Auto-execute safe tools (toolCalls)
        if (botResponse.toolCalls && botResponse.toolCalls.length > 0) {
          const results = await toolExec.executeToolCalls(botResponse.toolCalls);
          messageParts.push('\n**Auto-executed:**');
          messageParts.push(results.join('\n'));

          // Store results in state for reference
          setLastAutoExecuted(spaceId, botResponse.toolCalls.map((tc, i) => ({
            tool: tc.name,
            params: tc.params,
            result: results[i],
            success: results[i].startsWith('✅'),
          })));
        }

        // Store pending approvals for generating tools
        if (botResponse.pendingApprovals && botResponse.pendingApprovals.length > 0) {
          setPendingApprovals(spaceId, botResponse.pendingApprovals);
          messageParts.push('\n**Awaiting approval:**');
          botResponse.pendingApprovals.forEach(pa => {
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
          content: botResponse.message,
          timestamp: Date.now(),
        });
      }

      // Check for 90% usage warning after successful response
      // Invalidate cache and refresh to get updated usage
      invalidateUsageCache();
      await refreshUsage();

      // Check if any meter crossed 90% and hasn't been warned yet
      for (const meter of meters) {
        if (meter.percentUsed >= 90 && !warnedMeters.has(meter.name)) {
          setWarnedMeters(prev => new Set(prev).add(meter.name));
          addMessage(spaceId, {
            role: 'assistant',
            content: `⚠️ You've used ${Math.round(meter.percentUsed)}% of your ${formatMeterName(meter.name)} this month.`,
            timestamp: Date.now(),
          });
          break; // Only show one warning at a time
        }
      }
    } catch (err) {
      console.error('Chat error:', err);

      let errorMessage: string;
      let isRetryable = false;

      if (err instanceof TypeError && err.message.includes('fetch')) {
        errorMessage = 'Network error. Please check your connection and try again.';
        isRetryable = true;
      } else if (err instanceof Error) {
        if (err.message.includes('rate limit') || err.message.includes('429')) {
          errorMessage = 'Too many requests. Please wait a moment and try again.';
          isRetryable = true;
        } else if (err.message.includes('503') || err.message.includes('unavailable')) {
          errorMessage = 'Service temporarily unavailable. Please try again in a moment.';
          isRetryable = true;
        } else if (err.message.includes('401') || err.message.includes('authentication')) {
          errorMessage = 'Session expired. Please refresh the page and sign in again.';
        } else if (err.message.includes('403')) {
          errorMessage = 'You don\'t have permission to perform this action.';
        } else {
          errorMessage = err.message;
          isRetryable = true;
        }
      } else {
        errorMessage = 'An unexpected error occurred. Please try again.';
        isRetryable = true;
      }

      addMessage(spaceId, {
        role: 'assistant',
        content: errorMessage,
        timestamp: Date.now(),
        isError: true,
        retryPayload: isRetryable ? { message: messageToSend, mode: modeToUse } : undefined,
      });
    } finally {
      setIsLoading(false);
    }
  }, [inputValue, isLoading, spaceId, mode, messages, forgeContext, viewingContext, activePlan, setInputBuffer, addMessage, setPlan, toolExec, meters, warnedMeters, refreshUsage]);

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
          <span className={styles.botIcon}>🤖</span>
          <h3>Forge Assistant</h3>
        </div>
        <button
          className={styles.settingsButton}
          onClick={() => setShowPreferences(true)}
          title="Preferences"
        >
          &#9881;
        </button>
        <button className={styles.closeButton} onClick={onClose} title="Close chat">
          ×
        </button>
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
