import { injectable, inject } from 'inversify';
import { SpaceDAO } from '../../dao/space-dao';
import { TYPES } from '../../core/di-types';
import type { Env } from '../../core/types';

const SPACE_DELETION_GRACE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DeletedSpaceRetentionSweepResult {
  cutoff: string;
  spacesScanned: number;
  spacesPurged: number;
  doStoresPurged: number;
  r2ObjectsDeleted: number;
  errors: Array<{ spaceId: string; error: string }>;
}

interface SpaceDoPurgeResponse {
  success: true;
  r2ObjectsDeleted: number;
}

@injectable()
export class SpaceRetentionService {
  constructor(
    @inject(SpaceDAO) private spaceDAO: SpaceDAO,
    @inject(TYPES.Env) private env: Env,
  ) {}

  async sweepExpiredDeletedSpaces(now = new Date()): Promise<DeletedSpaceRetentionSweepResult> {
    const cutoff = new Date(now.getTime() - SPACE_DELETION_GRACE_DAYS * DAY_MS).toISOString();
    const spaces = await this.spaceDAO.getDeletedSpacesOlderThan(cutoff);
    const result: DeletedSpaceRetentionSweepResult = {
      cutoff,
      spacesScanned: spaces.length,
      spacesPurged: 0,
      doStoresPurged: 0,
      r2ObjectsDeleted: 0,
      errors: [],
    };

    for (const space of spaces) {
      try {
        const purged = await this.purgeSpaceDo(space.id);
        const deleted = await this.spaceDAO.purgeDeletedSpace(space.id);
        if (deleted) {
          result.spacesPurged++;
        }
        result.doStoresPurged++;
        result.r2ObjectsDeleted += purged.r2ObjectsDeleted;
      } catch (error) {
        result.errors.push({
          spaceId: space.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  private async purgeSpaceDo(spaceId: string): Promise<SpaceDoPurgeResponse> {
    if (!this.env.SPACES_DO) {
      throw new Error('SPACES_DO binding is not available');
    }

    const doId = this.env.SPACES_DO.idFromName(spaceId);
    const response = await this.env.SPACES_DO.get(doId).fetch(new Request('http://do/internal/purge', {
      method: 'DELETE',
      headers: { 'X-Space-Id': spaceId },
    }));
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`SpaceDO purge failed with ${response.status}${body ? `: ${body}` : ''}`);
    }

    return await response.json() as SpaceDoPurgeResponse;
  }
}
