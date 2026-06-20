import test from 'node:test';
import assert from 'node:assert/strict';
import { isFeatureFlagEnabled } from './featureFlags';

test('feature flags are disabled by default', () => {
  assert.equal(isFeatureFlagEnabled(undefined), false);
  assert.equal(isFeatureFlagEnabled(''), false);
  assert.equal(isFeatureFlagEnabled('false'), false);
  assert.equal(isFeatureFlagEnabled('0'), false);
});

test('feature flags accept common enabled values', () => {
  assert.equal(isFeatureFlagEnabled(true), true);
  assert.equal(isFeatureFlagEnabled(1), true);
  assert.equal(isFeatureFlagEnabled('true'), true);
  assert.equal(isFeatureFlagEnabled('TRUE'), true);
  assert.equal(isFeatureFlagEnabled('1'), true);
  assert.equal(isFeatureFlagEnabled('yes'), true);
  assert.equal(isFeatureFlagEnabled('on'), true);
});

