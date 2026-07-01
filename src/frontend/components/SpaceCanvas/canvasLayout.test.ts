import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { columnCountForLayout, estimateFrameHeight, MAX_COLUMNS } from './canvasLayout';

describe('columnCountForLayout', () => {
  test('a single frame is always one column', () => {
    assert.equal(columnCountForLayout(400, 1.6, 1), 1);
  });

  test('a wider viewport uses more columns than a portrait one for the same content', () => {
    const wide = columnCountForLayout(4000, 1.8, 20);
    const tall = columnCountForLayout(4000, 0.6, 20);
    assert.ok(wide > tall, `expected wide(${wide}) > tall(${tall})`);
  });

  test('more total content height yields more columns', () => {
    const few = columnCountForLayout(1500, 1.6, 20);
    const many = columnCountForLayout(12000, 1.6, 20);
    assert.ok(many > few, `expected many(${many}) > few(${few})`);
  });

  test('never exceeds the frame count', () => {
    assert.ok(columnCountForLayout(8000, 1.6, 3) <= 3);
  });

  test('caps at MAX_COLUMNS for huge spaces', () => {
    assert.equal(columnCountForLayout(200000, 3, 500), MAX_COLUMNS);
  });
});

describe('estimateFrameHeight', () => {
  test('empty frames reserve only header height', () => {
    const empty = estimateFrameHeight(0);
    const oneCard = estimateFrameHeight(1);

    assert.ok(empty > 0);
    assert.ok(empty < oneCard, `expected empty(${empty}) < oneCard(${oneCard})`);
  });
});
