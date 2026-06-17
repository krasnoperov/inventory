import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GENERATION_REQUEST_TIMEOUT_MS,
  VIDEO_GENERATION_REQUEST_TIMEOUT_MS,
  getGenerationRequestTimeoutMs,
} from './websocket-client';

test('generation request timeout matches backend media workflow limits', () => {
  assert.equal(getGenerationRequestTimeoutMs(), GENERATION_REQUEST_TIMEOUT_MS);
  assert.equal(getGenerationRequestTimeoutMs('image'), GENERATION_REQUEST_TIMEOUT_MS);
  assert.equal(getGenerationRequestTimeoutMs('audio'), GENERATION_REQUEST_TIMEOUT_MS);
  assert.equal(getGenerationRequestTimeoutMs('video'), VIDEO_GENERATION_REQUEST_TIMEOUT_MS);

  assert.ok(VIDEO_GENERATION_REQUEST_TIMEOUT_MS > 10 * 60 * 1000);
});
