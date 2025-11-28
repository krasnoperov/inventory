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
  toolCalls: ToolCall[];
  message: string;
}

/** Plan response for multi-step operations */
export interface PlanResponse {
  type: 'plan';
  plan: AssistantPlan;
  message: string;
}

/** Union of all bot response types */
export type BotResponse = AdvisorResponse | ActorResponse | PlanResponse;
