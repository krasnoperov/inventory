import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useForgeTrayStore } from '../stores/forgeTrayStore';
import type { Asset, Variant } from '../hooks/useSpaceWebSocket';
import styles from './ChatSidebar.module.css';

// =============================================================================
// Types
// =============================================================================

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  // For action/plan messages
  plan?: AssistantPlan;
  actionResults?: string[];
}

interface ToolCall {
  name: string;
  params: Record<string, unknown>;
}

interface AssistantPlan {
  id: string;
  goal: string;
  steps: PlanStep[];
  currentStepIndex: number;
  status: 'planning' | 'executing' | 'completed' | 'failed' | 'paused';
  createdAt: number;
}

interface PlanStep {
  id: string;
  description: string;
  action: string;
  params: Record<string, unknown>;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string;
  error?: string;
}

interface BotResponse {
  type: 'advice' | 'action' | 'plan';
  message: string;
  suggestions?: string[];
  toolCalls?: ToolCall[];
  plan?: AssistantPlan;
}

interface ForgeContext {
  operation: string;
  slots: Array<{ assetId: string; assetName: string; variantId: string }>;
  prompt: string;
}

interface ViewingContext {
  type: 'catalog' | 'asset' | 'variant';
  assetId?: string;
  assetName?: string;
  variantId?: string;
}

interface ChatSidebarProps {
  spaceId: string;
  isOpen: boolean;
  onClose: () => void;
  currentAsset?: Asset | null;
  allAssets?: Asset[];
  allVariants?: Variant[];
  /** Callback to generate a new asset */
  onGenerateAsset?: (params: { name: string; type: string; prompt: string; parentAssetId?: string }) => Promise<void>;
  /** Callback to refine an asset (add variant) */
  onRefineAsset?: (params: { assetId: string; prompt: string }) => Promise<void>;
  /** Callback to combine assets */
  onCombineAssets?: (params: { sourceAssetIds: string[]; prompt: string; targetName: string; targetType: string }) => Promise<void>;
}

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
}: ChatSidebarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [mode, setMode] = useState<'advisor' | 'actor'>('actor'); // Default to actor for fluent control
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [activePlan, setActivePlan] = useState<AssistantPlan | null>(null);
  const [isExecutingPlan, setIsExecutingPlan] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  // Load chat history on mount
  useEffect(() => {
    if (isOpen && spaceId) {
      loadChatHistory();
    }
  }, [isOpen, spaceId]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
        await onGenerateAsset(genParams);
        return `Started generating "${genParams.name}"`;
      }

      case 'refine_asset': {
        if (!onRefineAsset) return 'Refinement not available';
        const refineParams = {
          assetId: params.assetId as string,
          prompt: params.prompt as string,
        };
        await onRefineAsset(refineParams);
        const asset = allAssets.find(a => a.id === refineParams.assetId);
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
        await onCombineAssets(combineParams);
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

      default:
        return `Unknown action: ${name}`;
    }
  }, [allAssets, allVariants, slots, addSlot, removeSlot, clearSlots, setPrompt, onGenerateAsset, onRefineAsset, onCombineAssets]);

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

  // Execute full plan
  const executePlan = useCallback(async (plan: AssistantPlan) => {
    setIsExecutingPlan(true);
    let currentPlan: AssistantPlan = { ...plan, status: 'executing' };
    setActivePlan(currentPlan);

    // Add execution start message
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `Starting plan: "${plan.goal}"`,
      timestamp: Date.now(),
    }]);

    let shouldContinue = true;
    for (let i = 0; i < plan.steps.length && shouldContinue; i++) {
      currentPlan = await executePlanStep(currentPlan, i);
      setActivePlan(currentPlan);

      // Check if step failed
      if (currentPlan.steps[i].status === 'failed') {
        shouldContinue = false;
      }

      // Add step result message
      const step = currentPlan.steps[i];
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Step ${i + 1}: ${step.description}\n${step.result || step.error || ''}`,
        timestamp: Date.now(),
      }]);

      // Small delay between steps for visual feedback
      if (shouldContinue) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Mark plan as completed or failed
    const allCompleted = currentPlan.steps.every(s => s.status === 'completed');
    const finalStatus: AssistantPlan['status'] = allCompleted ? 'completed' : 'failed';
    const finalPlan: AssistantPlan = { ...currentPlan, status: finalStatus };
    setActivePlan(finalPlan);
    setIsExecutingPlan(false);

    // Add completion message
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: allCompleted
        ? `Plan completed successfully!`
        : `Plan failed. Some steps did not complete.`,
      timestamp: Date.now(),
    }]);

    return finalPlan;
  }, [executePlanStep]);

  const loadChatHistory = async () => {
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
  };

  const sendMessage = useCallback(async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    setIsLoading(true);

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
          mode,
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
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Failed to get response'}`,
        timestamp: Date.now(),
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
          {activePlan.status === 'planning' && (
            <div className={styles.planActions}>
              <button
                className={styles.planApprove}
                onClick={() => executePlan(activePlan)}
                disabled={isExecutingPlan}
              >
                Execute Plan
              </button>
              <button
                className={styles.planCancel}
                onClick={() => setActivePlan(null)}
                disabled={isExecutingPlan}
              >
                Cancel
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
                className={`${styles.message} ${styles[msg.role]}`}
              >
                <div className={styles.messageContent}>
                  {msg.content}
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
            onClick={sendMessage}
            disabled={isLoading || isExecutingPlan || !inputValue.trim()}
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}
