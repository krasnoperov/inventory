import { injectable, inject } from 'inversify';
import type { Kysely } from 'kysely';
import type { Database, SpaceMember, NewSpaceMember } from '../db/types';
import { TYPES } from '../core/di-types';

@injectable()
export class MemberDAO {
  constructor(@inject(TYPES.Database) private db: Kysely<Database>) {}

  async addMember(data: NewSpaceMember): Promise<SpaceMember> {
    const result = await this.db
      .insertInto('space_members')
      .values({
        space_id: data.space_id,
        user_id: data.user_id,
        role: data.role,
        joined_at: data.joined_at ?? Date.now(),
        deleted_at: null,
      })
      .onConflict((oc) => oc.columns(['space_id', 'user_id']).doUpdateSet({
        role: data.role,
        joined_at: data.joined_at ?? Date.now(),
        deleted_at: null,
      }))
      .returningAll()
      .executeTakeFirst();

    if (!result) {
      throw new Error('Failed to add member');
    }

    return result;
  }

  async getMember(
    spaceId: string,
    userId: string
  ): Promise<SpaceMember | null> {
    const member = await this.db
      .selectFrom('space_members')
      .innerJoin('spaces', 'spaces.id', 'space_members.space_id')
      .selectAll('space_members')
      .where('space_members.space_id', '=', spaceId)
      .where('space_members.user_id', '=', userId)
      .where('spaces.deleted_at', 'is', null)
      .where('space_members.deleted_at', 'is', null)
      .executeTakeFirst();

    return member ?? null;
  }

  async getMembersBySpaceId(
    spaceId: string
  ): Promise<Array<SpaceMember & { user: { id: string; email: string; name: string | null } }>> {
    const members = await this.db
      .selectFrom('space_members')
      .innerJoin('spaces', 'spaces.id', 'space_members.space_id')
      .innerJoin('users', 'space_members.user_id', 'users.id')
      .select([
        'space_members.space_id',
        'space_members.user_id',
        'space_members.role',
        'space_members.joined_at',
        'space_members.deleted_at',
        'users.id as user_id_alias',
        'users.email as user_email',
        'users.name as user_name',
      ])
      .where('space_members.space_id', '=', spaceId)
      .where('spaces.deleted_at', 'is', null)
      .where('space_members.deleted_at', 'is', null)
      .execute();

    return members.map((row) => ({
      space_id: row.space_id,
      user_id: row.user_id,
      role: row.role,
      joined_at: row.joined_at,
      deleted_at: row.deleted_at,
      user: {
        id: String(row.user_id_alias),
        email: row.user_email,
        name: row.user_name,
      },
    }));
  }

  async getMembershipsByUserId(userId: string): Promise<SpaceMember[]> {
    return await this.db
      .selectFrom('space_members')
      .innerJoin('spaces', 'spaces.id', 'space_members.space_id')
      .selectAll('space_members')
      .where('space_members.user_id', '=', userId)
      .where('spaces.deleted_at', 'is', null)
      .where('space_members.deleted_at', 'is', null)
      .execute();
  }

  async updateMemberRole(
    spaceId: string,
    userId: string,
    role: 'owner' | 'editor' | 'viewer'
  ): Promise<SpaceMember | null> {
    const result = await this.db
      .updateTable('space_members')
      .set({ role })
      .where('space_id', '=', spaceId)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .returningAll()
      .executeTakeFirst();

    return result ?? null;
  }

  async removeMember(spaceId: string, userId: string): Promise<boolean> {
    const now = new Date().toISOString();
    const result = await this.db
      .updateTable('space_members')
      .set({ deleted_at: now })
      .where('space_id', '=', spaceId)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    return (result.numUpdatedRows ?? 0n) > 0n;
  }

  async isSpaceMember(spaceId: string, userId: string): Promise<boolean> {
    const member = await this.db
      .selectFrom('space_members')
      .innerJoin('spaces', 'spaces.id', 'space_members.space_id')
      .select('space_members.user_id')
      .where('space_members.space_id', '=', spaceId)
      .where('space_members.user_id', '=', userId)
      .where('spaces.deleted_at', 'is', null)
      .where('space_members.deleted_at', 'is', null)
      .executeTakeFirst();

    return member !== undefined;
  }

  async getMemberRole(
    spaceId: string,
    userId: string
  ): Promise<string | null> {
    const member = await this.db
      .selectFrom('space_members')
      .innerJoin('spaces', 'spaces.id', 'space_members.space_id')
      .select('space_members.role')
      .where('space_members.space_id', '=', spaceId)
      .where('space_members.user_id', '=', userId)
      .where('spaces.deleted_at', 'is', null)
      .where('space_members.deleted_at', 'is', null)
      .executeTakeFirst();

    return member?.role ?? null;
  }
}
