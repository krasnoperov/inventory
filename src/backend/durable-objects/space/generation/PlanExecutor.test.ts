import { describe, test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PlanExecutor } from './PlanExecutor';
import type { SpaceRepository, SqlStorage } from '../repository/SpaceRepository';
import type { BroadcastFn } from '../controllers/types';
import type { Env } from '../../../../core/types';
import type { WebSocketMeta, Plan, PlanStep } from '../types';

// ============================================================================
// Mock Factories
// ============================================================================

function createMockSql(): SqlStorage {
  return {
    exec: mock.fn(async () => ({ toArray: () => [] })),
  } as unknown as SqlStorage;
}

function createMockRepo(): SpaceRepository {
  return {
    getAssetById: mock.fn(async () => null),
    getVariantById: mock.fn(async () => null),
    getVariantImageKey: mock.fn(async () => null),
    createAsset: mock.fn(async (input) => ({
      id: input.id,
      name: input.name,
      type: input.type,
      tags: '[]',
      parent_asset_id: input.parentAssetId || null,
      active_variant_id: null,
      created_by: input.createdBy,
      created_at: Date.now(),
      updated_at: Date.now(),
    })),
    createPlaceholderVariant: mock.fn(async (input) => ({
      id: input.id,
      asset_id: input.assetId,
      workflow_id: null,
      status: 'pending',
      error_message: null,
      image_key: null,
      thumb_key: null,
      recipe: input.recipe,
      starred: false,
      created_by: input.createdBy,
      created_at: Date.now(),
      updated_at: null,
      plan_step_id: input.planStepId || null,
    })),
    createLineage: mock.fn(async (input) => ({
      id: input.id,
      parent_variant_id: input.parentVariantId,
      child_variant_id: input.childVariantId,
      relation_type: input.relationType,
      severed: false,
      created_at: Date.now(),
    })),
    updateAsset: mock.fn(async () => ({})),
    updateVariantWorkflow: mock.fn(async (id, workflowId, status) => ({
      id,
      workflow_id: workflowId,
      status,
    })),
    getPlanStepById: mock.fn(async () => null),
    getPlanById: mock.fn(async () => null),
    getAllPendingSteps: mock.fn(async () => []),
    completeStep: mock.fn(async (id, result) => ({
      id,
      status: 'completed',
      result,
    })),
    failStep: mock.fn(async (id, error) => ({
      id,
      status: 'failed',
      error,
    })),
    decrementActiveSteps: mock.fn(async () => {}),
    updatePlanStatus: mock.fn(async (id, status) => ({ id, status })),
    updatePlanStatusAndIndex: mock.fn(async (id, status, index) => ({
      id,
      status,
      current_step_index: index,
    })),
  } as unknown as SpaceRepository;
}

function createMockEnv(withWorkflow = true): Env {
  return {
    GENERATION_WORKFLOW: withWorkflow
      ? {
          create: mock.fn(async ({ id }) => ({ id })),
        }
      : undefined,
  } as unknown as Env;
}

function createMockBroadcast(): BroadcastFn {
  return mock.fn(() => {});
}

function createMockMeta(): WebSocketMeta {
  return {
    userId: 'user-123',
    role: 'editor',
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('PlanExecutor', () => {
  describe('executeStep', () => {
    test('handles generate action', async () => {
      const repo = createMockRepo();
      const sql = createMockSql();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const executor = new PlanExecutor('space-1', repo, sql, env, broadcast);
      const meta = createMockMeta();

      const step = {
        id: 'step-1',
        action: 'generate',
        params: JSON.stringify({
          name: 'Hero',
          type: 'character',
          prompt: 'A brave hero',
        }),
      };

      const variantId = await executor.executeStep(step, meta);

      assert.ok(variantId);
      assert.ok((repo.createAsset as ReturnType<typeof mock.fn>).mock.calls.length > 0);
      assert.ok((repo.createPlaceholderVariant as ReturnType<typeof mock.fn>).mock.calls.length > 0);
    });

    test('handles derive action (same as generate)', async () => {
      const repo = createMockRepo();
      const sql = createMockSql();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const executor = new PlanExecutor('space-1', repo, sql, env, broadcast);
      const meta = createMockMeta();

      const step = {
        id: 'step-1',
        action: 'derive',
        params: JSON.stringify({
          name: 'Derived Asset',
          type: 'item',
          prompt: 'Derive from reference',
        }),
      };

      const variantId = await executor.executeStep(step, meta);

      assert.ok(variantId);
    });

    test('handles refine action', async () => {
      const repo = createMockRepo();
      const sql = createMockSql();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const executor = new PlanExecutor('space-1', repo, sql, env, broadcast);
      const meta = createMockMeta();

      // Setup existing asset with variant
      (repo.getAssetById as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => ({
        id: 'asset-1',
        name: 'Existing Asset',
        type: 'character',
        active_variant_id: 'var-1',
      }));
      (repo.getVariantById as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => ({
        id: 'var-1',
        image_key: 'images/existing.png',
      }));

      const step = {
        id: 'step-1',
        action: 'refine',
        params: JSON.stringify({
          assetId: 'asset-1',
          prompt: 'Improve the character',
        }),
      };

      const variantId = await executor.executeStep(step, meta);

      assert.ok(variantId);
    });

    test('handles fork action (synchronous)', async () => {
      const repo = createMockRepo();
      const sql = createMockSql();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const executor = new PlanExecutor('space-1', repo, sql, env, broadcast);
      const meta = createMockMeta();

      // Setup source asset
      (repo.getAssetById as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => ({
        id: 'source-asset',
        name: 'Source',
        type: 'character',
        active_variant_id: 'source-var',
      }));
      (repo.getVariantById as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => ({
        id: 'source-var',
        image_key: 'images/source.png',
        thumb_key: 'thumbs/source.png',
        recipe: '{}',
      }));
      (repo.getPlanStepById as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => ({
        id: 'step-1',
        plan_id: 'plan-1',
        step_index: 0,
      }));
      (repo.getPlanById as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => ({
        id: 'plan-1',
        active_step_count: 1,
      }));

      const step = {
        id: 'step-1',
        action: 'fork',
        params: JSON.stringify({
          sourceAssetId: 'source-asset',
          name: 'Forked Asset',
          type: 'character',
        }),
      };

      const variantId = await executor.executeStep(step, meta);

      // Fork returns null (synchronous, completes immediately)
      assert.strictEqual(variantId, null);

      // But should have completed the step
      assert.ok((repo.completeStep as ReturnType<typeof mock.fn>).mock.calls.length > 0);
    });

    test('returns null for unknown actions', async () => {
      const repo = createMockRepo();
      const sql = createMockSql();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const executor = new PlanExecutor('space-1', repo, sql, env, broadcast);
      const meta = createMockMeta();

      const step = {
        id: 'step-1',
        action: 'unknown_action',
        params: '{}',
      };

      const variantId = await executor.executeStep(step, meta);

      assert.strictEqual(variantId, null);
    });
  });

  describe('completeStep', () => {
    test('completes step and updates plan status', async () => {
      const repo = createMockRepo();
      const sql = createMockSql();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const executor = new PlanExecutor('space-1', repo, sql, env, broadcast);

      // Setup step and plan
      (repo.getPlanStepById as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => ({
        id: 'step-1',
        plan_id: 'plan-1',
        step_index: 0,
      }));
      (repo.getPlanById as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => ({
        id: 'plan-1',
        active_step_count: 1,
      }));
      (repo.getAllPendingSteps as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => []);

      await executor.completeStep('step-1', 'var-1');

      // Verify step completed
      const completeStepCalls = (repo.completeStep as ReturnType<typeof mock.fn>).mock.calls;
      assert.ok(completeStepCalls.length > 0);
      assert.strictEqual(completeStepCalls[0].arguments[0], 'step-1');
      assert.strictEqual(completeStepCalls[0].arguments[1], 'variant:var-1');

      // Verify broadcasts
      const broadcastCalls = (broadcast as ReturnType<typeof mock.fn>).mock.calls;
      assert.ok(broadcastCalls.some((c) => c.arguments[0].type === 'plan:step_updated'));
      assert.ok(broadcastCalls.some((c) => c.arguments[0].type === 'plan:updated'));
    });

    test('sets plan status to completed when no pending steps', async () => {
      const repo = createMockRepo();
      const sql = createMockSql();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const executor = new PlanExecutor('space-1', repo, sql, env, broadcast);

      (repo.getPlanStepById as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => ({
        id: 'step-1',
        plan_id: 'plan-1',
        step_index: 2,
      }));
      (repo.getPlanById as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => ({
        id: 'plan-1',
        active_step_count: 1,
      }));
      (repo.getAllPendingSteps as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => []);

      await executor.completeStep('step-1', 'var-1');

      const updateCalls = (repo.updatePlanStatusAndIndex as ReturnType<typeof mock.fn>).mock.calls;
      assert.ok(updateCalls.length > 0);
      assert.strictEqual(updateCalls[0].arguments[1], 'completed');
    });

    test('sets plan status to paused when more pending steps exist', async () => {
      const repo = createMockRepo();
      const sql = createMockSql();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const executor = new PlanExecutor('space-1', repo, sql, env, broadcast);

      (repo.getPlanStepById as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => ({
        id: 'step-1',
        plan_id: 'plan-1',
        step_index: 0,
      }));
      (repo.getPlanById as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => ({
        id: 'plan-1',
        active_step_count: 1,
      }));
      (repo.getAllPendingSteps as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => [
        { id: 'step-2' },
      ]);

      await executor.completeStep('step-1', 'var-1');

      const updateCalls = (repo.updatePlanStatusAndIndex as ReturnType<typeof mock.fn>).mock.calls;
      assert.ok(updateCalls.length > 0);
      assert.strictEqual(updateCalls[0].arguments[1], 'paused');
    });

    test('handles missing step gracefully', async () => {
      const repo = createMockRepo();
      const sql = createMockSql();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const executor = new PlanExecutor('space-1', repo, sql, env, broadcast);

      // Step not found
      (repo.getPlanStepById as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => null);

      // Should not throw
      await executor.completeStep('nonexistent', 'var-1');

      // Should not have called completeStep
      assert.strictEqual((repo.completeStep as ReturnType<typeof mock.fn>).mock.calls.length, 0);
    });
  });

  describe('failStep', () => {
    test('fails step and marks plan as failed', async () => {
      const repo = createMockRepo();
      const sql = createMockSql();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const executor = new PlanExecutor('space-1', repo, sql, env, broadcast);

      (repo.getPlanStepById as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => ({
        id: 'step-1',
        plan_id: 'plan-1',
        step_index: 0,
      }));

      await executor.failStep('step-1', 'Generation failed');

      // Verify step failed
      const failStepCalls = (repo.failStep as ReturnType<typeof mock.fn>).mock.calls;
      assert.ok(failStepCalls.length > 0);
      assert.strictEqual(failStepCalls[0].arguments[0], 'step-1');
      assert.strictEqual(failStepCalls[0].arguments[1], 'Generation failed');

      // Verify plan marked as failed
      const updateStatusCalls = (repo.updatePlanStatus as ReturnType<typeof mock.fn>).mock.calls;
      assert.ok(updateStatusCalls.length > 0);
      assert.strictEqual(updateStatusCalls[0].arguments[1], 'failed');

      // Verify broadcasts
      const broadcastCalls = (broadcast as ReturnType<typeof mock.fn>).mock.calls;
      assert.ok(broadcastCalls.some((c) => c.arguments[0].type === 'plan:step_updated'));
      assert.ok(broadcastCalls.some((c) => c.arguments[0].type === 'plan:updated'));
    });

    test('handles missing step gracefully', async () => {
      const repo = createMockRepo();
      const sql = createMockSql();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const executor = new PlanExecutor('space-1', repo, sql, env, broadcast);

      (repo.getPlanStepById as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => null);

      // Should not throw
      await executor.failStep('nonexistent', 'Error');

      // Should not have called failStep
      assert.strictEqual((repo.failStep as ReturnType<typeof mock.fn>).mock.calls.length, 0);
    });
  });

  describe('refine validation', () => {
    test('throws when assetId not provided', async () => {
      const repo = createMockRepo();
      const sql = createMockSql();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const executor = new PlanExecutor('space-1', repo, sql, env, broadcast);
      const meta = createMockMeta();

      const step = {
        id: 'step-1',
        action: 'refine',
        params: JSON.stringify({ prompt: 'Refine' }), // Missing assetId
      };

      await assert.rejects(executor.executeStep(step, meta), /requires assetId/);
    });
  });

  describe('fork validation', () => {
    test('throws when sourceAssetId not provided', async () => {
      const repo = createMockRepo();
      const sql = createMockSql();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const executor = new PlanExecutor('space-1', repo, sql, env, broadcast);
      const meta = createMockMeta();

      const step = {
        id: 'step-1',
        action: 'fork',
        params: JSON.stringify({ name: 'Forked' }), // Missing sourceAssetId
      };

      await assert.rejects(executor.executeStep(step, meta), /requires sourceAssetId/);
    });
  });
});
