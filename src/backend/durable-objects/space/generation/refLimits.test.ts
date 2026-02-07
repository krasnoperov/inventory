import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { capRefs } from './refLimits';

describe('capRefs', () => {
  test('pipeline keys within budget returned as-is', () => {
    const result = capRefs([], ['a', 'b', 'c'], 'a', 14);
    assert.deepStrictEqual(result, ['a', 'b', 'c']);
  });

  test('empty style keys uses full budget', () => {
    const keys = Array.from({ length: 14 }, (_, i) => `key-${i}`);
    const result = capRefs([], keys, 'key-0', 14);
    assert.deepStrictEqual(result, keys);
  });

  test('style keys reduce budget', () => {
    const styleKeys = ['s1', 's2', 's3'];
    const pipelineKeys = Array.from({ length: 14 }, (_, i) => `p-${i}`);
    const result = capRefs(styleKeys, pipelineKeys, 'p-0', 14);
    // Budget = 14 - 3 = 11
    assert.strictEqual(result.length, 11);
  });

  test('style keys exhaust budget returns empty', () => {
    const styleKeys = Array.from({ length: 14 }, (_, i) => `s-${i}`);
    const result = capRefs(styleKeys, ['p1', 'p2'], 'p1', 14);
    assert.deepStrictEqual(result, []);
  });

  test('style keys exceed budget returns empty', () => {
    const styleKeys = Array.from({ length: 16 }, (_, i) => `s-${i}`);
    const result = capRefs(styleKeys, ['p1'], 'p1', 14);
    assert.deepStrictEqual(result, []);
  });

  test('over budget: source key preserved first, most recent fill remainder', () => {
    const pipelineKeys = ['source', 'old1', 'old2', 'old3', 'recent1', 'recent2'];
    const result = capRefs([], pipelineKeys, 'source', 4);
    // Budget = 4, need to cap 6 keys to 4: [source, ...last 3]
    assert.strictEqual(result.length, 4);
    assert.strictEqual(result[0], 'source');
    assert.deepStrictEqual(result.slice(1), ['old3', 'recent1', 'recent2']);
  });

  test('over budget with style keys', () => {
    const styleKeys = ['s1', 's2'];
    const pipelineKeys = ['source', 'v1', 'v2', 'v3', 'v4', 'v5'];
    const result = capRefs(styleKeys, pipelineKeys, 'source', 6);
    // Budget = 6 - 2 = 4: [source, ...last 3]
    assert.strictEqual(result.length, 4);
    assert.strictEqual(result[0], 'source');
    assert.deepStrictEqual(result.slice(1), ['v3', 'v4', 'v5']);
  });

  test('default maxTotal is 14', () => {
    const pipelineKeys = Array.from({ length: 14 }, (_, i) => `key-${i}`);
    const result = capRefs([], pipelineKeys, 'key-0');
    assert.deepStrictEqual(result, pipelineKeys);

    // 15 keys should be capped
    const moreKeys = Array.from({ length: 15 }, (_, i) => `key-${i}`);
    const capped = capRefs([], moreKeys, 'key-0');
    assert.strictEqual(capped.length, 14);
  });

  test('single pipeline key within budget', () => {
    const result = capRefs([], ['only'], 'only', 14);
    assert.deepStrictEqual(result, ['only']);
  });

  test('budget of 1 with exactly 1 key returns it', () => {
    const result = capRefs([], ['source'], 'source', 1);
    assert.deepStrictEqual(result, ['source']);
  });
});
