import { useRef, useEffect } from 'react';
import styles from './ChatSidebar.module.css';

// =============================================================================
// Types
// =============================================================================

/** Chat message with UI-specific fields */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  isError?: boolean;
  retryPayload?: {
    message: string;
    mode: 'advisor' | 'actor';
  };
}

export interface MessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
  isLoadingHistory: boolean;
  isAutoReviewing: boolean;
  onRetry: (payload: { message: string; mode: 'advisor' | 'actor' }) => void;
  onSuggestionClick: (suggestion: string) => void;
}

// =============================================================================
// Component
// =============================================================================

export function MessageList({
  messages,
  isLoading,
  isLoadingHistory,
  isAutoReviewing,
  onRetry,
  onSuggestionClick,
}: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className={styles.messages}>
      {isLoadingHistory ? (
        <div className={styles.loadingHistory}>Loading chat history...</div>
      ) : messages.length === 0 ? (
        <div className={styles.emptyChat}>
          <span className={styles.emptyIcon}>💬</span>
          <p>Start a conversation with your AI assistant</p>
          <div className={styles.suggestions}>
            <button onClick={() => onSuggestionClick('Create a fantasy hero character')}>
              Create a fantasy hero
            </button>
            <button onClick={() => onSuggestionClick('Create a set of RPG items: sword, shield, and potion')}>
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
                    onClick={() => onRetry(msg.retryPayload!)}
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
  );
}
