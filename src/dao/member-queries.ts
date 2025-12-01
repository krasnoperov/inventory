/**
 * Member Queries - Lightweight D1 utilities
 *
 * For use in contexts where Kysely/DI isn't available (e.g., Durable Objects).
 * These mirror MemberDAO methods but work with raw D1 bindings.
 */

import type { D1Database } from '@cloudflare/workers-types';

export type MemberRole = 'owner' | 'editor' | 'viewer';

/**
 * Get a user's role in a space.
 * Returns null if user is not a member.
 */
export async function getMemberRole(
  db: D1Database,
  spaceId: string,
  userId: string | number
): Promise<MemberRole | null> {
  const result = await db
    .prepare('SELECT role FROM space_members WHERE space_id = ? AND user_id = ?')
    .bind(spaceId, String(userId))
    .first<{ role: MemberRole }>();

  return result?.role ?? null;
}

/**
 * Check if a user is a member of a space.
 */
export async function isMember(
  db: D1Database,
  spaceId: string,
  userId: string | number
): Promise<boolean> {
  const role = await getMemberRole(db, spaceId, userId);
  return role !== null;
}
