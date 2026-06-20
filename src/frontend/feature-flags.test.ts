import test from 'node:test';
import assert from 'node:assert/strict';
import { isWebRotationEnabled } from './feature-flags';
import type { StartSession } from './app-context';

test('web rotation flag reads the runtime session feature', () => {
  const session: StartSession = {
    config: {
      googleClientId: 'google-client',
      environment: 'test',
      features: {
        rotation: true,
      },
    },
    user: null,
  };

  assert.equal(isWebRotationEnabled(session), true);
});

test('web rotation flag is disabled until session features enable it', () => {
  assert.equal(isWebRotationEnabled(null), false);
  assert.equal(isWebRotationEnabled(undefined), false);
  assert.equal(isWebRotationEnabled({
    config: {
      googleClientId: 'google-client',
      environment: 'test',
      features: {
        rotation: false,
      },
    },
    user: null,
  }), false);
});
