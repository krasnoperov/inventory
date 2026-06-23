import { injectable, inject } from 'inversify';
import type { Kysely } from 'kysely';
import type { Database, Space, NewSpace, SpaceUpdate } from '../db/types';
import { TYPES } from '../core/di-types';

export interface SupportSpaceMember {
  space_id: string;
  user_id: string;
  role: 'owner' | 'editor' | 'viewer';
  joined_at: number;
  deleted_at: string | null;
  user: {
    id: string;
    email: string;
    name: string | null;
  };
}

export interface SpaceRestoreResult {
  space: Space;
  previousDeletedAt: string;
  membershipsVisible: number;
  auditLogId: string;
}

@injectable()
export class SpaceDAO {
  constructor(@inject(TYPES.Database) private db: Kysely<Database>) {}

  async createSpace(data: NewSpace): Promise<Space> {
    const result = await this.db
      .insertInto('spaces')
      .values(data)
      .returningAll()
      .executeTakeFirst();

    if (!result) {
      throw new Error('Failed to create space');
    }

    return result;
  }

  async getSpaceById(id: string): Promise<Space | null> {
    const space = await this.db
      .selectFrom('spaces')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    return space ?? null;
  }

  async getSpaceByIdIncludingDeleted(id: string): Promise<Space | null> {
    const space = await this.db
      .selectFrom('spaces')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    return space ?? null;
  }

  async getSpaceMembersIncludingDeleted(id: string): Promise<SupportSpaceMember[]> {
    const members = await this.db
      .selectFrom('space_members')
      .leftJoin('users', 'space_members.user_id', 'users.id')
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
      .where('space_members.space_id', '=', id)
      .orderBy('space_members.joined_at', 'asc')
      .execute();

    return members.map((row) => ({
      space_id: row.space_id,
      user_id: row.user_id,
      role: row.role,
      joined_at: row.joined_at,
      deleted_at: row.deleted_at,
      user: {
        id: String(row.user_id_alias ?? row.user_id),
        email: row.user_email ?? '',
        name: row.user_name ?? null,
      },
    }));
  }

  async getSpacesByOwnerId(ownerId: string): Promise<Space[]> {
    return await this.db
      .selectFrom('spaces')
      .selectAll()
      .where('owner_id', '=', ownerId)
      .where('deleted_at', 'is', null)
      .execute();
  }

  async getSpacesForUser(userId: string): Promise<Array<Space & { role: string }>> {
    return await this.db
      .selectFrom('spaces')
      .innerJoin('space_members', 'spaces.id', 'space_members.space_id')
      .selectAll('spaces')
      .select('space_members.role')
      .where('space_members.user_id', '=', userId)
      .where('spaces.deleted_at', 'is', null)
      .where('space_members.deleted_at', 'is', null)
      .execute();
  }

  async updateSpace(id: string, changes: SpaceUpdate): Promise<Space | null> {
    const result = await this.db
      .updateTable('spaces')
      .set(changes)
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returningAll()
      .executeTakeFirst();

    return result ?? null;
  }

  async deleteSpace(id: string): Promise<boolean> {
    const now = new Date().toISOString();
    const result = await this.db
      .updateTable('spaces')
      .set({ deleted_at: now })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  }

  async restoreDeletedSpace(id: string, restoredByUserId: number): Promise<SpaceRestoreResult | null> {
    const existing = await this.getSpaceByIdIncludingDeleted(id);
    if (!existing?.deleted_at) {
      return null;
    }

    const restoredAt = new Date().toISOString();
    const visibleMembership = await this.db
      .selectFrom('space_members')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('space_id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    const membershipsVisible = Number(visibleMembership?.count ?? 0);

    const space = await this.db
      .updateTable('spaces')
      .set({ deleted_at: null })
      .where('id', '=', id)
      .where('deleted_at', 'is not', null)
      .returningAll()
      .executeTakeFirst();

    if (!space) {
      return null;
    }

    const auditLogId = crypto.randomUUID();
    await this.db
      .insertInto('space_restore_audit_logs')
      .values({
        id: auditLogId,
        space_id: id,
        restored_by_user_id: restoredByUserId,
        restored_at: restoredAt,
        previous_deleted_at: existing.deleted_at,
        memberships_visible: membershipsVisible,
      })
      .executeTakeFirst();

    return {
      space,
      previousDeletedAt: existing.deleted_at,
      membershipsVisible,
      auditLogId,
    };
  }

  async getDeletedSpacesOlderThan(cutoffIso: string): Promise<Space[]> {
    return await this.db
      .selectFrom('spaces')
      .selectAll()
      .where('deleted_at', 'is not', null)
      .where('deleted_at', '<', cutoffIso)
      .orderBy('deleted_at', 'asc')
      .execute();
  }

  async purgeDeletedSpace(id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('spaces')
      .where('id', '=', id)
      .where('deleted_at', 'is not', null)
      .executeTakeFirst();

    return result.numDeletedRows > 0n;
  }
}
