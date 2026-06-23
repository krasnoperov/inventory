import type { Generated, Insertable, Selectable, Updateable } from 'kysely';
import type { CustomerChargeUnit } from '../backend/billing/customerChargeLedger';
import type { PaidGenerationEntitlement } from '../backend/billing/paidGenerationEntitlement';

export type { CustomerChargeUnit };

// ============================================================================
// BARE FRAMEWORK FOUNDATION - Database Types
// ============================================================================
// This file contains only the core user management types.
// Add your domain-specific tables and types here when building your application.

export interface UsersTable {
  id: Generated<number>;
  email: string;
  name: string;
  google_id: string | null;
  polar_customer_id: string | null;
  paid_generation_entitlement: PaidGenerationEntitlement;
  // Quota limits cached from Polar webhooks
  // JSON: {"claude_output_tokens": 100000, "gemini_images": 50, "gemini_videos": 10, "gemini_audio": 10, "elevenlabs_audio": 5000}
  quota_limits: string | null;
  quota_limits_updated_at: string | null;
  polar_current_period_start: string | null;
  polar_current_period_end: string | null;
  polar_paid_access_expires_at: string | null;
  // Rate limiting (fixed window)
  rate_limit_count: number;
  rate_limit_window_start: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// PHASE 1 - Spaces and Asset Management
// ============================================================================

export interface SpacesTable {
  id: string;
  name: string;
  owner_id: string;
  created_at: number;
  deleted_at: Generated<string | null>;
}

export interface SpaceMembersTable {
  space_id: string;
  user_id: string;
  role: 'owner' | 'editor' | 'viewer';
  joined_at: number;
  deleted_at: Generated<string | null>;
}

export interface SpaceRestoreAuditLogsTable {
  id: string;
  space_id: string;
  restored_by_user_id: number;
  restored_at: string;
  previous_deleted_at: string;
  memberships_visible: number;
}

// ============================================================================
// BILLING - Usage Tracking
// ============================================================================

export interface UsageEventsTable {
  id: Generated<string>;
  user_id: number;
  event_name: string;  // 'claude_tokens', 'nanobanana_images'
  quantity: number;
  metadata: string | null;  // JSON
  // 1 = sync to Polar, 0 = local observability only
  polar_billable: Generated<number>;
  created_at: string;
  synced_at: string | null;  // NULL until synced to Polar
  // Sync reliability tracking
  sync_attempts: number;
  last_sync_error: string | null;
  last_sync_attempt_at: string | null;
}

export type ProviderUsageMediaKind = 'image' | 'audio' | 'video';
export type PlatformUsageType = 'storage' | 'workflow' | 'delivery';
export type PlatformUsageUnit = 'byte' | 'run';

export interface ProviderUsageLedgerTable {
  id: Generated<string>;
  attribution_key: string;
  usage_event_id: string | null;
  user_id: number;
  space_id: string | null;
  asset_id: string | null;
  variant_id: string | null;
  workflow_id: string | null;
  request_id: string | null;
  provider: string;
  provider_model: string;
  operation: string | null;
  media_kind: ProviderUsageMediaKind | null;
  meter_event_name: string | null;
  usage_unit: string;
  quantity: number;
  unit_price_usd: number | null;
  amount_micro_usd: number | null;
  currency: string;
  pricing_source: string | null;
  provider_request_id: string | null;
  provider_response_id: string | null;
  provider_usage_id: string | null;
  metadata: string | null;
  created_at: string;
}

export interface CustomerChargeLedgerTable {
  id: Generated<string>;
  charge_key: string;
  usage_event_id: string | null;
  provider_usage_ledger_id: string | null;
  user_id: number;
  meter_event_name: string;
  charge_unit: CustomerChargeUnit;
  quantity: number;
  polar_billable: Generated<number>;
  billing_provider: Generated<'polar'>;
  billing_external_id: string;
  customer_amount_micro_usd: number | null;
  currency: Generated<'USD'>;
  metadata: string | null;
  created_at: string;
}

export interface PlatformUsageEventsTable {
  id: Generated<string>;
  idempotency_key: string;
  space_id: string;
  user_id: number | null;
  usage_type: PlatformUsageType;
  quantity: number;
  unit: PlatformUsageUnit;
  asset_id: string | null;
  variant_id: string | null;
  workflow_id: string | null;
  request_id: string | null;
  artifact_key: string | null;
  operation: string | null;
  media_kind: ProviderUsageMediaKind | null;
  metadata: string | null;
  created_at: string;
}

export type UserProviderKeyProvider = 'google_ai' | 'anthropic' | 'elevenlabs' | 'lyria';

export interface UserProviderKeysTable {
  user_id: number;
  provider: UserProviderKeyProvider;
  encrypted_api_key: string;
  key_hint: string;
  created_at: string;
  updated_at: string;
}

export interface KeyEnvelopesTable {
  scope_id: string;
  wrapped_dek: string;
  dek_version: number;
  kek_version: number;
  created_at: string;
  updated_at: string;
}

export interface AccountDeletionTombstonesTable {
  id: string;
  user_id: number;
  source: 'self_service' | 'restore_reapply';
  owned_spaces_purged: number;
  owned_space_ids: string;
  r2_key: string | null;
  deleted_at: string;
  created_at: string;
}

export interface Database {
  users: UsersTable;
  spaces: SpacesTable;
  space_members: SpaceMembersTable;
  space_restore_audit_logs: SpaceRestoreAuditLogsTable;
  usage_events: UsageEventsTable;
  provider_usage_ledger: ProviderUsageLedgerTable;
  customer_charge_ledger: CustomerChargeLedgerTable;
  platform_usage_events: PlatformUsageEventsTable;
  user_provider_keys: UserProviderKeysTable;
  key_envelopes: KeyEnvelopesTable;
  account_deletion_tombstones: AccountDeletionTombstonesTable;
  // Phase 2: Assistant Memory
  user_patterns: UserPatternsTable;
  user_feedback: UserFeedbackTable;
  user_preferences: UserPreferencesTable;
}

// User types
export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;

// Session user (non-sensitive fields for JWT/client)
export interface SessionUser {
  id: number;
  email: string;
  name: string;
  google_id: string | null;
}

// Space types
export type Space = Selectable<SpacesTable>;
export type NewSpace = Insertable<SpacesTable>;
export type SpaceUpdate = Updateable<SpacesTable>;

// SpaceMember types
export type SpaceMember = Selectable<SpaceMembersTable>;
export type NewSpaceMember = Insertable<SpaceMembersTable>;
export type SpaceMemberUpdate = Updateable<SpaceMembersTable>;

// UsageEvent types
export type UsageEvent = Selectable<UsageEventsTable>;
export type NewUsageEvent = Insertable<UsageEventsTable>;
export type UsageEventUpdate = Updateable<UsageEventsTable>;

// Provider usage ledger types
export type ProviderUsageLedgerEntry = Selectable<ProviderUsageLedgerTable>;
export type NewProviderUsageLedgerEntry = Insertable<ProviderUsageLedgerTable>;
export type ProviderUsageLedgerEntryUpdate = Updateable<ProviderUsageLedgerTable>;

// Customer charge ledger types
export type CustomerChargeLedgerEntry = Selectable<CustomerChargeLedgerTable>;
export type NewCustomerChargeLedgerEntry = Insertable<CustomerChargeLedgerTable>;
export type CustomerChargeLedgerEntryUpdate = Updateable<CustomerChargeLedgerTable>;

// Platform usage event types
export type PlatformUsageEvent = Selectable<PlatformUsageEventsTable>;
export type NewPlatformUsageEvent = Insertable<PlatformUsageEventsTable>;
export type PlatformUsageEventUpdate = Updateable<PlatformUsageEventsTable>;

export type UserProviderKey = Selectable<UserProviderKeysTable>;
export type NewUserProviderKey = Insertable<UserProviderKeysTable>;
export type UserProviderKeyUpdate = Updateable<UserProviderKeysTable>;

// ============================================================================
// PHASE 2 - Assistant Memory & Personalization
// ============================================================================

export interface UserPatternsTable {
  id: string;
  user_id: number;
  space_id: string | null;  // NULL = global pattern
  asset_type: string;  // 'character', 'scene', 'object', etc.
  prompt_text: string;
  prompt_hash: string;
  success_count: number;
  total_uses: number;
  style_tags: string | null;  // JSON array
  last_used_at: string;
  created_at: string;
}

export interface UserFeedbackTable {
  id: string;
  user_id: number;
  variant_id: string;
  rating: 'positive' | 'negative';
  prompt: string | null;
  created_at: string;
}

export interface UserPreferencesTable {
  user_id: number;
  default_art_style: string | null;
  default_aspect_ratio: string | null;
  auto_execute_safe: boolean;
  auto_approve_low_cost: boolean;
  inject_patterns: boolean;
  max_patterns_context: number;
  created_at: string;
  updated_at: string;
}

// UserPattern types
export type UserPattern = Selectable<UserPatternsTable>;
export type NewUserPattern = Insertable<UserPatternsTable>;
export type UserPatternUpdate = Updateable<UserPatternsTable>;

// UserFeedback types
export type UserFeedback = Selectable<UserFeedbackTable>;
export type NewUserFeedback = Insertable<UserFeedbackTable>;
export type UserFeedbackUpdate = Updateable<UserFeedbackTable>;

// UserPreferences types
export type UserPreferences = Selectable<UserPreferencesTable>;
export type NewUserPreferences = Insertable<UserPreferencesTable>;
export type UserPreferencesUpdate = Updateable<UserPreferencesTable>;
