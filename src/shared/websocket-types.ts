/**
 * Shared WebSocket Types
 *
 * Types shared between frontend, backend, and CLI for WebSocket communication.
 * This is the single source of truth for these types to prevent drift.
 */

// ============================================================================
// DESCRIBE/COMPARE TYPES
// ============================================================================

/** Focus options for image description */
export type DescribeFocus = 'general' | 'style' | 'composition' | 'details' | 'compare';

/** Claude API usage metrics */
export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
}

// ============================================================================
// PLAN TYPES - Single source of truth for plan statuses
// ============================================================================

/**
 * Plan status lifecycle:
 * - planning: Plan created, awaiting user approval
 * - executing: User approved, steps being executed
 * - paused: Execution paused (waiting for user input or step completion)
 * - completed: All steps completed successfully
 * - failed: A step failed and plan was marked as failed
 * - cancelled: User cancelled the plan
 */
export type PlanStatus = 'planning' | 'executing' | 'paused' | 'completed' | 'failed' | 'cancelled';

/**
 * Plan step status lifecycle:
 * - pending: Not yet started
 * - in_progress: Currently executing
 * - completed: Finished successfully
 * - failed: Execution failed (can be retried)
 * - skipped: User chose to skip this step
 * - blocked: Waiting on dependency that failed/was skipped
 */
export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'blocked';

/**
 * Map server PlanStatus to UI display status.
 * 'planning' is displayed as 'awaiting_approval' in the UI.
 */
export type UIPlanStatus = 'idle' | 'awaiting_approval' | 'executing' | 'paused' | 'completed' | 'failed';

/**
 * Convert server plan status to UI display status
 */
export function planStatusToUI(serverStatus: PlanStatus): UIPlanStatus {
  switch (serverStatus) {
    case 'planning':
      return 'awaiting_approval';
    case 'cancelled':
      return 'idle'; // Cancelled plans are treated as dismissed in UI
    default:
      return serverStatus;
  }
}

/**
 * Convert UI status back to server status (for API calls)
 */
export function uiStatusToPlanStatus(uiStatus: UIPlanStatus): PlanStatus | null {
  switch (uiStatus) {
    case 'awaiting_approval':
      return 'planning';
    case 'idle':
      return null; // No corresponding server status
    default:
      return uiStatus;
  }
}

// ============================================================================
// ERROR CODES - Standardized error codes for programmatic handling
// ============================================================================

/**
 * Standardized error codes for WebSocket/API responses.
 * Use these to enable consistent error handling across clients.
 */
export type ErrorCode =
  // Rate limiting / Quota
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  // Resource errors
  | 'NOT_FOUND'
  | 'ASSET_NOT_FOUND'
  | 'VARIANT_NOT_FOUND'
  | 'PLAN_NOT_FOUND'
  | 'STEP_NOT_FOUND'
  // Permission errors
  | 'PERMISSION_DENIED'
  | 'EDITOR_REQUIRED'
  | 'OWNER_REQUIRED'
  // Validation errors
  | 'VALIDATION_ERROR'
  | 'INVALID_STATE'
  | 'INVALID_MESSAGE'
  | 'UNKNOWN_MESSAGE_TYPE'
  | 'CYCLE_DETECTED'
  // Workflow/Generation errors
  | 'WORKFLOW_FAILED'
  | 'GENERATION_FAILED'
  | 'CLAUDE_API_ERROR'
  | 'GEMINI_API_ERROR'
  // System errors
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE';

/**
 * Structured error response for WebSocket messages
 */
export interface ErrorResponse {
  /** Human-readable error message */
  error: string;
  /** Machine-readable error code for programmatic handling */
  code: ErrorCode;
  /** Additional context (optional) */
  details?: Record<string, unknown>;
  /** Request ID for correlation (optional) */
  requestId?: string;
}

/**
 * Type guard to check if a response is an error response
 */
export function isErrorResponse(response: unknown): response is ErrorResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'error' in response &&
    'code' in response
  );
}

// ============================================================================
// FORGE CONTEXT TYPES - Shared between frontend and backend
// ============================================================================

/**
 * Forge operation types
 */
export type ForgeOperation = 'generate' | 'fork' | 'derive' | 'refine';

/**
 * Slot in the forge tray
 */
export interface ForgeContextSlot {
  assetId: string;
  assetName: string;
  variantId: string;
}

/**
 * Forge tray context passed to Claude
 */
export interface ForgeContext {
  operation: ForgeOperation;
  slots: ForgeContextSlot[];
  prompt: string;
}

/**
 * What the user is currently viewing
 */
export interface ViewingContext {
  type: 'catalog' | 'asset';
  assetId?: string;
  assetName?: string;
  variantId?: string;
  /** Total number of variants for this asset */
  variantCount?: number;
  /** Index of the currently selected variant (1-based for display) */
  variantIndex?: number;
}
