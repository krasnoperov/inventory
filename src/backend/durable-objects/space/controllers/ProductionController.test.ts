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
    getAllProductions: mock.fn(async () => []),
    getProductionById: mock.fn(async (id: string) => ({
      id,
      name: 'Episode 01',
      description: null,
      metadata: '{}',
      created_by: 'user-1',
      created_at: 1,
      updated_at: 2,
    })),
    getProductionShots: mock.fn(async () => []),
    getProductionCues: mock.fn(async () => []),
    getProductionPlacements: mock.fn(async () => []),
    upsertProduction: mock.fn(async (input) => ({
      id: input.id,
      name: input.name,
      description: input.description,
      metadata: JSON.stringify(input.metadata),
      created_by: input.createdBy,
      created_at: 1,
      updated_at: 2,
    })),
    deleteProduction: mock.fn(async () => true),
    getProductionShotById: mock.fn(async (id: string) => ({
      id,
      production_id: 'episode-01',
      shot_id: 'shot-1',
      label: 'Opening',
      timeline_start_ms: 0,
      duration_ms: null,
      metadata: '{}',
      created_by: 'user-1',
      created_at: 1,
      updated_at: 2,
    })),
    upsertProductionShot: mock.fn(async (input) => ({
      id: input.id,
      production_id: input.productionId,
      shot_id: input.shotId,
      label: input.label,
      timeline_start_ms: input.timelineStartMs,
      duration_ms: input.durationMs,
      metadata: JSON.stringify(input.metadata),
      created_by: input.createdBy,
      created_at: 1,
      updated_at: 2,
    })),
    deleteProductionShot: mock.fn(async () => true),
    getProductionCueById: mock.fn(async (id: string) => ({
      id,
      production_id: 'episode-01',
      cue_type: 'music',
      label: 'Theme',
      timeline_start_ms: 0,
      duration_ms: null,
      metadata: '{}',
      created_by: 'user-1',
      created_at: 1,
      updated_at: 2,
    })),
    upsertProductionCue: mock.fn(async (input) => ({
      id: input.id,
      production_id: input.productionId,
      cue_type: input.cueType,
      label: input.label,
      timeline_start_ms: input.timelineStartMs,
      duration_ms: input.durationMs,
      metadata: JSON.stringify(input.metadata),
      created_by: input.createdBy,
      created_at: 1,
      updated_at: 2,
    })),
    deleteProductionCue: mock.fn(async () => true),
    upsertProductionPlacement: mock.fn(async (input) => ({
      id: input.id,
      production_id: input.productionId,
      target_kind: input.targetKind,
      target_id: input.targetId,
      variant_id: input.variantId,
      asset_id: input.assetId,
      media_kind: input.mediaKind,
      role: input.role,
      source_refs: JSON.stringify(input.sourceRefs),
      source_variant_ids: JSON.stringify(input.sourceVariantIds),
      metadata: JSON.stringify(input.metadata),
      created_by: input.createdBy,
      created_at: 1,
      updated_at: 2,
    })),
    getProductionPlacementById: mock.fn(async (id: string) => ({
      id,
      production_id: 'episode-01',
      target_kind: 'shot',
      target_id: 'shot-1',
      variant_id: 'variant-1',
      asset_id: 'asset-1',
      media_kind: 'video',
      role: 'primary',
      source_refs: '[]',
      source_variant_ids: '[]',
      metadata: '{}',
      created_by: 'user-1',
      created_at: 1,
      updated_at: 2,
    })),
    deleteProductionPlacement: mock.fn(async () => true),
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
    assert.equal(repo.upsertProduction.mock.calls[0].arguments[0].id, 'episode-01');
    assert.equal(repo.upsertProductionShot.mock.calls[0].arguments[0].id, 'shot-1');
    assert.equal(repo.upsertProductionPlacement.mock.calls[0].arguments[0].targetKind, 'shot');
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

  test('rejects legacy record placement when shot id belongs to another production', async () => {
    const { controller } = createController({
      getProductionShotById: mock.fn(async () => ({ id: 'shot-1', production_id: 'other-production' })),
    });

    await assert.rejects(
      controller.httpPlaceRecord({
        productionId: 'episode-01',
        variantId: 'variant-1',
        shotId: 'shot-1',
        sceneLabel: 'Opening',
        timelineStartMs: 0,
        createdBy: 'user-1',
      }),
      NotFoundError
    );
  });

  test('rejects upserting a shot id from another production', async () => {
    const { controller } = createController({
      getProductionShotById: mock.fn(async () => ({ id: 'shot-1', production_id: 'other-production' })),
    });

    await assert.rejects(
      controller.httpUpsertShot('episode-01', {
        id: 'shot-1',
        label: 'Opening',
        timelineStartMs: 0,
        createdBy: 'user-1',
      }),
      NotFoundError
    );
  });

  test('rejects upserting a cue id from another production', async () => {
    const { controller } = createController({
      getProductionCueById: mock.fn(async () => ({ id: 'cue-1', production_id: 'other-production' })),
    });

    await assert.rejects(
      controller.httpUpsertCue('episode-01', {
        id: 'cue-1',
        cueType: 'music',
        label: 'Theme',
        timelineStartMs: 0,
        createdBy: 'user-1',
      }),
      NotFoundError
    );
  });

  test('places a variant on an existing shot target', async () => {
    const { controller, repo } = createController();

    const placement = await controller.httpUpsertPlacement('episode-01', {
      id: 'placement-1',
      targetKind: 'shot',
      targetId: 'shot-1',
      variantId: 'variant-1',
      sourceVariantIds: ['source-1'],
      createdBy: 'user-1',
    });

    assert.equal(placement.id, 'placement-1');
    assert.equal(placement.target_kind, 'shot');
    assert.equal(repo.upsertProductionPlacement.mock.calls[0].arguments[0].assetId, 'asset-1');
  });

  test('rejects placement targets outside the production', async () => {
    const { controller } = createController({
      getProductionShotById: mock.fn(async () => ({ id: 'shot-1', production_id: 'other-production' })),
    });

    await assert.rejects(
      controller.httpUpsertPlacement('episode-01', {
        targetKind: 'shot',
        targetId: 'shot-1',
        variantId: 'variant-1',
        createdBy: 'user-1',
      }),
      ValidationError
    );
  });

  test('rejects upserting a placement id from another production', async () => {
    const { controller } = createController({
      getProductionPlacementById: mock.fn(async () => ({ id: 'placement-1', production_id: 'other-production' })),
    });

    await assert.rejects(
      controller.httpUpsertPlacement('episode-01', {
        id: 'placement-1',
        targetKind: 'shot',
        targetId: 'shot-1',
        variantId: 'variant-1',
        createdBy: 'user-1',
      }),
      NotFoundError
    );
  });

  test('rejects deleting a placement from another production', async () => {
    const { controller } = createController({
      getProductionPlacementById: mock.fn(async () => ({ id: 'placement-1', production_id: 'other-production' })),
    });

    await assert.rejects(
      controller.httpDeletePlacement('episode-01', 'placement-1'),
      NotFoundError
    );
  });
});
