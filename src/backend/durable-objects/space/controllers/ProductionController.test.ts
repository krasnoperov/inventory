// @ts-nocheck - Test file with dynamic mocks
import { describe, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ProductionController } from './ProductionController';
import { NotFoundError, ValidationError, type ControllerContext } from './types';

const placedVariant = {
  id: 'variant-1',
  asset_id: 'asset-1',
  media_kind: 'video',
};

function createController(overrides = {}) {
  const repo = {
    getProductionRecordsByProductionId: mock.fn(async () => []),
    getVariantById: mock.fn(async () => placedVariant),
    getVariantsByIds: mock.fn(async (ids: string[]) => ids.map((id) => ({ id }))),
    upsertProductionRecord: mock.fn(async (input) => ({
      id: input.id,
      production_id: input.productionId,
      variant_id: input.variantId,
      asset_id: input.assetId,
      media_kind: input.mediaKind,
      shot_id: input.shotId,
      scene_label: input.sceneLabel,
      timeline_start_ms: input.timelineStartMs,
      duration_ms: input.durationMs,
      motion_prompt: input.motionPrompt,
      source_refs: JSON.stringify(input.sourceRefs),
      source_variant_ids: JSON.stringify(input.sourceVariantIds),
      metadata: JSON.stringify(input.metadata),
      created_by: input.createdBy,
      created_at: 1,
      updated_at: 2,
    })),
    deleteProductionRecord: mock.fn(async () => true),
    ...overrides,
  };
  const controller = new ProductionController({
    spaceId: 'space-1',
    repo,
    env: {},
    sql: {},
    broadcast: mock.fn(),
    send: mock.fn(),
    sendError: mock.fn(),
  } as ControllerContext);
  return { controller, repo };
}

describe('ProductionController', () => {
  test('places a production record for a variant in this space', async () => {
    const { controller, repo } = createController();

    const record = await controller.httpPlaceRecord({
      id: 'record-1',
      productionId: 'episode-01',
      variantId: 'variant-1',
      shotId: 'shot-1',
      sceneLabel: 'Opening',
      timelineStartMs: 1000,
      durationMs: 2000,
      sourceVariantIds: ['source-1', 'source-1'],
      createdBy: 'user-1',
    });

    assert.equal(record.asset_id, 'asset-1');
    assert.equal(record.media_kind, 'video');
    assert.equal(repo.upsertProductionRecord.mock.calls[0].arguments[0].sourceVariantIds.length, 1);
  });

  test('rejects placement when variant is not in this space', async () => {
    const { controller } = createController({
      getVariantById: mock.fn(async () => null),
    });

    await assert.rejects(
      controller.httpPlaceRecord({
        productionId: 'episode-01',
        variantId: 'missing',
        sceneLabel: 'Opening',
        timelineStartMs: 0,
        createdBy: 'user-1',
      }),
      NotFoundError
    );
  });

  test('rejects source variants that are not in this space', async () => {
    const { controller } = createController({
      getVariantsByIds: mock.fn(async () => [{ id: 'source-1' }]),
    });

    await assert.rejects(
      controller.httpPlaceRecord({
        productionId: 'episode-01',
        variantId: 'variant-1',
        sceneLabel: 'Opening',
        timelineStartMs: 0,
        sourceVariantIds: ['source-1', 'missing-source'],
        createdBy: 'user-1',
      }),
      ValidationError
    );
  });
});
