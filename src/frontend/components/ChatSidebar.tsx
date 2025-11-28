import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useForgeTrayStore } from '../stores/forgeTrayStore';
import type { Asset, Variant } from '../hooks/useSpaceWebSocket';
import type {
  ForgeContext,
  ViewingContext,
  ToolCall,
  AssistantPlan,
  BotResponse,
} from '../../api/types';
import styles from './ChatSidebar.module.css';

// =============================================================================
// Extended Types (frontend-specific)
// =============================================================================

/** Extended chat message with UI-specific fields */
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  // For action/plan messages
  plan?: AssistantPlan;
  actionResults?: string[];
  // For error messages with retry
  isError?: boolean;
  retryPayload?: {
    message: string;
    mode: 'advisor' | 'actor';
  };
}

/** Job completion data passed from parent */
interface JobCompletionData {
  jobId: string;
  variantId: string;
  assetId?: string;
  assetName?: string;
  prompt?: string;
}

interface ChatSidebarProps {
  spaceId: string;
  isOpen: boolean;
  onClose: () => void;
  currentAsset?: Asset | null;
  allAssets?: Asset[];
  allVariants?: Variant[];
  /** Callback to generate a new asset - returns the job ID for tracking */
  onGenerateAsset?: (params: { name: string; type: string; prompt: string; parentAssetId?: string }) => Promise<string | void>;
  /** Callback to refine an asset (add variant) - returns the job ID for tracking */
  onRefineAsset?: (params: { assetId: string; prompt: string }) => Promise<string | void>;
  /** Callback to combine assets - returns the job ID for tracking */
  onCombineAssets?: (params: { sourceAssetIds: string[]; prompt: string; targetName: string; targetType: string }) => Promise<string | void>;
  /** Job completion notification from parent - triggers auto-review if job was initiated by assistant */
  lastCompletedJob?: JobCompletionData | null;
}

// =============================================================================
// Constants
// =============================================================================

/** Maximum number of jobs to track for auto-review */
const MAX_TRACKED_JOBS = 50;
/** Time-to-live for job tracking entries (10 minutes) */
const JOB_TTL_MS = 10 * 60 * 1000;

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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [mode, setMode] = useState<'advisor' | 'actor'>('actor'); // Default to actor for fluent control
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [activePlan, setActivePlan] = useState<AssistantPlan | null>(null);
  const [isExecutingPlan, setIsExecutingPlan] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [isAutoReviewing, setIsAutoReviewing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Track jobs initiated by the assistant for auto-review
  // Includes timestamp for TTL-based cleanup
  const assistantJobsRef = useRef<Map<string, { assetName: string; prompt: string; createdAt: number }>>(new Map());

  // Get forge tray state
  const slots = useForgeTrayStore((state) => state.slots);
  const prompt = useForgeTrayStore((state) => state.prompt);
  const addSlot = useForgeTrayStore((state) => state.addSlot);
  const setPrompt = useForgeTrayStore((state) => state.setPrompt);
  const clearSlots = useForgeTrayStore((state) => state.clearSlots);
  const removeSlot = useForgeTrayStore((state) => state.removeSlot);

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

  // Load chat history
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

  // Load chat history on mount
  useEffect(() => {
    if (isOpen && spaceId) {
      loadChatHistory();
    }
  }, [isOpen, spaceId, loadChatHistory]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Clean up stale job tracking entries to prevent memory leaks
  useEffect(() => {
    const cleanupJobs = () => {
      const now = Date.now();
      const jobs = assistantJobsRef.current;

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

    // Clean up when sidebar closes
    if (!isOpen) {
      assistantJobsRef.current.clear();
      return;
    }

    // Periodic cleanup while open
    const interval = setInterval(cleanupJobs, 60000); // Every minute
    return () => clearInterval(interval);
  }, [isOpen]);

  // Auto-review completed jobs that were initiated by the assistant
  useEffect(() => {
    if (!lastCompletedJob || !isOpen) return;

    const jobInfo = assistantJobsRef.current.get(lastCompletedJob.jobId);
    if (!jobInfo) return; // Not an assistant-initiated job

    // Remove from tracking
    assistantJobsRef.current.delete(lastCompletedJob.jobId);

    // Trigger auto-review
    const autoReviewJob = async () => {
      setIsAutoReviewing(true);

      // Add a notification that the job completed
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✨ Generation complete for "${jobInfo.assetName}"! Let me review the result...`,
        timestamp: Date.now(),
      }]);

      try {
        // Call the describe endpoint to review the generated image
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

          // Build review message with suggestions
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
  }, [lastCompletedJob, isOpen, spaceId]);

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
        };
        const jobId = await onGenerateAsset(genParams);
        // Track job for auto-review
        if (jobId) {
          assistantJobsRef.current.set(jobId, {
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
          assistantJobsRef.current.set(jobId, {
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
          assistantJobsRef.current.set(jobId, {
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
        const variantId = params.variantId as string;
        const assetName = params.assetName as string;
        const focus = (params.focus as string) || 'general';

        try {
          const response = await fetch(`/api/spaces/${spaceId}/chat/describe`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ variantId, assetName, focus }),
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
  }, [spaceId, allAssets, allVariants, slots, addSlot, removeSlot, clearSlots, setPrompt, onGenerateAsset, onRefineAsset, onCombineAssets]);

  // Execute all tool calls from a response
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

  // Execute a plan step
  const executePlanStep = useCallback(async (plan: AssistantPlan, stepIndex: number): Promise<AssistantPlan> => {
    const step = plan.steps[stepIndex];
    if (!step) return plan;

    // Update step status to in_progress
    const updatedPlan = {
      ...plan,
      currentStepIndex: stepIndex,
      steps: plan.steps.map((s, i) =>
        i === stepIndex ? { ...s, status: 'in_progress' as const } : s
      ),
    };
    setActivePlan(updatedPlan);

    try {
      const result = await executeToolCall({
        name: step.action,
        params: step.params,
      });

      // Update step with result
      return {
        ...updatedPlan,
        steps: updatedPlan.steps.map((s, i) =>
          i === stepIndex ? { ...s, status: 'completed' as const, result } : s
        ),
      };
    } catch (err) {
      // Update step with error
      return {
        ...updatedPlan,
        status: 'failed',
        steps: updatedPlan.steps.map((s, i) =>
          i === stepIndex ? { ...s, status: 'failed' as const, error: err instanceof Error ? err.message : 'Failed' } : s
        ),
      };
    }
  }, [executeToolCall]);

  // Execute single step of plan (step-by-step mode)
  const executeNextStep = useCallback(async () => {
    if (!activePlan) return;

    const nextStepIndex = activePlan.steps.findIndex(s => s.status === 'pending');
    if (nextStepIndex === -1) return;

    setIsExecutingPlan(true);
    setAwaitingConfirmation(false);

    // Update plan status to executing
    let currentPlan: AssistantPlan = { ...activePlan, status: 'executing' };
    setActivePlan(currentPlan);

    // Execute the step
    currentPlan = await executePlanStep(currentPlan, nextStepIndex);
    setActivePlan(currentPlan);

    // Add step result message
    const step = currentPlan.steps[nextStepIndex];
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `Step ${nextStepIndex + 1}: ${step.description}\n${step.result || step.error || ''}`,
      timestamp: Date.now(),
    }]);

    // Check if there are more steps
    const remainingSteps = currentPlan.steps.filter(s => s.status === 'pending').length;
    if (remainingSteps > 0 && step.status === 'completed') {
      // Pause and await confirmation for next step
      setAwaitingConfirmation(true);
      currentPlan = { ...currentPlan, status: 'paused' };
      setActivePlan(currentPlan);

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Ready for step ${nextStepIndex + 2}. Click "Next Step" to continue or "Cancel" to stop.`,
        timestamp: Date.now(),
      }]);
    } else if (remainingSteps === 0 || step.status === 'failed') {
      // Plan completed or failed
      const allCompleted = currentPlan.steps.every(s => s.status === 'completed');
      const finalStatus: AssistantPlan['status'] = allCompleted ? 'completed' : 'failed';
      currentPlan = { ...currentPlan, status: finalStatus };
      setActivePlan(currentPlan);

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: allCompleted
          ? `Plan completed successfully!`
          : `Plan stopped. ${currentPlan.steps.filter(s => s.status === 'completed').length}/${currentPlan.steps.length} steps completed.`,
        timestamp: Date.now(),
      }]);

      // Clear plan after completion
      if (allCompleted) {
        setTimeout(() => setActivePlan(null), 2000);
      }
    }

    setIsExecutingPlan(false);
  }, [activePlan, executePlanStep]);

  // Start plan execution (first step)
  const startPlan = useCallback(async (plan: AssistantPlan) => {
    // Update plan status
    const updatedPlan: AssistantPlan = { ...plan, status: 'executing' };
    setActivePlan(updatedPlan);

    // Add start message
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `Starting plan: "${plan.goal}"\nExecuting step 1...`,
      timestamp: Date.now(),
    }]);

    // Execute first step
    setIsExecutingPlan(true);
    const afterFirstStep = await executePlanStep(updatedPlan, 0);
    setActivePlan(afterFirstStep);

    // Add result message
    const step = afterFirstStep.steps[0];
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `Step 1: ${step.description}\n${step.result || step.error || ''}`,
      timestamp: Date.now(),
    }]);

    // Check if more steps
    const remainingSteps = afterFirstStep.steps.filter(s => s.status === 'pending').length;
    if (remainingSteps > 0 && step.status === 'completed') {
      setAwaitingConfirmation(true);
      setActivePlan({ ...afterFirstStep, status: 'paused' });

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Ready for step 2. Click "Next Step" to continue.`,
        timestamp: Date.now(),
      }]);
    } else {
      const allCompleted = afterFirstStep.steps.every(s => s.status === 'completed');
      setActivePlan({ ...afterFirstStep, status: allCompleted ? 'completed' : 'failed' });

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: allCompleted ? `Plan completed!` : `Plan failed at step 1.`,
        timestamp: Date.now(),
      }]);
    }

    setIsExecutingPlan(false);
  }, [executePlanStep]);

  // Cancel the plan
  const cancelPlan = useCallback(() => {
    if (activePlan) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Plan cancelled. ${activePlan.steps.filter(s => s.status === 'completed').length}/${activePlan.steps.length} steps were completed.`,
        timestamp: Date.now(),
      }]);
    }
    setActivePlan(null);
    setAwaitingConfirmation(false);
    setIsExecutingPlan(false);
  }, [activePlan]);

  const sendMessage = useCallback(async (overrideMessage?: string, overrideMode?: 'advisor' | 'actor') => {
    const messageToSend = overrideMessage ?? inputValue.trim();
    const modeToUse = overrideMode ?? mode;

    if (!messageToSend || isLoading) return;

    if (!overrideMessage) {
      setInputValue('');
    }
    setIsLoading(true);
    const userMessage = messageToSend;

    // Add user message to chat
    setMessages(prev => [...prev, {
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    }]);

    try {
      const response = await fetch(`/api/spaces/${spaceId}/chat`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          mode: modeToUse,
          history: messages.slice(-10).map(m => ({
            role: m.role,
            content: m.content,
          })),
          forgeContext,
          viewingContext,
          activePlan: activePlan,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || 'Failed to send message');
      }

      const data = await response.json() as { success: boolean; response: BotResponse };
      const botResponse = data.response;

      // Handle different response types
      if (botResponse.type === 'plan' && botResponse.plan) {
        // Show plan for approval
        setActivePlan(botResponse.plan);
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: botResponse.message,
          timestamp: Date.now(),
          plan: botResponse.plan,
        }]);
      } else if (botResponse.type === 'action' && botResponse.toolCalls) {
        // Execute tool calls immediately
        const results = await executeToolCalls(botResponse.toolCalls);
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `${botResponse.message}\n\n${results.join('\n')}`,
          timestamp: Date.now(),
          actionResults: results,
        }]);
      } else {
        // Simple advice message
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: botResponse.message,
          timestamp: Date.now(),
        }]);
      }
    } catch (err) {
      console.error('Chat error:', err);

      // Categorize error types for better messaging
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
          isRetryable = true; // Most other errors might be transient
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
        retryPayload: isRetryable ? { message: userMessage, mode: modeToUse } : undefined,
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [inputValue, isLoading, spaceId, mode, messages, forgeContext, viewingContext, activePlan, executeToolCalls]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = useCallback(() => {
    setMessages([]);
    setActivePlan(null);
  }, []);

  // Retry a failed message - auto-resends the original message
  const retryMessage = useCallback((payload: { message: string; mode: 'advisor' | 'actor' }) => {
    // Remove the error message
    setMessages(prev => prev.filter(m => !m.isError));
    // Directly send with the original message and mode
    sendMessage(payload.message, payload.mode);
  }, [sendMessage]);

  if (!isOpen) return null;

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <span className={styles.botIcon}>🤖</span>
          <h3>Forge Assistant</h3>
        </div>
        <button className={styles.closeButton} onClick={onClose} title="Close chat">
          ×
        </button>
      </div>

      <div className={styles.modeSelector}>
        <button
          className={`${styles.modeButton} ${mode === 'advisor' ? styles.active : ''}`}
          onClick={() => setMode('advisor')}
        >
          Advisor
        </button>
        <button
          className={`${styles.modeButton} ${mode === 'actor' ? styles.active : ''}`}
          onClick={() => setMode('actor')}
        >
          Actor
        </button>
      </div>
      <p className={styles.modeHint}>
        {mode === 'advisor'
          ? 'Ask questions and get suggestions'
          : 'Take action - create, combine, and manage assets'}
      </p>

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

      {/* Active Plan Display */}
      {activePlan && activePlan.status !== 'completed' && (
        <div className={styles.planCard}>
          <div className={styles.planHeader}>
            <span className={styles.planIcon}>📋</span>
            <span className={styles.planGoal}>{activePlan.goal}</span>
            <span className={`${styles.planStatus} ${styles[activePlan.status]}`}>
              {activePlan.status}
            </span>
          </div>
          <div className={styles.planSteps}>
            {activePlan.steps.map((step, idx) => (
              <div
                key={step.id}
                className={`${styles.planStep} ${styles[step.status]}`}
              >
                <span className={styles.stepNumber}>{idx + 1}</span>
                <span className={styles.stepDescription}>{step.description}</span>
                {step.status === 'completed' && <span className={styles.stepIcon}>✓</span>}
                {step.status === 'failed' && <span className={styles.stepIcon}>✗</span>}
                {step.status === 'in_progress' && <span className={styles.stepIcon}>⏳</span>}
              </div>
            ))}
          </div>
          {/* Initial approval buttons */}
          {activePlan.status === 'planning' && (
            <div className={styles.planActions}>
              <button
                className={styles.planApprove}
                onClick={() => startPlan(activePlan)}
                disabled={isExecutingPlan}
              >
                Start Plan
              </button>
              <button
                className={styles.planCancel}
                onClick={cancelPlan}
                disabled={isExecutingPlan}
              >
                Cancel
              </button>
            </div>
          )}
          {/* Step-by-step controls when paused/awaiting */}
          {(activePlan.status === 'paused' || awaitingConfirmation) && (
            <div className={styles.stepControls}>
              <button
                className={styles.nextStepButton}
                onClick={executeNextStep}
                disabled={isExecutingPlan}
              >
                Next Step →
              </button>
              <button
                className={styles.pauseButton}
                onClick={cancelPlan}
                disabled={isExecutingPlan}
              >
                Cancel
              </button>
            </div>
          )}
          {/* Executing indicator */}
          {activePlan.status === 'executing' && !awaitingConfirmation && (
            <div className={styles.planActions}>
              <button className={styles.planApprove} disabled>
                Executing...
              </button>
            </div>
          )}
        </div>
      )}

      <div className={styles.messages}>
        {isLoadingHistory ? (
          <div className={styles.loadingHistory}>Loading chat history...</div>
        ) : messages.length === 0 ? (
          <div className={styles.emptyChat}>
            <span className={styles.emptyIcon}>💬</span>
            <p>Start a conversation with your AI assistant</p>
            <div className={styles.suggestions}>
              <button onClick={() => setInputValue('Create a fantasy hero character')}>
                Create a fantasy hero
              </button>
              <button onClick={() => setInputValue('Create a set of RPG items: sword, shield, and potion')}>
                Create RPG item set
              </button>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`${styles.message} ${styles[msg.role]} ${msg.isError ? styles.error : ''}`}
              >
                <div className={styles.messageContent}>
                  {msg.isError && <span className={styles.errorIcon}>⚠️</span>}
                  {msg.content}
                  {msg.isError && msg.retryPayload && (
                    <button
                      className={styles.retryButton}
                      onClick={() => retryMessage(msg.retryPayload!)}
                    >
                      Retry
                    </button>
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className={`${styles.message} ${styles.assistant}`}>
                <div className={styles.messageContent}>
                  <span className={styles.typing}>Thinking...</span>
                </div>
              </div>
            )}
            {isAutoReviewing && !isLoading && (
              <div className={`${styles.message} ${styles.assistant}`}>
                <div className={styles.messageContent}>
                  <span className={styles.typing}>Analyzing image...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      <div className={styles.inputArea}>
        {messages.length > 0 && (
          <button className={styles.clearButton} onClick={clearChat} title="Clear chat">
            Clear
          </button>
        )}
        <div className={styles.inputWrapper}>
          <textarea
            className={styles.input}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={mode === 'advisor' ? 'Ask a question...' : 'Tell me what to create...'}
            rows={1}
            disabled={isLoading || isExecutingPlan}
          />
          <button
            className={styles.sendButton}
            onClick={() => sendMessage()}
            disabled={isLoading || isExecutingPlan || !inputValue.trim()}
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}
