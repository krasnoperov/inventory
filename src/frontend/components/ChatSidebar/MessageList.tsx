import { useRef, useEffect } from 'react';
import styles from './ChatSidebar.module.css';
import { RateLimitCountdown } from './RateLimitCountdown';
import { MarkdownRenderer } from './MarkdownRenderer';

// =============================================================================
// Types
// =============================================================================

import type { ChatMessage } from '../../stores/chatStore';

// Re-export for backward compatibility
export type { ChatMessage };

/**
 * Billing Portal URL for upgrade links
 * @see /api/billing/portal endpoint in billing.ts
 */
const BILLING_PORTAL_URL = '/api/billing/portal';

export interface MessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
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
      {messages.length === 0 ? (
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
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`${styles.message} ${styles[msg.role]} ${msg.isError ? styles.error : ''}`}
            >
              <div className={styles.messageContent}>
                {msg.isError && <span className={styles.errorIcon}>&#9888;&#65039;</span>}
                {msg.thumbnail && (
                  <div className={styles.messageThumbnail}>
                    <img
                      src={msg.thumbnail.url}
                      alt={msg.thumbnail.assetName}
                      className={styles.thumbnailImage}
                    />
                    <span className={styles.thumbnailLabel}>{msg.thumbnail.assetName}</span>
                  </div>
                )}
                <MarkdownRenderer
                  content={msg.content}
                  isUser={msg.role === 'user'}
                  maxCollapsedHeight={msg.role === 'assistant' ? 400 : undefined}
                />

                {/**
                 * Quota Exceeded Card (HTTP 402)
                 * Shows upgrade CTA linking to billing portal
                 * @see LimitErrorResponse.denyReason === 'quota_exceeded'
                 */}
                {msg.quotaError && (
                  <div className={styles.quotaErrorCard}>
                    <p>
                      You've used {msg.quotaError.used.toLocaleString()} of your{' '}
                      {msg.quotaError.limit?.toLocaleString() ?? 'unlimited'} monthly quota.
                    </p>
                    <a
                      href={BILLING_PORTAL_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.upgradeButton}
                    >
                      Upgrade Plan &#8594;
                    </a>
                  </div>
                )}

                {/**
                 * Rate Limit Card (HTTP 429)
                 * Shows countdown timer until rate limit resets
                 * @see LimitErrorResponse.denyReason === 'rate_limited'
                 */}
                {msg.rateLimitError && (
                  <div className={styles.rateLimitCard}>
                    <p>Please wait before making another request.</p>
                    <RateLimitCountdown
                      resetsAt={msg.rateLimitError.resetsAt}
                      initialSeconds={msg.rateLimitError.remainingSeconds}
                    />
                  </div>
                )}

                {/* Standard retry button for generic errors (not quota/rate limit) */}
                {msg.isError && msg.retryPayload && !msg.quotaError && !msg.rateLimitError && (
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
