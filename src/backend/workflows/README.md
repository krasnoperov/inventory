# Workflows

This directory contains Cloudflare Workflows for async processing.

## Creating a New Workflow

1. Create a file: `MyWorkflow.ts`
2. Extend `WorkflowEntrypoint`
3. Define input type
4. Implement `run()` method with steps
5. Export workflow in `src/worker/unified.ts` and `src/worker/processing.ts`
6. Add binding in wrangler configs
7. Update `Bindings` type in `src/core/types.ts`

## Example Template

```typescript
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import type { Bindings } from '../../core/types';

export type MyWorkflowInput = {
  jobId: string;
  data: Record<string, unknown>;
};

export class MyWorkflow extends WorkflowEntrypoint<Bindings, MyWorkflowInput> {
  async run(event: WorkflowEvent<MyWorkflowInput>, step: WorkflowStep) {
    const { jobId, data } = event.payload;

    // Step 1: Initialize
    await step.do('init', async () => {
      console.log('Starting job', jobId);
    });

    // Step 2: Process with retries
    const result = await step.do('process', {
      retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' },
      timeout: '5 minutes',
    }, async () => {
      // Your processing logic here
      return { status: 'completed' };
    });

    // Step 3: Finalize
    await step.do('finalize', async () => {
      console.log('Job completed', jobId, result);
    });

    return result;
  }
}
```

## Key Concepts

- **Idempotency**: Each step caches results, safe to restart
- **Retries**: Configure per-step retry logic
- **Timeout**: Set timeouts to prevent hanging
- **Backoff**: Use exponential backoff for external API calls

## Hard Rules

### Never return binary blobs from a step

Cloudflare Workflows persists every `step.do()` return value to durable state,
and that value is **capped at 1 MiB**. A step whose output exceeds the cap fails
with `WorkflowInternalError: Step <name> output is too large. Maximum allowed
size is 1MiB.` — on every retry, deterministically.

Therefore **no binary payload (image/video/audio bytes, base64 strings, or
`ArrayBuffer`/`Buffer`) may ever cross a step boundary** — neither as a step
return value nor passed into the next step. This applies to both inputs and
outputs: do not fetch large source blobs in one step and return them for the
next step to consume.

Instead:

- **Write bytes to R2 inside the step that produces them**, then return only the
  R2 key plus small scalar metadata (mime type, size, dimensions, duration).
- **Read source blobs inline** within the step that needs them (e.g. fetch
  source images from R2 at the top of the generate step), never as a separate
  upstream step that hands the bytes down.
- Keep step return values to small JSON: keys, ids, counts, provider metadata.

The audio path (`generate-and-upload-audio`) is the reference implementation:
generation and R2 upload happen in a single step, and only keys/metadata are
returned. Image and video generation follow the same `generate-and-upload-*`
shape.

> Rule of thumb: if a value could be larger than a few KB, it belongs in R2, not
> in a step's return value.
