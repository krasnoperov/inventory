import test from 'node:test';
import assert from 'node:assert/strict';
import type { D1Database } from '@cloudflare/workers-types';
import { getMemberRole } from './member-queries';

test('getMemberRole filters out archived spaces and memberships', async () => {
  let sql = '';
  let bindings: unknown[] = [];
  const db = {
    prepare(query: string) {
      sql = query;
      return {
        bind(...args: unknown[]) {
          bindings = args;
          return {
            first: async () => null,
          };
        },
      };
    },
  } as unknown as D1Database;

  const role = await getMemberRole(db, 'space-1', 42);

  assert.equal(role, null);
  assert.match(sql, /INNER JOIN spaces ON spaces\.id = space_members\.space_id/);
  assert.match(sql, /spaces\.deleted_at IS NULL/);
  assert.match(sql, /space_members\.deleted_at IS NULL/);
  assert.deepEqual(bindings, ['space-1', '42']);
});
