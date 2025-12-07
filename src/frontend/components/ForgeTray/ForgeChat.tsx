import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  ForgeChatRequestParams,
  ForgeChatResponseResult,
  ForgeChatProgressResult,
  ForgeChatDescription,
} from '../../hooks/useSpaceWebSocket';
import styles from './ForgeChat.module.css';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  suggestedPrompt?: string;
  /** Descriptions collected during this message (shown as collapsible) */
  descriptions?: ForgeChatDescription[];
}

/** Progress state for description phase */
interface DescriptionProgress {
  variantId: string;
  assetName: string;
  status: 'started' | 'completed' | 'cached';
  description?: string;
  index: number;
  total: number;
}

export interface ForgeChatProps {
  /** Current prompt from ForgeTray */
  currentPrompt: string;
  /** Variant IDs from ForgeTray slots */
  slotVariantIds: string[];
  /** Handler to send forge chat request */
  sendForgeChatRequest: (params: ForgeChatRequestParams) => string;
  /** Whether a chat request is in progress */
  isLoading: boolean;
  /** Last response from the server */
  lastResponse?: ForgeChatResponseResult | null;
  /** Last progress update from the server */
  lastProgress?: ForgeChatProgressResult | null;
  /** Callback when user applies a suggested prompt */
  onApplyPrompt: (prompt: string) => void;
  /** Callback to close the chat panel */
  onClose: () => void;
}

export function ForgeChat({
  currentPrompt,
  slotVariantIds,
  sendForgeChatRequest,
  isLoading,
  lastResponse,
  lastProgress,
  onApplyPrompt,
  onClose,
}: ForgeChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [descriptionProgress, setDescriptionProgress] = useState<DescriptionProgress[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastRequestIdRef = useRef<string | null>(null);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Scroll to bottom when messages change or progress updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, descriptionProgress]);

  // Handle progress updates from server (description phase)
  useEffect(() => {
    if (!lastProgress || lastProgress.requestId !== lastRequestIdRef.current) return;

    setDescriptionProgress(prev => {
      const existing = prev.find(p => p.variantId === lastProgress.variantId);
      if (existing) {
        // Update existing progress
        return prev.map(p =>
          p.variantId === lastProgress.variantId
            ? { ...p, status: lastProgress.status, description: lastProgress.description }
            : p
        );
      } else {
        // Add new progress entry
        return [...prev, {
          variantId: lastProgress.variantId,
          assetName: lastProgress.assetName,
          status: lastProgress.status,
          description: lastProgress.description,
          index: lastProgress.index,
          total: lastProgress.total,
        }];
      }
    });
  }, [lastProgress]);

  // Handle response from server
  useEffect(() => {
    if (!lastResponse || lastResponse.requestId !== lastRequestIdRef.current) return;

    // Clear progress state when response arrives
    setDescriptionProgress([]);

    if (lastResponse.success && lastResponse.message) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: lastResponse.message!,
          suggestedPrompt: lastResponse.suggestedPrompt,
          descriptions: lastResponse.descriptions,
        },
      ]);
    } else if (!lastResponse.success && lastResponse.error) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `Sorry, I encountered an error: ${lastResponse.error}`,
        },
      ]);
    }
  }, [lastResponse]);

  // Handle sending a message
  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || isLoading) return;

    // Add user message to UI
    setMessages(prev => [...prev, { role: 'user', content: trimmed }]);
    setInputValue('');

    // Build conversation history (exclude suggestedPrompt from history)
    const conversationHistory = messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    // Send request
    const requestId = sendForgeChatRequest({
      message: trimmed,
      currentPrompt,
      slotVariantIds,
      conversationHistory,
    });
    lastRequestIdRef.current = requestId;
  }, [inputValue, isLoading, messages, currentPrompt, slotVariantIds, sendForgeChatRequest]);

  // Handle keyboard events
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  }, [handleSend, onClose]);

  // Handle applying a suggested prompt
  const handleApply = useCallback((prompt: string) => {
    onApplyPrompt(prompt);
    onClose();
  }, [onApplyPrompt, onClose]);

  return (
    <div className={styles.chatPanel}>
      {/* Header */}
      <div className={styles.header}>
        <h3 className={styles.title}>Chat with Claude</h3>
        <button
          className={styles.closeButton}
          onClick={onClose}
          title="Close (Esc)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Messages Area */}
      <div className={styles.messagesArea}>
        {messages.length === 0 && !isLoading && (
          <div className={styles.emptyState}>
            <svg className={styles.emptyIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32">
              <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className={styles.emptyText}>
              Ask me to help refine your prompt!<br />
              I can see the images in your tray.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`${styles.message} ${styles[msg.role]}`}>
            <div className={styles.messageBubble}>
              {msg.content}
            </div>
            {/* Collapsible descriptions section */}
            {msg.descriptions && msg.descriptions.length > 0 && (
              <details className={styles.descriptionsDetails}>
                <summary className={styles.descriptionsSummary}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  Image analysis ({msg.descriptions.length})
                </summary>
                <div className={styles.descriptionsContent}>
                  {msg.descriptions.map((desc) => (
                    <div key={desc.variantId} className={styles.descriptionItem}>
                      <div className={styles.descriptionName}>
                        {desc.assetName}
                        {desc.cached && <span className={styles.cachedBadge}>cached</span>}
                      </div>
                      <div className={styles.descriptionText}>{desc.description}</div>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {msg.suggestedPrompt && (
              <div className={styles.suggestedPrompt}>
                <div className={styles.suggestedLabel}>Suggested Prompt</div>
                <div className={styles.suggestedText}>"{msg.suggestedPrompt}"</div>
                <button
                  className={styles.applyButton}
                  onClick={() => handleApply(msg.suggestedPrompt!)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Apply
                </button>
              </div>
            )}
          </div>
        ))}

        {/* Loading indicator with description progress */}
        {isLoading && (
          <div className={styles.loadingMessage}>
            <div className={styles.loadingBubble}>
              {descriptionProgress.length > 0 ? (
                <div className={styles.descriptionProgress}>
                  <div className={styles.progressHeader}>
                    Analyzing images ({descriptionProgress.filter(p => p.status !== 'started').length}/{descriptionProgress[0]?.total || 0})
                  </div>
                  {descriptionProgress.map((p) => (
                    <div key={p.variantId} className={styles.progressItem}>
                      {p.status === 'started' ? (
                        <span className={styles.progressSpinner} />
                      ) : (
                        <svg className={styles.progressCheck} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                      <span className={styles.progressLabel}>
                        {p.assetName}
                        {p.status === 'cached' && <span className={styles.cachedBadge}>cached</span>}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.loadingDots}>
                  <span className={styles.loadingDot} />
                  <span className={styles.loadingDot} />
                  <span className={styles.loadingDot} />
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className={styles.inputArea}>
        <input
          ref={inputRef}
          className={styles.input}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={isLoading}
        />
        <button
          className={styles.sendButton}
          onClick={handleSend}
          disabled={!inputValue.trim() || isLoading}
          title="Send (Enter)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default ForgeChat;
