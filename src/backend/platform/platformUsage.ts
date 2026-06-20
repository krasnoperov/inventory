import type { MediaKind, Variant } from '../durable-objects/space/types';

export type PlatformUsageType = 'storage' | 'workflow' | 'delivery';
export type PlatformUsageUnit = 'byte' | 'run';

export interface PlatformUsageMetadata {
  [key: string]: unknown;
}

export interface TrackPlatformUsageInput {
  idempotencyKey?: string;
  spaceId: string;
  userId?: number | null;
  usageType: PlatformUsageType;
  quantity: number;
  unit: PlatformUsageUnit;
  assetId?: string | null;
  variantId?: string | null;
  workflowId?: string | null;
  requestId?: string | null;
  artifactKey?: string | null;
  operation?: string | null;
  mediaKind?: MediaKind | null;
  metadata?: PlatformUsageMetadata | null;
  createdAt?: string;
}

export type VariantStorageRecord = Pick<
  Variant,
  | 'id'
  | 'asset_id'
  | 'created_by'
  | 'workflow_id'
  | 'media_kind'
  | 'image_key'
  | 'thumb_key'
  | 'media_key'
  | 'media_size_bytes'
  | 'transcript_key'
  | 'transcript_size_bytes'
  | 'word_timings_key'
  | 'word_timings_size_bytes'
  | 'render_metadata_key'
  | 'render_metadata_size_bytes'
>;

interface StorageArtifact {
  key: string;
  role: string;
  fallbackSizeBytes: number | null;
}

function parseUserId(userId: string | number | null | undefined): number | null {
  if (typeof userId === 'number' && Number.isFinite(userId)) return userId;
  if (typeof userId !== 'string') return null;
  const parsed = Number.parseInt(userId, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function metadataToJson(metadata: PlatformUsageMetadata | null | undefined): string | null {
  if (!metadata) return null;
  return JSON.stringify(metadata);
}

export async function trackPlatformUsage(
  db: D1Database | undefined | null,
  input: TrackPlatformUsageInput
): Promise<void> {
  if (!db) return;

  const id = crypto.randomUUID();
  const createdAt = input.createdAt ?? new Date().toISOString();
  const idempotencyKey = input.idempotencyKey ?? `${input.usageType}:${id}`;

  await db.prepare(`
    INSERT INTO platform_usage_events (
      id,
      idempotency_key,
      space_id,
      user_id,
      usage_type,
      quantity,
      unit,
      asset_id,
      variant_id,
      workflow_id,
      request_id,
      artifact_key,
      operation,
      media_kind,
      metadata,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(idempotency_key) DO NOTHING
  `).bind(
    id,
    idempotencyKey,
    input.spaceId,
    input.userId ?? null,
    input.usageType,
    Math.trunc(input.quantity),
    input.unit,
    input.assetId ?? null,
    input.variantId ?? null,
    input.workflowId ?? null,
    input.requestId ?? null,
    input.artifactKey ?? null,
    input.operation ?? null,
    input.mediaKind ?? null,
    metadataToJson(input.metadata),
    createdAt
  ).run();
}

function addArtifact(
  artifacts: Map<string, StorageArtifact>,
  key: string | null | undefined,
  role: string,
  fallbackSizeBytes: number | null | undefined
): void {
  if (!key || artifacts.has(key)) return;
  artifacts.set(key, {
    key,
    role,
    fallbackSizeBytes: typeof fallbackSizeBytes === 'number' ? fallbackSizeBytes : null,
  });
}

export function getOwnedVariantStorageArtifacts(variant: VariantStorageRecord): StorageArtifact[] {
  const artifacts = new Map<string, StorageArtifact>();
  addArtifact(artifacts, variant.media_key, 'media', variant.media_size_bytes);
  addArtifact(artifacts, variant.image_key, 'image', variant.media_size_bytes);
  addArtifact(artifacts, variant.thumb_key, 'thumbnail', null);
  addArtifact(artifacts, variant.transcript_key, 'transcript', variant.transcript_size_bytes);
  addArtifact(artifacts, variant.word_timings_key, 'word_timings', variant.word_timings_size_bytes);
  addArtifact(artifacts, variant.render_metadata_key, 'render_metadata', variant.render_metadata_size_bytes);
  return [...artifacts.values()];
}

async function getArtifactSizeBytes(
  bucket: R2Bucket | undefined | null,
  artifact: StorageArtifact
): Promise<number | null> {
  if (bucket && typeof bucket.head === 'function') {
    const object = await bucket.head(artifact.key);
    if (object?.size !== undefined) return object.size;
  }
  return artifact.fallbackSizeBytes;
}

export async function trackVariantStorageUsage(
  db: D1Database | undefined | null,
  bucket: R2Bucket | undefined | null,
  input: {
    spaceId: string;
    variant: VariantStorageRecord;
    reason: 'generated' | 'uploaded' | 'applied';
  }
): Promise<void> {
  const artifacts = getOwnedVariantStorageArtifacts(input.variant);
  const resolvedArtifacts: Array<{ key: string; role: string; sizeBytes: number }> = [];

  for (const artifact of artifacts) {
    const sizeBytes = await getArtifactSizeBytes(bucket, artifact);
    if (typeof sizeBytes === 'number' && sizeBytes > 0) {
      resolvedArtifacts.push({ key: artifact.key, role: artifact.role, sizeBytes });
    }
  }

  const totalBytes = resolvedArtifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0);
  if (totalBytes <= 0) return;

  await trackPlatformUsage(db, {
    idempotencyKey: `storage:${input.spaceId}:${input.variant.id}:${input.reason}`,
    spaceId: input.spaceId,
    userId: parseUserId(input.variant.created_by),
    usageType: 'storage',
    quantity: totalBytes,
    unit: 'byte',
    assetId: input.variant.asset_id,
    variantId: input.variant.id,
    workflowId: input.variant.workflow_id,
    mediaKind: input.variant.media_kind,
    metadata: {
      reason: input.reason,
      artifactCount: resolvedArtifacts.length,
      artifacts: resolvedArtifacts,
    },
  });
}

export async function trackDeletedStorageUsage(
  db: D1Database | undefined | null,
  input: {
    spaceId: string;
    userId?: number | null;
    assetId?: string | null;
    variantId?: string | null;
    mediaKind?: MediaKind | null;
    artifactKey: string;
    sizeBytes: number;
  }
): Promise<void> {
  if (input.sizeBytes <= 0) return;
  await trackPlatformUsage(db, {
    idempotencyKey: `storage:${input.spaceId}:${input.variantId ?? 'unknown'}:delete:${input.artifactKey}`,
    spaceId: input.spaceId,
    userId: input.userId ?? null,
    usageType: 'storage',
    quantity: -input.sizeBytes,
    unit: 'byte',
    assetId: input.assetId ?? null,
    variantId: input.variantId ?? null,
    artifactKey: input.artifactKey,
    mediaKind: input.mediaKind ?? null,
    metadata: { reason: 'deleted' },
  });
}

export function parsePlatformUsageUserId(userId: string | number | null | undefined): number | null {
  return parseUserId(userId);
}
