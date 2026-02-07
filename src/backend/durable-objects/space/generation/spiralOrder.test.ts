import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getSpiralOrder } from './spiralOrder';

describe('getSpiralOrder', () => {
  test('center position is correct for odd grid', () => {
    const order = getSpiralOrder(3, 3);
    assert.deepStrictEqual(order[0], [1, 1]);
  });

  test('center position is correct for even grid', () => {
    const order = getSpiralOrder(4, 4);
    assert.deepStrictEqual(order[0], [2, 2]);
  });

  test('center position is correct for rectangular grid', () => {
    const order = getSpiralOrder(5, 3);
    assert.deepStrictEqual(order[0], [2, 1]);
  });

  test('returns exactly w*h positions', () => {
    for (const [w, h] of [[2, 2], [3, 3], [4, 4], [5, 5], [3, 5]]) {
      const order = getSpiralOrder(w, h);
      assert.strictEqual(order.length, w * h, `${w}x${h} should have ${w * h} positions`);
    }
  });

  test('no duplicate positions', () => {
    const order = getSpiralOrder(5, 5);
    const keys = new Set(order.map(([x, y]) => `${x},${y}`));
    assert.strictEqual(keys.size, order.length);
  });

  test('all positions are within bounds', () => {
    const w = 4, h = 3;
    const order = getSpiralOrder(w, h);
    for (const [x, y] of order) {
      assert.ok(x >= 0 && x < w, `x=${x} out of bounds for w=${w}`);
      assert.ok(y >= 0 && y < h, `y=${y} out of bounds for h=${h}`);
    }
  });

  test('BFS order: each position adjacent to some earlier position', () => {
    const order = getSpiralOrder(4, 4);
    const visited = new Set<string>();
    visited.add(`${order[0][0]},${order[0][1]}`);

    for (let i = 1; i < order.length; i++) {
      const [x, y] = order[i];
      const hasAdjacentPredecessor = [
        [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1],
      ].some(([nx, ny]) => visited.has(`${nx},${ny}`));
      assert.ok(hasAdjacentPredecessor, `Position [${x},${y}] at index ${i} has no adjacent predecessor`);
      visited.add(`${x},${y}`);
    }
  });

  test('1x1 grid returns single center position', () => {
    const order = getSpiralOrder(1, 1);
    assert.strictEqual(order.length, 1);
    assert.deepStrictEqual(order[0], [0, 0]);
  });

  test('2x2 grid returns 4 positions', () => {
    const order = getSpiralOrder(2, 2);
    assert.strictEqual(order.length, 4);
    // Center of 2x2 is floor(2/2)=1, floor(2/2)=1
    assert.deepStrictEqual(order[0], [1, 1]);
  });
});
