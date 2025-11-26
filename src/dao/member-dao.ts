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
      })
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
      .selectAll()
      .where('space_id', '=', spaceId)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    return member ?? null;
  }

  async getMembersBySpaceId(
    spaceId: string
  ): Promise<Array<SpaceMember & { user: { id: string; email: string; name: string | null } }>> {
    const members = await this.db
      .selectFrom('space_members')
      .innerJoin('users', 'space_members.user_id', 'users.id')
      .select([
        'space_members.space_id',
        'space_members.user_id',
        'space_members.role',
        'space_members.joined_at',
        'users.id as user_id_alias',
        'users.email as user_email',
        'users.name as user_name',
      ])
      .where('space_members.space_id', '=', spaceId)
      .execute();

    return members.map((row) => ({
      space_id: row.space_id,
      user_id: row.user_id,
      role: row.role,
      joined_at: row.joined_at,
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
      .selectAll()
      .where('user_id', '=', userId)
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
      .returningAll()
      .executeTakeFirst();

    return result ?? null;
  }

  async removeMember(spaceId: string, userId: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('space_members')
      .where('space_id', '=', spaceId)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    return (result.numDeletedRows ?? 0n) > 0n;
  }

  async isSpaceMember(spaceId: string, userId: string): Promise<boolean> {
    const member = await this.db
      .selectFrom('space_members')
      .select('user_id')
      .where('space_id', '=', spaceId)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    return member !== undefined;
  }

  async getMemberRole(
    spaceId: string,
    userId: string
  ): Promise<string | null> {
    const member = await this.db
      .selectFrom('space_members')
      .select('role')
      .where('space_id', '=', spaceId)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    return member?.role ?? null;
  }
}
