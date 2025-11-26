import { injectable, inject } from 'inversify';
import type { Kysely } from 'kysely';
import type { Database, Space, NewSpace, SpaceUpdate } from '../db/types';
import { TYPES } from '../core/di-types';

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
      .executeTakeFirst();

    return space ?? null;
  }

  async getSpacesByOwnerId(ownerId: string): Promise<Space[]> {
    return await this.db
      .selectFrom('spaces')
      .selectAll()
      .where('owner_id', '=', ownerId)
      .execute();
  }

  async getSpacesForUser(userId: string): Promise<Array<Space & { role: string }>> {
    return await this.db
      .selectFrom('spaces')
      .innerJoin('space_members', 'spaces.id', 'space_members.space_id')
      .selectAll('spaces')
      .select('space_members.role')
      .where('space_members.user_id', '=', userId)
      .execute();
  }

  async updateSpace(id: string, changes: SpaceUpdate): Promise<Space | null> {
    const result = await this.db
      .updateTable('spaces')
      .set(changes)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();

    return result ?? null;
  }

  async deleteSpace(id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('spaces')
      .where('id', '=', id)
      .executeTakeFirst();

    return result.numDeletedRows > 0n;
  }
}
