import test from 'node:test';
import assert from 'node:assert/strict';
import { executeInit } from './init';

test('executeInit saves stage project binding by default', async () => {
  const calls: unknown[] = [];

  const result = await executeInit({
    positionals: [],
    options: {
      space: 'space-1',
    },
  }, {
    saveProjectConfig: async (input) => {
      calls.push(input);
      return '/tmp/project/.inventory/config.json';
    },
  });

  assert.deepEqual(calls, [{ environment: 'stage', spaceId: 'space-1' }]);
  assert.equal(result.environment, 'stage');
  assert.equal(result.spaceId, 'space-1');
});

test('executeInit supports explicit environment and local shortcut', async () => {
  const production = await executeInit({
    positionals: [],
    options: {
      env: 'production',
      space: 'space-prod',
    },
  }, {
    saveProjectConfig: async () => '/tmp/project/.inventory/config.json',
  });

  const local = await executeInit({
    positionals: [],
    options: {
      local: 'true',
      space: 'space-local',
    },
  }, {
    saveProjectConfig: async () => '/tmp/project/.inventory/config.json',
  });

  assert.equal(production.environment, 'production');
  assert.equal(local.environment, 'local');
});
