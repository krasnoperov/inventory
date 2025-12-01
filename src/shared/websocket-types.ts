/**
 * Shared WebSocket Types
 *
 * Types shared between frontend, backend, and CLI for WebSocket communication.
 * This is the single source of truth for these types to prevent drift.
 */

/** Focus options for image description */
export type DescribeFocus = 'general' | 'style' | 'composition' | 'details' | 'compare';

/** Claude API usage metrics */
export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
}
