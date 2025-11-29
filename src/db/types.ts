import type { Generated, Insertable, Selectable, Updateable } from 'kysely';

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
}

export interface SpaceMembersTable {
  space_id: string;
  user_id: string;
  role: 'owner' | 'editor' | 'viewer';
  joined_at: number;
}

export interface AssetIndexTable {
  id: string;
  space_id: string;
  name: string;
  type: string;
  tags: string | null;
  thumb_key: string | null;
  updated_at: number;
}

export interface JobsTable {
  id: string;
  space_id: string;
  // Job types:
  // - 'generate': Fresh AI generation for new asset (no references)
  // - 'derive': AI generation with references (single ref = derive, multiple = compose)
  // - 'compose': AI generation combining multiple references
  // Note: 'fork' is synchronous copy, doesn't create a job
  type: 'generate' | 'derive' | 'compose';
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'stuck';
  input: string;  // JSON
  result_variant_id: string | null;
  error: string | null;
  attempts: number;
  created_by: string;
  created_at: number;
  updated_at: number;
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
  created_at: string;
  synced_at: string | null;  // NULL until synced to Polar
  // Sync reliability tracking
  sync_attempts: number;
  last_sync_error: string | null;
  last_sync_attempt_at: string | null;
}

export interface Database {
  users: UsersTable;
  spaces: SpacesTable;
  space_members: SpaceMembersTable;
  asset_index: AssetIndexTable;
  jobs: JobsTable;
  usage_events: UsageEventsTable;
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

// AssetIndex types
export type AssetIndex = Selectable<AssetIndexTable>;
export type NewAssetIndex = Insertable<AssetIndexTable>;
export type AssetIndexUpdate = Updateable<AssetIndexTable>;

// Job types
export type Job = Selectable<JobsTable>;
export type NewJob = Insertable<JobsTable>;
export type JobUpdate = Updateable<JobsTable>;

// UsageEvent types
export type UsageEvent = Selectable<UsageEventsTable>;
export type NewUsageEvent = Insertable<UsageEventsTable>;
export type UsageEventUpdate = Updateable<UsageEventsTable>;
