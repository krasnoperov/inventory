import test from 'node:test';
import assert from 'node:assert/strict';
import { executeInit } from './init';

test('executeInit saves production project binding by default', async () => {
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

  assert.deepEqual(calls, [{ environment: 'production', spaceId: 'space-1' }]);
  assert.equal(result.environment, 'production');
  assert.equal(result.spaceId, 'space-1');
});

test('executeInit can print JSON for agents', async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    lines.push(String(message));
  };

  try {
    await executeInit({
      positionals: [],
      options: {
        space: 'space-1',
        json: 'true',
      },
    }, {
      saveProjectConfig: async () => '/tmp/project/.inventory/config.json',
    });
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(JSON.parse(lines.join('\n')), {
    configPath: '/tmp/project/.inventory/config.json',
    environment: 'production',
    spaceId: 'space-1',
  });
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
