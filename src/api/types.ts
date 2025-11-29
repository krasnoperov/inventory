/**
 * API Contract Types
 *
 * This module defines the public API contract for all HTTP endpoints.
 * These types represent what the API returns to clients (frontend, CLI, etc.)
 *
 * Guidelines:
 * - These types define the PUBLIC API surface
 * - Clients (frontend, CLI) should ONLY import from this file
 * - Backend can use these for type-safe responses
 * - Built on top of database types but may add/transform fields
 */

// ============================================================================
// BARE FRAMEWORK FOUNDATION
// Add your domain-specific API types here
// ============================================================================

// Example: User profile response
// export type UserProfileResponse = {
//   id: string;
//   name: string;
//   email: string;
// };

// Example: Asset list response (for future implementation)
// export type AssetsListResponse = {
//   assets: Array<{
//     id: string;
//     title: string;
//     imageUrl?: string;
//   }>;
//   total: number;
// };

// Example: Chat response
// export type ChatResponse = {
//   message: string;
//   timestamp: number;
// };

// ============================================================================
// CHAT / ASSISTANT TYPES
// Shared between frontend (ChatSidebar) and backend (claudeService)
// ============================================================================

/** Forge Tray slot info for context */
export interface ForgeContextSlot {
  assetId: string;
  assetName: string;
  variantId: string;
}

/** Forge Tray state context passed to Claude */
export interface ForgeContext {
  operation: 'generate' | 'fork' | 'refine' | 'create' | 'combine' | string;
  slots: ForgeContextSlot[];
  prompt: string;
}

/** What the user is currently viewing */
export interface ViewingContext {
  type: 'catalog' | 'asset' | 'variant';
  assetId?: string;
  assetName?: string;
  variantId?: string;
  /** Total number of variants for this asset */
  variantCount?: number;
  /** Index of the currently selected variant (1-based for display) */
  variantIndex?: number;
}

/** Chat message for history */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Tool call from Claude */
export interface ToolCall {
  name: string;
  params: Record<string, unknown>;
}

/** Step in an assistant plan */
export interface PlanStep {
  id: string;
  description: string;
  action: string;
  params: Record<string, unknown>;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string;
  error?: string;
}

/** Multi-step plan created by assistant */
export interface AssistantPlan {
  id: string;
  goal: string;
  steps: PlanStep[];
  currentStepIndex: number;
  status: 'planning' | 'executing' | 'completed' | 'failed' | 'paused';
  createdAt: number;
}

/** Advice-only response from Claude */
export interface AdvisorResponse {
  type: 'advice';
  message: string;
  suggestions?: string[];
}

/** Action response with tool calls */
export interface ActorResponse {
  type: 'action';
  message: string;
  /** Tool calls (legacy mode or when trust zones disabled) */
  toolCalls?: ToolCall[];
  /** Safe tools that were auto-executed (trust zone mode) */
  autoExecuted?: AutoExecutedAction[];
  /** Generating tools pending approval (trust zone mode) */
  pendingApprovals?: PendingApproval[];
}

/** Plan response for multi-step operations */
export interface PlanResponse {
  type: 'plan';
  plan: AssistantPlan;
  message: string;
}

/** Union of all bot response types */
export type BotResponse = AdvisorResponse | ActorResponse | PlanResponse;

// ============================================================================
// TRUST ZONES - Auto-execute vs Approval
// ============================================================================

/** Result of an auto-executed safe tool */
export interface AutoExecutedAction {
  tool: string;
  params: Record<string, unknown>;
  result: unknown;
  success: boolean;
  error?: string;
}

/** A tool call pending user approval */
export interface PendingApproval {
  id: string;
  tool: string;
  params: Record<string, unknown>;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
}

/** Request to approve/reject pending tool calls */
export interface ApprovalRequest {
  approvalIds: string[];
  action: 'approve' | 'reject';
}

/** Result of approval processing */
export interface ApprovalResult {
  approvalId: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

// ============================================================================
// BILLING - Quota and Rate Limit Feedback
// ============================================================================

/** Quota status in error responses */
export interface QuotaStatus {
  /** Current usage in this billing period */
  used: number;
  /** Quota limit (null = unlimited) */
  limit: number | null;
  /** Remaining quota (null = unlimited) */
  remaining: number | null;
}

/** Rate limit status in error responses */
export interface RateLimitStatus {
  /** Current requests in this window */
  used: number;
  /** Max requests per window */
  limit: number;
  /** Remaining requests in this window */
  remaining: number;
  /** When the rate limit window resets (ISO string, null if window not active) */
  resetsAt: string | null;
}

/**
 * Error response when request is blocked by quota or rate limit
 *
 * HTTP Status Codes:
 * - 402 Payment Required: Quota exceeded (user should upgrade plan)
 * - 429 Too Many Requests: Rate limited (user should wait)
 *
 * UI Recommendations:
 * - quota_exceeded: Show upgrade CTA, link to billing portal
 * - rate_limited: Show countdown timer based on resetsAt, disable action button
 */
export interface LimitErrorResponse {
  /** Error type: 'Rate limited' or 'Quota exceeded' */
  error: string;
  /** Human-readable message */
  message: string;
  /** Denial reason for programmatic handling */
  denyReason: 'quota_exceeded' | 'rate_limited';
  /** Current quota status */
  quota: QuotaStatus;
  /** Current rate limit status */
  rateLimit: RateLimitStatus;
}

/**
 * Type guard to check if an error response is a limit error
 */
export function isLimitErrorResponse(response: unknown): response is LimitErrorResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'denyReason' in response &&
    ((response as LimitErrorResponse).denyReason === 'quota_exceeded' ||
      (response as LimitErrorResponse).denyReason === 'rate_limited')
  );
}
