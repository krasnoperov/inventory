import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useForgeTrayStore } from '../../stores/forgeTrayStore';
import {
  useChatStore,
  useChatMessages,
  useChatInputBuffer,
  useChatMode,
  useChatPlan,
  usePendingApprovals,
  useLastAutoExecuted,
  useShowPreferencesPanel,
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
  type ForgeOperation,
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
  // Forge operations (matching ForgeTray UI)
  onGenerate?: (params: { name: string; type: string; prompt: string; parentAssetId?: string }) => string | void;
  onFork?: (params: { sourceAssetId: string; name: string; type: string; parentAssetId?: string }) => void;
  onDerive?: (params: { name: string; type: string; prompt: string; referenceAssetIds: string[]; parentAssetId?: string }) => string | void;
  onRefine?: (params: { assetId: string; prompt: string }) => string | void;
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
  /** WebSocket method to approve a pending approval (notifies server) */
  wsApproveApproval?: (approvalId: string) => void;
  /** WebSocket method to reject a pending approval (notifies server) */
  wsRejectApproval?: (approvalId: string) => void;
  /** WebSocket method to start a new chat session */
  wsStartNewSession?: () => void;
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
  onGenerate,
  onFork,
  onDerive,
  onRefine,
  lastCompletedJob,
  sendChatRequest,
  chatResponse,
  sendDescribeRequest,
  sendCompareRequest,
  describeResponse,
  compareResponse,
  wsApproveApproval,
  wsRejectApproval,
  wsStartNewSession,
}: ChatSidebarProps) {
  // Store state (persisted) - use hooks that don't recreate selectors
  const messages = useChatMessages(spaceId);
  const inputValue = useChatInputBuffer(spaceId);
  const mode = useChatMode(spaceId);
  const activePlan = useChatPlan(spaceId);
  const pendingApprovals = usePendingApprovals(spaceId);
  const lastAutoExecuted = useLastAutoExecuted(spaceId);
  const showPreferences = useShowPreferencesPanel(spaceId);

  // Store actions
  const {
    setMessages,
    addMessage,
    replaceMessage,
    clearMessages,
    setInputBuffer,
    setMode,
    clearPlan,
    // Trust zone actions
    setPendingApprovals,
    approveApproval,
    rejectApproval,
    clearPendingApprovals,
    setLastAutoExecuted,
    // Preferences panel
    setShowPreferencesPanel,
  } = useChatStore();

  // Local state (transient - not persisted)
  const [isLoading, setIsLoading] = useState(false);
  const [isAutoReviewing, setIsAutoReviewing] = useState(false);
  const [_isRecovering, setIsRecovering] = useState(false); // eslint-disable-line @typescript-eslint/no-unused-vars
  // Track which meters have shown 90% warning this session
  const [warnedMeters, setWarnedMeters] = useState<Set<string>>(new Set());
  const warnedMetersRef = useRef(warnedMeters);
  // Track pending WebSocket chat request
  const pendingChatRequestRef = useRef<{ requestId: string; messageToSend: string; modeToUse: 'advisor' | 'actor' } | null>(null);
  // Track pending auto-review request
  const pendingAutoReviewRef = useRef<{ requestId: string; assetName: string; prompt: string } | null>(null);
  // Track if last request was a recovery attempt (to prevent infinite loops)
  const isRecoveryAttemptRef = useRef(false);

  // Usage tracking for 90% warnings
  const { meters, refresh: refreshUsage } = useLimitedUsage();
  const metersRef = useRef(meters);

  // Ref for sendChatRequest used in chatResponse effect without triggering re-runs
  const sendChatRequestRef = useRef(sendChatRequest);

  // Update refs in effect to avoid accessing during render
  useEffect(() => {
    warnedMetersRef.current = warnedMeters;
    metersRef.current = meters;
    sendChatRequestRef.current = sendChatRequest;
  });

  // Tool execution hook
  const toolExec = useToolExecution({
    allAssets,
    allVariants,
    onGenerate,
    onFork,
    onDerive,
    onRefine,
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- responding to external WebSocket data
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
  const _prefillFromStep = useForgeTrayStore((state) => state.prefillFromStep); // eslint-disable-line @typescript-eslint/no-unused-vars

  // Build forge context
  const forgeContext = useMemo<ForgeContext>(() => {
    const slotCount = slots.length;
    // Determine operation based on slot count and prompt
    const operation: ForgeOperation =
      slotCount === 0 ? 'generate' :
      slotCount === 1 ? (prompt ? 'refine' : 'fork') :
      'derive';

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

  // Refs for forgeContext and viewingContext used in chatResponse effect
  const forgeContextRef = useRef(forgeContext);
  const viewingContextRef = useRef(viewingContext);

  // Update context refs in effect to avoid accessing during render
  useEffect(() => {
    forgeContextRef.current = forgeContext;
    viewingContextRef.current = viewingContext;
  });

  // Chat history is now loaded via WebSocket in SpacePage/AssetDetailPage
  // See onChatHistory callback in useSpaceWebSocket

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
  // WebSocket Chat Response Handler
  // ==========================================================================

  useEffect(() => {
    if (!chatResponse || !pendingChatRequestRef.current) return;

    // Check if this response matches our pending request
    if (chatResponse.requestId !== pendingChatRequestRef.current.requestId) return;

    const { messageToSend, modeToUse } = pendingChatRequestRef.current;
    pendingChatRequestRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- responding to external WebSocket data
    setIsLoading(false);

    if (!chatResponse.success) {
      const errorMessage = chatResponse.error || 'Failed to process message';

      // Add error message
      addMessage(spaceId, {
        role: 'assistant',
        content: errorMessage,
        timestamp: Date.now(),
        isError: true,
        retryPayload: { message: messageToSend, mode: modeToUse },
      });

      // Trigger LLM-based recovery in actor mode (if not already recovering)
      if (modeToUse === 'actor' && !isRecoveryAttemptRef.current && sendChatRequestRef.current) {
        isRecoveryAttemptRef.current = true;
        setIsRecovering(true);

        // Build recovery prompt
        const recoveryPrompt = `My last request failed with error: "${errorMessage}"

The original request was: "${messageToSend}"

Please suggest an alternative approach or modified parameters that might work. If this seems like a temporary issue (rate limit, service unavailable), just say so. Otherwise, provide a concrete alternative I can try.`;

        // Add recovery request message
        addMessage(spaceId, {
          role: 'user',
          content: '🔄 Analyzing failure and suggesting alternatives...',
          timestamp: Date.now(),
        });

        // Send recovery request in advisor mode
        const currentForgeContext = forgeContextRef.current;
        const wsForgeContext: WsForgeContext = {
          operation: currentForgeContext.operation as WsForgeContext['operation'],
          slots: currentForgeContext.slots.map(s => ({
            assetId: s.assetId,
            assetName: s.assetName,
            variantId: s.variantId,
          })),
          prompt: currentForgeContext.prompt,
        };

        const recoveryRequestId = sendChatRequestRef.current({
          message: recoveryPrompt,
          mode: 'advisor', // Use advisor mode for recovery suggestions
          forgeContext: wsForgeContext,
          viewingContext: viewingContextRef.current,
        });

        pendingChatRequestRef.current = {
          requestId: recoveryRequestId,
          messageToSend: recoveryPrompt,
          modeToUse: 'advisor',
        };
        setIsLoading(true);
      } else {
        isRecoveryAttemptRef.current = false;
        setIsRecovering(false);
      }
      return;
    }

    // Reset recovery flag on success
    isRecoveryAttemptRef.current = false;
    setIsRecovering(false);

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

    // Process the bot response
    if (botResponse.type === 'action') {
      // TypeScript narrows to ActorResponse
      const messageParts: string[] = [botResponse.message || ''];

      // Auto-execute safe tools (toolCalls)
      if (botResponse.toolCalls && botResponse.toolCalls.length > 0) {
        // Show immediate loading message so user knows something is happening
        const toolNames = botResponse.toolCalls.map(t => t.name).join(', ');
        const loadingMsgId = `loading-${Date.now()}`;
        addMessage(spaceId, {
          id: loadingMsgId,
          role: 'assistant',
          content: `${messageParts[0] ? messageParts[0] + '\n\n' : ''}⏳ *Executing: ${toolNames}...*`,
          timestamp: Date.now(),
        });

        toolExec.executeToolCalls(botResponse.toolCalls).then(results => {
          const updatedParts = [...messageParts, '\n**Auto-executed:**', results.join('\n')];
          // Replace loading message with results
          replaceMessage(spaceId, loadingMsgId, {
            role: 'assistant',
            content: updatedParts.join('\n'),
            timestamp: Date.now(),
          });
        }).catch(err => {
          // Replace loading message with error
          replaceMessage(spaceId, loadingMsgId, {
            role: 'assistant',
            content: `${messageParts[0] ? messageParts[0] + '\n\n' : ''}❌ Tool execution failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
            timestamp: Date.now(),
          });
        });
        return;
      }

      // Store pending approvals
      if (botResponse.pendingApprovals && botResponse.pendingApprovals.length > 0) {
        setPendingApprovals(spaceId, botResponse.pendingApprovals);
        messageParts.push('\n**Awaiting approval:**');
        botResponse.pendingApprovals.forEach((pa) => {
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
  }, [chatResponse, spaceId, addMessage, setPendingApprovals, toolExec, refreshUsage]);

  // ==========================================================================
  // Simple Plan Handler
  // ==========================================================================

  const handleClearPlan = useCallback(() => {
    clearPlan(spaceId);
    addMessage(spaceId, {
      role: 'assistant',
      content: 'Plan cleared.',
      timestamp: Date.now(),
    });
  }, [spaceId, clearPlan, addMessage]);

  // ==========================================================================
  // Approval Handlers (Trust Zones)
  // ==========================================================================

  const handleApproveToolCall = useCallback(async (approvalId: string) => {
    const approval = approveApproval(spaceId, approvalId);
    if (!approval) return;

    // Notify server of approval (will broadcast to all clients)
    if (wsApproveApproval) {
      wsApproveApproval(approvalId);
    }

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

      // Clear this approval from pending list (server update will also sync this)
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
  }, [spaceId, approveApproval, pendingApprovals, setPendingApprovals, toolExec, addMessage, wsApproveApproval]);

  const handleRejectToolCall = useCallback((approvalId: string) => {
    const approval = pendingApprovals.find(a => a.id === approvalId);
    if (!approval) return;

    // Notify server of rejection (will broadcast to all clients)
    if (wsRejectApproval) {
      wsRejectApproval(approvalId);
    }

    rejectApproval(spaceId, approvalId);

    // Remove from pending list (server update will also sync this)
    const remaining = pendingApprovals.filter(a => a.id !== approvalId);
    setPendingApprovals(spaceId, remaining);

    addMessage(spaceId, {
      role: 'assistant',
      content: `❌ Rejected: ${approval.description}`,
      timestamp: Date.now(),
    });
  }, [spaceId, pendingApprovals, rejectApproval, setPendingApprovals, addMessage, wsRejectApproval]);

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

    // Convert forge context to WebSocket format (same shape as api/types ForgeContext)
    const wsForgeContext: WsForgeContext = {
      operation: forgeContext.operation as WsForgeContext['operation'],
      slots: forgeContext.slots.map(s => ({
        assetId: s.assetId,
        assetName: s.assetName,
        variantId: s.variantId,
      })),
      prompt: forgeContext.prompt,
    };

    // ViewingContext is now unified - just pass it directly
    const wsViewingContext: WsViewingContext = viewingContext;

    // Send via WebSocket - response handled by chatResponse effect
    const requestId = sendChatRequest({
      message: messageToSend,
      mode: modeToUse,
      forgeContext: wsForgeContext,
      viewingContext: wsViewingContext,
    });

    // Store pending request info for response handler
    pendingChatRequestRef.current = { requestId, messageToSend, modeToUse };
  }, [inputValue, isLoading, spaceId, mode, forgeContext, viewingContext, setInputBuffer, addMessage, sendChatRequest]);

  const retryMessage = useCallback((payload: { message: string; mode: 'advisor' | 'actor' }) => {
    // Remove the last error message
    const updatedMessages = messages.filter(m => !m.isError);
    setMessages(spaceId, updatedMessages);
    sendMessage(payload.message, payload.mode);
  }, [messages, spaceId, setMessages, sendMessage]);

  // Start a new chat session (replaces "Clear" functionality)
  const startNewChat = useCallback(() => {
    if (wsStartNewSession) {
      // Server will create new session and send chat:session_created
      // which triggers onSessionCreated callback to clear local messages
      wsStartNewSession();
    } else {
      // Fallback: just clear local state if WebSocket method not available
      clearMessages(spaceId);
    }
  }, [spaceId, clearMessages, wsStartNewSession]);

  const handleInputChange = useCallback((value: string) => {
    setInputBuffer(spaceId, value);
  }, [spaceId, setInputBuffer]);

  const handleModeChange = useCallback((newMode: 'advisor' | 'actor') => {
    setMode(spaceId, newMode);
  }, [spaceId, setMode]);

  // ==========================================================================
  // Render
  // ==========================================================================

  if (!isOpen) return null;

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
            onClick={() => setShowPreferencesPanel(spaceId, true)}
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

      {/* Plan Panel (simple markdown display) */}
      <PlanPanel
        plan={activePlan}
        onClear={handleClearPlan}
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

      {/* Auto-Executed Panel (safe tools that ran automatically) */}
      {lastAutoExecuted.length > 0 && (
        <div className={styles.autoExecutedPanel}>
          <div className={styles.autoExecutedHeader}>
            <span className={styles.autoExecutedIcon}>⚡</span>
            <span className={styles.autoExecutedTitle}>
              {lastAutoExecuted.length} tool{lastAutoExecuted.length > 1 ? 's' : ''} auto-executed
            </span>
            <button
              className={styles.dismissAutoExecuted}
              onClick={() => setLastAutoExecuted(spaceId, [])}
              title="Dismiss"
            >
              ✕
            </button>
          </div>
          <div className={styles.autoExecutedList}>
            {lastAutoExecuted.map((item, idx) => (
              <div key={idx} className={`${styles.autoExecutedItem} ${item.success ? styles.success : styles.error}`}>
                <span className={styles.autoExecutedToolName}>{item.tool}</span>
                {item.success ? (
                  <span className={styles.autoExecutedResult}>
                    {typeof item.result === 'string'
                      ? item.result.slice(0, 100) + (item.result.length > 100 ? '...' : '')
                      : JSON.stringify(item.result).slice(0, 100)}
                  </span>
                ) : (
                  <span className={styles.autoExecutedError}>{item.error || 'Failed'}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Message List */}
      <MessageList
        messages={messages}
        isLoading={isLoading}
        isAutoReviewing={isAutoReviewing}
        onRetry={retryMessage}
        onSuggestionClick={handleInputChange}
      />

      {/* Chat Input */}
      <ChatInput
        value={inputValue}
        onChange={handleInputChange}
        onSend={() => sendMessage()}
        onNewChat={startNewChat}
        mode={mode}
        onModeChange={handleModeChange}
        disabled={isLoading}
        showNewChat={messages.length > 0}
      />

      {/* Preferences Panel */}
      <PreferencesPanel
        isOpen={showPreferences}
        onClose={() => setShowPreferencesPanel(spaceId, false)}
      />
    </div>
  );
}
