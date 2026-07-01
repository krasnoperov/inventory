import type { JobContext } from './protocol';

const pendingJobContexts = new Map<string, JobContext>();

export function registerPendingJobContext(requestId: string, context: JobContext): void {
  pendingJobContexts.set(requestId, context);
}

export function takePendingJobContext(requestId: string): JobContext | undefined {
  const context = pendingJobContexts.get(requestId);
  pendingJobContexts.delete(requestId);
  return context;
}

export function clearPendingJobContextsForTests(): void {
  pendingJobContexts.clear();
}
