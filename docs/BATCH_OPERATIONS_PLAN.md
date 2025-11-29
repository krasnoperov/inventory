# Batch Operations Plan

## Overview

Batch Operations allow users to queue multiple generation jobs and manage them as a group. This enables scenarios like "generate 10 character variations" or "create a complete tileset" with progress tracking, pause/resume, and cancellation.

## Database Schema

Create migration `db/migrations/0007_batch_operations.sql`:

```sql
-- Batch operations table
CREATE TABLE batch_operations (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, running, paused, completed, failed, cancelled
  total_items INTEGER NOT NULL,
  completed_items INTEGER DEFAULT 0,
  failed_items INTEGER DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Link jobs to batches
ALTER TABLE jobs ADD COLUMN batch_id TEXT REFERENCES batch_operations(id);
CREATE INDEX idx_jobs_batch ON jobs(batch_id);
CREATE INDEX idx_batch_space ON batch_operations(space_id);
CREATE INDEX idx_batch_status ON batch_operations(status);
```

## Batch Service

```typescript
// src/backend/services/batchService.ts

export interface JobInput {
  type: 'generate' | 'derive' | 'compose';
  name: string;
  assetType: string;
  prompt: string;
  referenceAssetIds?: string[];
}

export interface BatchProgress {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  total: number;
  completed: number;
  failed: number;
  percentComplete: number;
  estimatedTimeRemaining?: number;
  jobs: Array<{
    id: string;
    status: string;
    name: string;
    resultVariantId?: string;
  }>;
}

@injectable()
export class BatchService {
  // Create a batch with multiple jobs
  async createBatch(
    name: string,
    jobs: JobInput[],
    userId: string,
    spaceId: string
  ): Promise<BatchOperation>;

  // Pause all pending jobs in batch
  async pauseBatch(batchId: string): Promise<void>;

  // Resume paused batch
  async resumeBatch(batchId: string): Promise<void>;

  // Cancel batch and all pending jobs
  async cancelBatch(batchId: string): Promise<void>;

  // Get progress with job details
  async getBatchProgress(batchId: string): Promise<BatchProgress>;

  // List batches for a space
  async listBatches(spaceId: string, status?: string): Promise<BatchOperation[]>;
}
```

## API Endpoints

```
POST   /api/spaces/:id/batches              - Create batch
GET    /api/spaces/:id/batches              - List batches
GET    /api/spaces/:id/batches/:batchId     - Get batch progress
POST   /api/spaces/:id/batches/:batchId/pause   - Pause batch
POST   /api/spaces/:id/batches/:batchId/resume  - Resume batch
POST   /api/spaces/:id/batches/:batchId/cancel  - Cancel batch
DELETE /api/spaces/:id/batches/:batchId     - Delete batch
```

## Queue Consumer Enhancement

The generation consumer needs batch awareness:

```typescript
// In generationConsumer.ts

async function processJob(job: Job): Promise<void> {
  // Check if job is part of a batch
  if (job.batch_id) {
    const batch = await batchService.getBatch(job.batch_id);

    // Skip if batch is paused or cancelled
    if (batch.status === 'paused' || batch.status === 'cancelled') {
      // Re-queue for later or skip
      return;
    }
  }

  // Process job normally...

  // After completion, update batch progress
  if (job.batch_id) {
    await batchService.updateProgress(job.batch_id, job.id, success);

    // Broadcast progress via WebSocket
    await spaceDO.broadcastBatchProgress(job.batch_id);
  }
}
```

## BatchProgressPanel UI

New component for displaying batch progress:

```typescript
// src/frontend/components/ChatSidebar/BatchProgressPanel.tsx

export interface BatchProgressPanelProps {
  spaceId: string;
}

export function BatchProgressPanel({ spaceId }: BatchProgressPanelProps) {
  // Show active batches with progress bars
  // Pause/Resume/Cancel controls
  // Expand to see individual job status
}
```

### UI Mockup

```
+--------------------------------------------------+
|  Active Batches                                   |
+--------------------------------------------------+
|  Character Variations                             |
|  [████████████░░░░░░░░] 60% (6/10)               |
|  Est. 4 min remaining                             |
|  [Pause] [Cancel]                                 |
|                                                   |
|  ▼ Show details                                   |
|  ├─ ✓ Knight v1        [View]                    |
|  ├─ ✓ Knight v2        [View]                    |
|  ├─ ✓ Knight v3        [View]                    |
|  ├─ ✓ Knight v4        [View]                    |
|  ├─ ✓ Knight v5        [View]                    |
|  ├─ ✓ Knight v6        [View]                    |
|  ├─ ◐ Knight v7        Processing...             |
|  ├─ ○ Knight v8        Queued                    |
|  ├─ ○ Knight v9        Queued                    |
|  └─ ○ Knight v10       Queued                    |
+--------------------------------------------------+
|  Tileset Generation                   [Paused]   |
|  [████░░░░░░░░░░░░░░░░] 20% (4/20)               |
|  [Resume] [Cancel]                                |
+--------------------------------------------------+
```

## WebSocket Events

Add batch progress events to SpaceDO:

```typescript
// Broadcast to all connected clients
interface BatchProgressEvent {
  type: 'batch_progress';
  batchId: string;
  completed: number;
  total: number;
  failed: number;
  status: string;
}

interface BatchJobCompleteEvent {
  type: 'batch_job_complete';
  batchId: string;
  jobId: string;
  success: boolean;
  resultVariantId?: string;
}
```

## Files to Modify

| File | Changes |
|------|---------|
| `db/migrations/0007_batch_operations.sql` | New migration |
| `src/db/types.ts` | Add BatchOperationsTable types |
| `src/backend/services/batchService.ts` | New service (create) |
| `src/backend/services/generationConsumer.ts` | Add batch awareness |
| `src/backend/routes/batch.ts` | New routes (create) |
| `src/backend/durable-objects/SpaceDO.ts` | Batch WebSocket events |
| `src/frontend/components/ChatSidebar/BatchProgressPanel.tsx` | New component |
| `src/frontend/stores/batchStore.ts` | New store for batch state |

## Implementation Steps

1. **Create database migration** for batch_operations table
2. **Add TypeScript types** to db/types.ts
3. **Create BatchService** with CRUD and progress tracking
4. **Update generationConsumer** with batch awareness
5. **Create batch routes** for API endpoints
6. **Add WebSocket events** for real-time progress
7. **Create BatchProgressPanel** component
8. **Integrate with ChatSidebar** to show active batches
9. **Add batch creation UI** (could be from chat or direct UI)

## Integration with Chat Assistant

The assistant can create batches via tool calls:

```typescript
// New tool: create_batch
{
  name: 'create_batch',
  description: 'Create multiple assets in a batch',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Batch name' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string' },
            prompt: { type: 'string' }
          }
        }
      }
    }
  }
}
```

Example conversation:
- User: "Create 5 variations of this character with different poses"
- Assistant: Creates batch with 5 generation jobs
- UI: Shows BatchProgressPanel with real-time updates

## Dependencies

- Phase 1 (Trust Zones) - Batch creation requires approval
- Queue system - Jobs are processed via existing queue
- SpaceDO - WebSocket for progress broadcasts
- generationConsumer - Modified to handle batch jobs
