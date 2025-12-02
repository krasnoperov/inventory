/**
 * Types for SpaceDO - Durable Object SQLite Schema and WebSocket Messages
 *
 * This module extracts all type definitions from SpaceDO.ts for:
 * - Testability (types can be imported without DO runtime)
 * - Reusability (shared across handlers and services)
 * - Maintainability (single source of truth for schema types)
 */

import type {
  ChatRequestMessage,
  GenerateRequestMessage,
  RefineRequestMessage,
  DescribeRequestMessage,
  CompareRequestMessage,
} from '../../workflows/types';
import type { ClaudeUsage } from '../../../shared/websocket-types';

// ============================================================================
// DO SQLite Schema Types
// ============================================================================

/**
 * Variant generation status
 */
export type VariantStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Asset - A graphical asset in the inventory (character, item, scene, etc.)
 */
export interface Asset {
  id: string;
  name: string;
  type: string; // User-editable: character, item, scene, sprite-sheet, animation, style-sheet, reference, etc.
  tags: string; // JSON array
  parent_asset_id: string | null; // NULL = root asset, else nested under parent
  active_variant_id: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

/**
 * Variant - A version/iteration of an asset
 *
 * Can be a placeholder (pending/processing/failed) or completed with images.
 * Placeholders are created immediately when generation starts, allowing
 * the UI to show progress and enabling retry on failure.
 */
export interface Variant {
  id: string;
  asset_id: string;
  workflow_id: string | null; // Cloudflare workflow instance ID (null for spawns/imports)
  status: VariantStatus; // Generation lifecycle status
  error_message: string | null; // Error details when status='failed'
  image_key: string | null; // R2 key, null until generation completes
  thumb_key: string | null; // R2 key for thumbnail, null until generation completes
  recipe: string; // JSON - generation parameters stored upfront for retry
  starred: boolean; // User marks important versions
  created_by: string;
  created_at: number;
  updated_at: number | null; // Track status changes
}

/**
 * ChatMessage - A message in the space chat
 */
export interface ChatMessage {
  id: string;
  sender_type: 'user' | 'bot';
  sender_id: string;
  content: string;
  metadata: string | null; // JSON
  created_at: number;
}

/**
 * Lineage - Parent-child relationship between variants
 */
export interface Lineage {
  id: string;
  parent_variant_id: string;
  child_variant_id: string;
  relation_type: 'refined' | 'combined' | 'spawned';
  severed: boolean; // User can cut the link if desired
  created_at: number;
}

// ============================================================================
// WebSocket Types
// ============================================================================

/**
 * WebSocket client metadata - attached when connection is accepted
 */
export interface WebSocketMeta {
  userId: string;
  role: 'owner' | 'editor' | 'viewer';
}

/**
 * Presence data for a user - tracks what they're viewing
 */
export interface UserPresence {
  userId: string;
  viewing: string | null; // Asset ID being viewed
  lastSeen: number;
}

// ============================================================================
// Message Types (Client → Server)
// ============================================================================

/**
 * All messages that can be sent from client to server via WebSocket
 */
export type ClientMessage =
  // Sync
  | { type: 'sync:request' }
  // Asset operations
  | { type: 'asset:create'; name: string; assetType: string; parentAssetId?: string }
  | { type: 'asset:update'; assetId: string; changes: { name?: string; tags?: string[]; type?: string; parentAssetId?: string | null } }
  | { type: 'asset:delete'; assetId: string }
  | { type: 'asset:setActive'; assetId: string; variantId: string }
  | { type: 'asset:spawn'; sourceVariantId: string; name: string; assetType: string; parentAssetId?: string }
  // Variant operations
  | { type: 'variant:delete'; variantId: string }
  | { type: 'variant:star'; variantId: string; starred: boolean }
  | { type: 'variant:retry'; variantId: string }
  // Lineage operations
  | { type: 'lineage:sever'; lineageId: string }
  // Presence
  | { type: 'presence:update'; viewing?: string }
  // Chat
  | { type: 'chat:send'; content: string }
  // Workflow-triggering messages
  | ChatRequestMessage
  | GenerateRequestMessage
  | RefineRequestMessage
  // Vision (describe/compare) messages
  | DescribeRequestMessage
  | CompareRequestMessage;

// ============================================================================
// Message Types (Server → Client)
// ============================================================================

/**
 * All messages that can be sent from server to client via WebSocket
 */
export type ServerMessage =
  // Sync (full state)
  | { type: 'sync:state'; assets: Asset[]; variants: Variant[]; lineage: Lineage[]; presence: UserPresence[] }
  // Asset mutations
  | { type: 'asset:created'; asset: Asset }
  | { type: 'asset:updated'; asset: Asset }
  | { type: 'asset:deleted'; assetId: string }
  | { type: 'asset:spawned'; asset: Asset; variant: Variant; lineage: Lineage }
  // Variant mutations
  | { type: 'variant:created'; variant: Variant }
  | { type: 'variant:updated'; variant: Variant }
  | { type: 'variant:deleted'; variantId: string }
  // Lineage mutations
  | { type: 'lineage:created'; lineage: Lineage }
  | { type: 'lineage:severed'; lineageId: string }
  // Job status
  | { type: 'job:progress'; jobId: string; status: string }
  | { type: 'job:completed'; jobId: string; variant: Variant }
  | { type: 'job:failed'; jobId: string; error: string }
  // Chat
  | { type: 'chat:message'; message: ChatMessage }
  // Presence
  | { type: 'presence:update'; presence: UserPresence[] }
  // Errors
  | { type: 'error'; code: string; message: string }
  // Workflow response messages
  | { type: 'chat:response'; requestId: string; success: boolean; response?: unknown; error?: string }
  | { type: 'generate:started'; requestId: string; jobId: string; assetId: string; assetName: string }
  | { type: 'generate:result'; requestId: string; jobId: string; success: boolean; variant?: Variant; error?: string }
  | { type: 'refine:started'; requestId: string; jobId: string; assetId: string; assetName: string }
  | { type: 'refine:result'; requestId: string; jobId: string; success: boolean; variant?: Variant; error?: string }
  // Vision (describe/compare) response messages
  | { type: 'describe:response'; requestId: string; success: boolean; description?: string; error?: string; usage?: ClaudeUsage }
  | { type: 'compare:response'; requestId: string; success: boolean; comparison?: string; error?: string; usage?: ClaudeUsage }
  // Pre-check error messages (quota/rate limit exceeded)
  | { type: 'chat:error'; requestId: string; error: string; code: string }
  | { type: 'generate:error'; requestId: string; error: string; code: string }
  | { type: 'refine:error'; requestId: string; error: string; code: string };

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Changes that can be applied to an asset
 */
export interface AssetChanges {
  name?: string;
  tags?: string[];
  type?: string;
  parent_asset_id?: string | null;
  active_variant_id?: string | null;
}

/**
 * Input for creating a new asset
 */
export interface CreateAssetInput {
  id?: string;
  name: string;
  type: string;
  parentAssetId?: string;
  createdBy: string;
}

/**
 * Input for spawning an asset from a variant
 */
export interface SpawnAssetInput {
  sourceVariantId: string;
  name: string;
  type: string;
  parentAssetId?: string;
  createdBy: string;
}

/**
 * Result of spawning an asset
 */
export interface SpawnResult {
  asset: Asset;
  variant: Variant;
  lineage: Lineage;
}
