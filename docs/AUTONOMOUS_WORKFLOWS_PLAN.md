# Autonomous Workflows Plan

## Overview

Autonomous Workflows enable the AI assistant to execute multi-step plans with checkpointing and rollback capabilities. This builds on top of Trust Zones (Phase 1) and Memory & Personalization (Phase 2).

## Why Full Rollback is Easy

Since images are **immutable in R2** (stored by key, never modified), rollback is straightforward:

- Track what each step creates: `assetsCreated[]`, `variantsCreated[]`
- Track state changes: `activeVariantChanges[]` (which asset had which active variant before)
- "Rollback" = delete created items + restore previous active variants

No need to snapshot actual image data - just track references.

## Database Schema

Add to SpaceDO's SQLite database (in `ensureInitialized()`):

```sql
CREATE TABLE IF NOT EXISTS workflow_executions (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, running, paused, completed, failed, rolled_back
  current_step_index INTEGER DEFAULT 0,
  steps TEXT NOT NULL,  -- JSON: [{description, action, params, status, result}]
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_checkpoints (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  -- What this step created (for deletion on rollback)
  assets_created TEXT DEFAULT '[]',   -- JSON: [assetId, ...]
  variants_created TEXT DEFAULT '[]', -- JSON: [variantId, ...]
  -- State before this step (for restoration on rollback)
  active_variant_changes TEXT DEFAULT '[]', -- JSON: [{assetId, previousActiveVariantId}, ...]
  created_at INTEGER NOT NULL,
  UNIQUE(workflow_id, step_index)
);
```

## Workflow Service

```typescript
// src/backend/services/workflowService.ts

export interface WorkflowCheckpoint {
  stepIndex: number;
  timestamp: number;
  assetsCreated: string[];
  variantsCreated: string[];
  activeVariantChanges: Array<{ assetId: string; previousActiveVariantId: string | null }>;
}

@injectable()
export class WorkflowService {
  async createWorkflow(plan: AssistantPlan, userId: string, spaceId: string): Promise<string>;

  // Execute step and auto-create checkpoint with state tracking
  async executeStep(workflowId: string, stepIndex: number): Promise<StepResult>;

  // Rollback to any checkpoint - cascades through all steps after it
  async rollbackToCheckpoint(workflowId: string, targetStepIndex: number): Promise<void> {
    // 1. Get all checkpoints after targetStepIndex (in reverse order)
    // 2. For each checkpoint: delete assetsCreated, delete variantsCreated
    // 3. Restore activeVariantChanges (set asset.active_variant_id back)
    // 4. Delete the checkpoint records
    // 5. Update workflow.current_step_index = targetStepIndex
  }

  async pauseWorkflow(workflowId: string): Promise<void>;
  async resumeWorkflow(workflowId: string): Promise<void>;
}
```

## API Endpoints

```
POST   /api/spaces/:id/workflows              - Create workflow from plan
GET    /api/spaces/:id/workflows/:workflowId  - Get workflow status
POST   /api/spaces/:id/workflows/:workflowId/execute  - Execute next step
POST   /api/spaces/:id/workflows/:workflowId/pause    - Pause workflow
POST   /api/spaces/:id/workflows/:workflowId/resume   - Resume workflow
POST   /api/spaces/:id/workflows/:workflowId/rollback - Rollback to checkpoint
DELETE /api/spaces/:id/workflows/:workflowId  - Cancel/delete workflow
```

## Enhanced PlanPanel UI

The existing PlanPanel component needs enhancement:

- **Visual step progress**: Connected nodes showing completed, current, and pending steps
- **Checkpoint markers**: Visual indicators for each saved checkpoint
- **Rollback button**: When checkpoints exist, allow user to rollback to any previous step
- **Pause/Resume controls**: Allow user to pause long-running workflows
- **Step details**: Expandable view showing what each step created

### UI Mockup

```
+--------------------------------------------------+
|  Plan: Create character set                       |
|  Status: PAUSED at step 3 of 5                   |
+--------------------------------------------------+
|  [●]━━━[●]━━━[◐]━━━[○]━━━[○]                     |
|   1     2     3     4     5                       |
|                                                   |
|  Step 1: Generate base character    [Rollback]   |
|  ✓ Created: "Knight" (asset_123)                 |
|                                                   |
|  Step 2: Create armor variant       [Rollback]   |
|  ✓ Added variant to "Knight"                     |
|                                                   |
|  Step 3: Generate weapon            [Current]    |
|  ◐ In progress...                                |
|                                                   |
|  Step 4: Combine character + weapon  [Pending]   |
|  Step 5: Generate final pose         [Pending]   |
|                                                   |
|  [Resume]  [Cancel Plan]                         |
+--------------------------------------------------+
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/backend/durable-objects/SpaceDO.ts` | Add workflow tables to schema |
| `src/backend/services/workflowService.ts` | New service (create) |
| `src/backend/routes/workflow.ts` | New routes (create) |
| `src/frontend/components/ChatSidebar/PlanPanel.tsx` | Enhanced UI |
| `src/frontend/stores/chatStore.ts` | Add checkpoint state |

## Implementation Steps

1. **Add database schema** to SpaceDO
2. **Create WorkflowService** with checkpoint tracking
3. **Create workflow routes** for API endpoints
4. **Enhance PlanPanel** with rollback UI
5. **Add WebSocket events** for real-time progress updates
6. **Test rollback scenarios** with various step combinations

## Dependencies

- Phase 1 (Trust Zones) - Tool execution framework
- Phase 2 (Memory & Personalization) - Pattern capture on workflow completion
- SpaceDO - Durable Object for workflow state
- Queue system - For async step execution
