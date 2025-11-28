import { useState, useCallback, useEffect, useMemo } from 'react';
import { useForgeTrayStore } from '../../stores/forgeTrayStore';
import type { Asset, Variant } from '../../hooks/useSpaceWebSocket';
import type {
  ForgeContext,
  ViewingContext,
  BotResponse,
} from '../../../api/types';
import { usePlanState } from './hooks/usePlanState';
import { useToolExecution } from './hooks/useToolExecution';
import { MessageList, type ChatMessage } from './MessageList';
import { PlanPanel } from './PlanPanel';
import { ChatInput } from './ChatInput';
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
}

export interface ChatSidebarProps {
  spaceId: string;
  isOpen: boolean;
  onClose: () => void;
  currentAsset?: Asset | null;
  allAssets?: Asset[];
  allVariants?: Variant[];
  onGenerateAsset?: (params: { name: string; type: string; prompt: string; parentAssetId?: string }) => Promise<string | void>;
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
  allAssets = [],
  allVariants = [],
  onGenerateAsset,
  onRefineAsset,
  onCombineAssets,
  lastCompletedJob,
}: ChatSidebarProps) {
  // Local state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [mode, setMode] = useState<'advisor' | 'actor'>('actor');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isAutoReviewing, setIsAutoReviewing] = useState(false);

  // Extracted hooks
  const plan = usePlanState();
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

  // Build viewing context
  const viewingContext = useMemo<ViewingContext>(() => {
    if (currentAsset) {
      return {
        type: 'asset',
        assetId: currentAsset.id,
        assetName: currentAsset.name,
      };
    }
    return { type: 'catalog' };
  }, [currentAsset]);

  // ==========================================================================
  // Chat History
  // ==========================================================================

  const loadChatHistory = useCallback(async () => {
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

        if (data.success && data.messages) {
          const formattedMessages: ChatMessage[] = data.messages.map(msg => ({
            role: msg.sender_type === 'user' ? 'user' : 'assistant',
            content: msg.content,
            timestamp: msg.created_at,
          }));
          setMessages(formattedMessages);
        }
      }
    } catch (err) {
      console.error('Failed to load chat history:', err);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [spaceId]);

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

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Generation complete for "${jobInfo.assetName}"! Let me review the result...`,
        timestamp: Date.now(),
      }]);

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

          setMessages(prev => [...prev, {
            role: 'assistant',
            content: reviewMessage,
            timestamp: Date.now(),
          }]);
        } else {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `Generated "${jobInfo.assetName}" successfully! (Auto-review unavailable)`,
            timestamp: Date.now(),
          }]);
        }
      } catch (err) {
        console.error('Auto-review failed:', err);
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Generated "${jobInfo.assetName}" successfully!`,
          timestamp: Date.now(),
        }]);
      } finally {
        setIsAutoReviewing(false);
      }
    };

    autoReviewJob();
  }, [lastCompletedJob, isOpen, spaceId, toolExec]);

  // ==========================================================================
  // Plan Execution
  // ==========================================================================

  const [isExecutingStep, setIsExecutingStep] = useState(false);

  const executeStep = useCallback(async (stepIndex: number) => {
    if (!plan.activePlan) return;

    setIsExecutingStep(true);
    plan.startStep(stepIndex);

    const step = plan.activePlan.steps[stepIndex];
    try {
      const result = await toolExec.executeToolCall({
        name: step.action,
        params: step.params,
      });

      plan.completeStep(stepIndex, result);

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Step ${stepIndex + 1}: ${step.description}\n${result}`,
        timestamp: Date.now(),
      }]);

      // Check if more steps remain
      const nextIndex = plan.activePlan.steps.findIndex((s, i) => i > stepIndex && s.status === 'pending');
      if (nextIndex !== -1) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Ready for step ${nextIndex + 1}. Click "Next Step" to continue or "Cancel" to stop.`,
          timestamp: Date.now(),
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: 'Plan completed successfully!',
          timestamp: Date.now(),
        }]);
        setTimeout(() => plan.reset(), 2000);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed';
      plan.failStep(stepIndex, error);

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Step ${stepIndex + 1} failed: ${error}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setIsExecutingStep(false);
    }
  }, [plan, toolExec]);

  const handleApprove = useCallback(() => {
    plan.approve();
    if (plan.activePlan) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Starting plan: "${plan.activePlan!.goal}"\nExecuting step 1...`,
        timestamp: Date.now(),
      }]);
      executeStep(0);
    }
  }, [plan, executeStep]);

  const handleContinue = useCallback(() => {
    if (plan.nextPendingStepIndex !== -1) {
      executeStep(plan.nextPendingStepIndex);
    }
  }, [plan.nextPendingStepIndex, executeStep]);

  const handleCancel = useCallback(() => {
    if (plan.activePlan) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Plan cancelled. ${plan.completedStepCount}/${plan.activePlan!.steps.length} steps were completed.`,
        timestamp: Date.now(),
      }]);
    }
    plan.cancel();
  }, [plan]);

  // ==========================================================================
  // Message Sending
  // ==========================================================================

  const sendMessage = useCallback(async (overrideMessage?: string, overrideMode?: 'advisor' | 'actor') => {
    const messageToSend = overrideMessage ?? inputValue.trim();
    const modeToUse = overrideMode ?? mode;

    if (!messageToSend || isLoading) return;

    if (!overrideMessage) {
      setInputValue('');
    }
    setIsLoading(true);

    setMessages(prev => [...prev, {
      role: 'user',
      content: messageToSend,
      timestamp: Date.now(),
    }]);

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
          activePlan: plan.activePlan,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || 'Failed to send message');
      }

      const data = await response.json() as { success: boolean; response: BotResponse };
      const botResponse = data.response;

      if (botResponse.type === 'plan' && botResponse.plan) {
        plan.setPlan(botResponse.plan);
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: botResponse.message,
          timestamp: Date.now(),
        }]);
      } else if (botResponse.type === 'action' && botResponse.toolCalls) {
        const results = await toolExec.executeToolCalls(botResponse.toolCalls);
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `${botResponse.message}\n\n${results.join('\n')}`,
          timestamp: Date.now(),
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: botResponse.message,
          timestamp: Date.now(),
        }]);
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

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: errorMessage,
        timestamp: Date.now(),
        isError: true,
        retryPayload: isRetryable ? { message: messageToSend, mode: modeToUse } : undefined,
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [inputValue, isLoading, spaceId, mode, messages, forgeContext, viewingContext, plan, toolExec]);

  const retryMessage = useCallback((payload: { message: string; mode: 'advisor' | 'actor' }) => {
    setMessages(prev => prev.filter(m => !m.isError));
    sendMessage(payload.message, payload.mode);
  }, [sendMessage]);

  const clearChat = useCallback(() => {
    setMessages([]);
    plan.reset();
  }, [plan]);

  // ==========================================================================
  // Render
  // ==========================================================================

  if (!isOpen) return null;

  const isExecuting = plan.isExecuting || isExecutingStep;

  return (
    <div className={styles.sidebar}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <span className={styles.botIcon}>🤖</span>
          <h3>Forge Assistant</h3>
        </div>
        <button className={styles.closeButton} onClick={onClose} title="Close chat">
          ×
        </button>
      </div>

      {/* Context Bar */}
      <div className={styles.contextBar}>
        <div className={styles.contextItem}>
          <span className={styles.contextIcon}>📍</span>
          <span className={styles.contextLabel}>
            {viewingContext.type === 'asset'
              ? `Viewing: ${viewingContext.assetName}`
              : 'Viewing: Catalog'}
          </span>
        </div>
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
        planState={plan.state}
        isExecuting={isExecuting}
        onApprove={handleApprove}
        onReject={plan.reject}
        onContinue={handleContinue}
        onCancel={handleCancel}
      />

      {/* Message List */}
      <MessageList
        messages={messages}
        isLoading={isLoading}
        isLoadingHistory={isLoadingHistory}
        isAutoReviewing={isAutoReviewing}
        onRetry={retryMessage}
        onSuggestionClick={setInputValue}
      />

      {/* Chat Input */}
      <ChatInput
        value={inputValue}
        onChange={setInputValue}
        onSend={() => sendMessage()}
        onClear={clearChat}
        mode={mode}
        onModeChange={setMode}
        disabled={isLoading || isExecuting}
        showClear={messages.length > 0}
      />
    </div>
  );
}
