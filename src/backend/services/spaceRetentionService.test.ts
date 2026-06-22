import test from 'node:test';
import assert from 'node:assert/strict';
import { SpaceRetentionService } from './spaceRetentionService';
import type { SpaceDAO } from '../../dao/space-dao';
import type { Env } from '../../core/types';

test('sweepExpiredDeletedSpaces purges DO state before hard-deleting D1 space rows', async () => {
  const calls: string[] = [];
  const fakeSpaceDAO = {
    getDeletedSpacesOlderThan: async (cutoff: string) => {
      calls.push(`list:${cutoff}`);
      return [{
        id: 'space-old',
        name: 'Old Space',
        owner_id: '1',
        created_at: 1,
        deleted_at: '2026-05-01T00:00:00.000Z',
      }];
    },
    purgeDeletedSpace: async (id: string) => {
      calls.push(`purge-d1:${id}`);
      return true;
    },
  } as unknown as SpaceDAO;
  const fakeEnv = {
    SPACES_DO: {
      idFromName: (id: string) => {
        calls.push(`id:${id}`);
        return id;
      },
      get: (id: string) => ({
        fetch: async (request: Request) => {
          calls.push(`${request.method}:${id}:${new URL(request.url).pathname}:${request.headers.get('X-Space-Id')}`);
          return Response.json({ success: true, r2ObjectsDeleted: 3 });
        },
      }),
    },
  } as unknown as Env;

  const service = new SpaceRetentionService(fakeSpaceDAO, fakeEnv);
  const result = await service.sweepExpiredDeletedSpaces(new Date('2026-06-22T00:00:00.000Z'));

  assert.equal(result.cutoff, '2026-05-23T00:00:00.000Z');
  assert.equal(result.spacesScanned, 1);
  assert.equal(result.spacesPurged, 1);
  assert.equal(result.doStoresPurged, 1);
  assert.equal(result.r2ObjectsDeleted, 3);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(calls, [
    'list:2026-05-23T00:00:00.000Z',
    'id:space-old',
    'DELETE:space-old:/internal/purge:space-old',
    'purge-d1:space-old',
  ]);
});

test('sweepExpiredDeletedSpaces keeps D1 rows when DO purge fails', async () => {
  const calls: string[] = [];
  const fakeSpaceDAO = {
    getDeletedSpacesOlderThan: async () => [{
      id: 'space-old',
      name: 'Old Space',
      owner_id: '1',
      created_at: 1,
      deleted_at: '2026-05-01T00:00:00.000Z',
    }],
    purgeDeletedSpace: async (id: string) => {
      calls.push(`purge-d1:${id}`);
      return true;
    },
  } as unknown as SpaceDAO;

  const service = new SpaceRetentionService(fakeSpaceDAO, {} as Env);
  const result = await service.sweepExpiredDeletedSpaces(new Date('2026-06-22T00:00:00.000Z'));

  assert.equal(result.spacesPurged, 0);
  assert.equal(result.doStoresPurged, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]?.spaceId, 'space-old');
  assert.match(result.errors[0]?.error ?? '', /SPACES_DO binding is not available/);
  assert.deepEqual(calls, []);
});
