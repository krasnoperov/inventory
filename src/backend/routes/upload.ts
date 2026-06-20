/**
 * Upload Routes
 *
 * Handles media uploads to create new variants on existing assets.
 */
import type { Context } from 'hono';
import type { AppContext } from './types';
import { createOpenApiRouter } from './openapi';
import { authMiddleware } from '../middleware/auth-middleware';
import { MemberDAO } from '../../dao/member-dao';
import { uploadMediaRoute } from '../../shared/api/routes';
import { UploadMediaResponseSchema, type UploadMediaResponse } from '../../shared/api/schemas';
import { checkGenerationGuardrails } from '../durable-objects/space/billing/usageCheck';
import {
  createThumbnail,
  getBaseUrl,
  getImageDimensions,
  type ImageMimeType,
} from '../utils/image-utils';
import type { MediaKind } from '../../shared/websocket-types';

// Configuration
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_SIDECAR_FILE_SIZE_MB = 2;
const MAX_SIDECAR_FILE_SIZE_BYTES = MAX_SIDECAR_FILE_SIZE_MB * 1024 * 1024;
const MAX_AUDIO_SIDECAR_COUNT = 3;
const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
const MAX_UPLOAD_BODY_SIZE_BYTES =
  MAX_FILE_SIZE_BYTES +
  (MAX_AUDIO_SIDECAR_COUNT * MAX_SIDECAR_FILE_SIZE_BYTES) +
  MAX_MULTIPART_OVERHEAD_BYTES;
const MEDIA_UPLOAD_LIMIT_MESSAGE =
  `Request too large. Media uploads are limited to ${MAX_FILE_SIZE_MB}MB plus up to ` +
  `${MAX_AUDIO_SIDECAR_COUNT} sidecars of ${MAX_SIDECAR_FILE_SIZE_MB}MB each`;

const MIME_TO_EXT: Record<string, string> = {
  'application/json': 'json',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'text/plain': 'txt',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/x-wav': 'wav',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-m4v': 'm4v',
};

const MIME_TO_MEDIA_KIND: Record<string, MediaKind> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'audio/aac': 'audio',
  'audio/flac': 'audio',
  'audio/mpeg': 'audio',
  'audio/mp4': 'audio',
  'audio/ogg': 'audio',
  'audio/wav': 'audio',
  'audio/webm': 'audio',
  'audio/x-wav': 'audio',
  'video/mp4': 'video',
  'video/quicktime': 'video',
  'video/webm': 'video',
  'video/x-m4v': 'video',
};

const IMAGE_MIME_TYPES = new Set<ImageMimeType>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);
const ALLOWED_MIME_TYPES = Object.keys(MIME_TO_MEDIA_KIND);
const TRANSCRIPT_MIME_TYPES = new Set(['text/plain', 'application/json']);
const JSON_SIDECAR_MIME_TYPES = new Set(['application/json']);

type AudioSidecarKind = 'transcript' | 'wordTimings' | 'renderMetadata';
type UploadActiveVariantBehavior = 'if_missing' | 'set_active' | 'keep';
type UploadLineageInput = {
  parentVariantId: string;
  relationType: 'derived' | 'refined' | 'forked';
};

interface AudioSidecarUpload {
  kind: AudioSidecarKind;
  file: File;
  key: string;
  mimeType: string;
}

function parseMediaKind(value: FormDataEntryValue | null): MediaKind | undefined {
  if (value === null || typeof value !== 'string' || value === '') return undefined;
  if (value === 'image' || value === 'audio' || value === 'video') return value;
  return undefined;
}

function getOptionalString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === 'string' && value !== '' ? value : null;
}

function getOptionalFile(formData: FormData, key: string): File | null {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

function parseJsonObjectField(formData: FormData, key: string): Record<string, unknown> | null {
  const raw = getOptionalString(formData, key);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UploadRequestError(`${key} must be valid JSON`, 400);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UploadRequestError(`${key} must be a JSON object`, 400);
  }
  return parsed as Record<string, unknown>;
}

function parseUploadLineage(formData: FormData): UploadLineageInput[] {
  const raw = getOptionalString(formData, 'lineage');
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UploadRequestError('lineage must be valid JSON', 400);
  }
  if (!Array.isArray(parsed)) {
    throw new UploadRequestError('lineage must be a JSON array', 400);
  }
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new UploadRequestError(`lineage[${index}] must be an object`, 400);
    }
    const record = entry as Record<string, unknown>;
    const parentVariantId = record.parentVariantId ?? record.sourceVariantId;
    const relationType = record.relationType;
    if (typeof parentVariantId !== 'string' || parentVariantId.length === 0) {
      throw new UploadRequestError(`lineage[${index}].parentVariantId is required`, 400);
    }
    if (relationType !== 'derived' && relationType !== 'refined' && relationType !== 'forked') {
      throw new UploadRequestError(`lineage[${index}].relationType must be derived, refined, or forked`, 400);
    }
    return { parentVariantId, relationType };
  });
}

function parseActiveVariantBehavior(formData: FormData): UploadActiveVariantBehavior {
  const raw = getOptionalString(formData, 'activeVariantBehavior');
  if (!raw || raw === 'if-missing' || raw === 'if_missing') return 'if_missing';
  if (raw === 'set-active' || raw === 'set_active') return 'set_active';
  if (raw === 'keep') return 'keep';
  throw new UploadRequestError('activeVariantBehavior must be if-missing, set-active, or keep', 400);
}

class UploadRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413,
  ) {
    super(message);
  }
}

function getUploadRequestError(
  c: Context<AppContext>,
  maxBodySizeBytes: number,
  limitMessage: string
): UploadRequestError | null {
  const contentLength = c.req.header('Content-Length');
  if (!contentLength) return null;

  const size = Number(contentLength);
  if (!Number.isFinite(size) || size < 0) {
    return new UploadRequestError('Invalid Content-Length', 400);
  }
  if (size <= maxBodySizeBytes) return null;

  return new UploadRequestError(limitMessage, 413);
}

function uploadRequestErrorResponse(c: Context<AppContext>, error: UploadRequestError): Response {
  return c.json({ error: error.message }, error.status);
}

function parseNumericUserId(userId: string): number | null {
  const parsed = Number.parseInt(userId, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function estimateUploadedStorageBytes(
  file: File,
  sidecars: AudioSidecarUpload[],
  isImageUpload: boolean
): number {
  const sidecarBytes = sidecars.reduce((sum, sidecar) => sum + sidecar.file.size, 0);
  const thumbnailEstimate = isImageUpload ? file.size : 0;
  return file.size + sidecarBytes + thumbnailEstimate;
}

async function readRequestBodyWithLimit(
  c: Context<AppContext>,
  maxBodySizeBytes: number,
  limitMessage: string
): Promise<ArrayBuffer> {
  const reader = c.req.raw.body?.getReader();
  if (!reader) return new ArrayBuffer(0);

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;
    if (total > maxBodySizeBytes) {
      await reader.cancel().catch(() => undefined);
      throw new UploadRequestError(limitMessage, 413);
    }
    chunks.push(value);
  }

  const rawBody = new ArrayBuffer(total);
  const body = new Uint8Array(rawBody);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return rawBody;
}

async function bufferUploadRequest(
  c: Context<AppContext>,
  maxBodySizeBytes: number,
  limitMessage: string
): Promise<void> {
  const uploadRequestError = getUploadRequestError(c, maxBodySizeBytes, limitMessage);
  if (uploadRequestError) throw uploadRequestError;

  const body = await readRequestBodyWithLimit(c, maxBodySizeBytes, limitMessage);
  c.req.raw = new Request(c.req.raw.url, {
    method: c.req.raw.method,
    headers: c.req.raw.headers,
    body,
  });
  c.req.bodyCache = {};
}

async function parseUploadFormData(c: Context<AppContext>): Promise<FormData> {
  try {
    return await c.req.formData();
  } catch {
    throw new UploadRequestError('Invalid form data', 400);
  }
}

async function deleteUploadedKeys(env: AppContext['Bindings'], keys: Array<string | null>): Promise<void> {
  const uniqueKeys = [...new Set(keys.filter((key): key is string => Boolean(key)))];
  await Promise.all(uniqueKeys.map((key) => env.IMAGES.delete(key)));
}

async function failUploadPlaceholder(
  doStub: { fetch(request: Request): Promise<Response> },
  variantId: string,
  error: string
): Promise<void> {
  await doStub.fetch(
    new Request('http://do/internal/fail-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variantId, error }),
    })
  );
}

function validateSidecarFile(
  kind: AudioSidecarKind,
  file: File,
): { ok: true; mimeType: string } | { ok: false; error: string } {
  const mimeType = file.type;
  const allowed = kind === 'transcript' ? TRANSCRIPT_MIME_TYPES : JSON_SIDECAR_MIME_TYPES;

  if (!allowed.has(mimeType)) {
    const label = kind === 'wordTimings' ? 'wordTimings' : kind;
    return {
      ok: false,
      error: `Invalid ${label} sidecar type. Allowed: ${[...allowed].join(', ')}`,
    };
  }

  if (file.size > MAX_SIDECAR_FILE_SIZE_BYTES) {
    return {
      ok: false,
      error: `${kind} sidecar too large. Maximum size is ${MAX_SIDECAR_FILE_SIZE_MB}MB`,
    };
  }

  return { ok: true, mimeType };
}

function buildAudioSidecarUploads(formData: FormData, spaceId: string, variantId: string): AudioSidecarUpload[] {
  const specs: Array<{ kind: AudioSidecarKind; field: string; suffix: string }> = [
    { kind: 'transcript', field: 'transcript', suffix: 'transcript' },
    { kind: 'wordTimings', field: 'wordTimings', suffix: 'word_timings' },
    { kind: 'renderMetadata', field: 'renderMetadata', suffix: 'render_metadata' },
  ];

  return specs.flatMap(({ kind, field, suffix }) => {
    const file = getOptionalFile(formData, field);
    if (!file) return [];
    const ext = MIME_TO_EXT[file.type] || 'json';
    return [{
      kind,
      file,
      key: `sidecars/${spaceId}/${variantId}/${suffix}.${ext}`,
      mimeType: file.type,
    }];
  });
}

function getSidecarCompletionFields(sidecars: AudioSidecarUpload[], sidecarBytes: Map<AudioSidecarKind, number>): Record<string, string | number | null> {
  const get = (kind: AudioSidecarKind) => sidecars.find((sidecar) => sidecar.kind === kind);
  const transcript = get('transcript');
  const wordTimings = get('wordTimings');
  const renderMetadata = get('renderMetadata');

  return {
    transcriptKey: transcript?.key ?? null,
    transcriptMimeType: transcript?.mimeType ?? null,
    transcriptSizeBytes: transcript ? sidecarBytes.get('transcript') ?? null : null,
    wordTimingsKey: wordTimings?.key ?? null,
    wordTimingsMimeType: wordTimings?.mimeType ?? null,
    wordTimingsSizeBytes: wordTimings ? sidecarBytes.get('wordTimings') ?? null : null,
    renderMetadataKey: renderMetadata?.key ?? null,
    renderMetadataMimeType: renderMetadata?.mimeType ?? null,
    renderMetadataSizeBytes: renderMetadata ? sidecarBytes.get('renderMetadata') ?? null : null,
  };
}

export const uploadRoutes = createOpenApiRouter();

// All upload routes require authentication
uploadRoutes.use('/api/spaces/*', authMiddleware);
uploadRoutes.use('/api/spaces/:id/upload', async (c, next) => {
  try {
    await bufferUploadRequest(c, MAX_UPLOAD_BODY_SIZE_BYTES, MEDIA_UPLOAD_LIMIT_MESSAGE);
  } catch (error) {
    if (error instanceof UploadRequestError) return uploadRequestErrorResponse(c, error);
    throw error;
  }
  return next();
});

/**
 * POST /api/spaces/:id/upload
 *
 * Upload an image, audio, or video file to create a new variant on an existing asset.
 *
 * FormData:
 * - file: Media file - max 10MB
 * - assetId: Target asset UUID, or assetName for a new asset
 * - transcript: Optional audio transcript sidecar (text/plain or application/json)
 * - wordTimings: Optional audio word timing sidecar (application/json)
 * - renderMetadata: Optional audio render metadata sidecar (application/json)
 */
uploadRoutes.openapi(uploadMediaRoute, async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;
  const spaceId = c.req.param('id');

  // Verify user is editor/owner
  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }
  if (member.role === 'viewer') {
    return c.json({ error: 'Editor or owner role required' }, 403);
  }

  // Parse FormData
  let formData: FormData;
  try {
    formData = await parseUploadFormData(c);
  } catch (error) {
    if (error instanceof UploadRequestError) {
      return c.json({ error: error.message }, error.status);
    }
    throw error;
  }

  // Get file
  const file = formData.get('file') as File | null;
  if (!file) {
    return c.json({ error: 'No file provided' }, 400);
  }

  // Get assetId (optional - if not provided, create new asset)
  const assetId = getOptionalString(formData, 'assetId');

  // For new asset creation
  const assetName = getOptionalString(formData, 'assetName');
  const assetType = getOptionalString(formData, 'assetType') || 'character';
  const mediaKindValue = formData.get('mediaKind');
  const requestedMediaKind = parseMediaKind(mediaKindValue);
  let generationProvenance: Record<string, unknown> | null;
  let providerMetadata: Record<string, unknown> | null;
  let lineageInputs: UploadLineageInput[];
  let activeVariantBehavior: UploadActiveVariantBehavior;
  let operation: string;
  try {
    generationProvenance = parseJsonObjectField(formData, 'generationProvenance');
    providerMetadata = parseJsonObjectField(formData, 'providerMetadata');
    activeVariantBehavior = parseActiveVariantBehavior(formData);
    const provenanceOperation = typeof generationProvenance?.operation === 'string'
      ? generationProvenance.operation
      : undefined;
    operation = getOptionalString(formData, 'operation') || provenanceOperation || 'upload';
    if (formData.has('lineage') && operation !== 'import') {
      throw new UploadRequestError('lineage is only supported when operation=import', 400);
    }
    lineageInputs = operation === 'import' ? parseUploadLineage(formData) : [];
  } catch (error) {
    if (error instanceof UploadRequestError) {
      return c.json({ error: error.message }, error.status);
    }
    throw error;
  }

  if (
    mediaKindValue !== null &&
    (typeof mediaKindValue !== 'string' || (mediaKindValue !== '' && !requestedMediaKind))
  ) {
    return c.json({ error: 'Invalid mediaKind' }, 400);
  }

  // Either assetId or assetName required
  if (!assetId && !assetName) {
    return c.json({ error: 'Either assetId or assetName is required' }, 400);
  }

  // Validate file type
  const mimeType = file.type;
  const inferredMediaKind = MIME_TO_MEDIA_KIND[mimeType];
  if (!inferredMediaKind) {
    return c.json({
      error: `Invalid file type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
    }, 400);
  }
  if (requestedMediaKind && requestedMediaKind !== inferredMediaKind) {
    return c.json({
      error: `mediaKind "${requestedMediaKind}" does not match ${mimeType} file`,
    }, 400);
  }
  const mediaKind = requestedMediaKind ?? inferredMediaKind;

  // Validate file size
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return c.json({
      error: `File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB`,
    }, 400);
  }

  // Check R2 binding
  if (!env.IMAGES) {
    return c.json({ error: 'Image storage not available' }, 503);
  }

  // Check DO binding
  if (!env.SPACES_DO) {
    return c.json({ error: 'Asset storage not available' }, 503);
  }

  // Generate variant ID and keys
  const variantId = crypto.randomUUID();
  const ext = MIME_TO_EXT[mimeType] || 'png';
  const isImageUpload = mediaKind === 'image' && IMAGE_MIME_TYPES.has(mimeType as ImageMimeType);
  const mediaKey = isImageUpload
    ? `images/${spaceId}/${variantId}.${ext}`
    : `media/${spaceId}/${variantId}.${ext}`;
  const imageKey = isImageUpload ? mediaKey : null;
  const thumbKey = isImageUpload ? `images/${spaceId}/${variantId}_thumb.webp` : null;
  const audioSidecars = buildAudioSidecarUploads(formData, spaceId, variantId);

  if (audioSidecars.length > 0 && mediaKind !== 'audio') {
    return c.json({ error: 'Audio sidecars can only be attached to audio uploads' }, 400);
  }

  for (const sidecar of audioSidecars) {
    const validation = validateSidecarFile(sidecar.kind, sidecar.file);
    if (!validation.ok) {
      return c.json({ error: validation.error }, 400);
    }
  }

  const numericUserId = parseNumericUserId(userId);
  if (numericUserId !== null && env.DB && typeof env.DB.prepare === 'function') {
    try {
      const storageCheck = await checkGenerationGuardrails(env.DB, {
        userId: numericUserId,
        spaceId,
        mode: 'byok',
        service: mediaKind === 'video' ? 'veo' : mediaKind === 'audio' ? 'elevenlabs' : 'nanobanana',
        requestedPlatformUsage: [{
          usageType: 'storage',
          quantity: estimateUploadedStorageBytes(file, audioSidecars, isImageUpload),
        }],
        mediaKind,
        adminUserIds: env.ADMIN_USER_IDS,
      });
      if (!storageCheck.allowed) {
        return c.json({
          error: storageCheck.denyMessage || 'Platform storage limit exceeded.',
        }, 413);
      }
    } catch (error) {
      console.warn('Failed to check upload storage guardrail:', error);
    }
  }

  // Build recipe (consistent with generation recipes)
  const prompt = getOptionalString(formData, 'prompt');
  const model = getOptionalString(formData, 'model');
  const provider = getOptionalString(formData, 'provider');
  const uploadedAt = new Date().toISOString();
  const recipe = JSON.stringify({
    ...(generationProvenance ?? {}),
    operation,
    assetType,
    mediaKind,
    mimeType,
    originalFilename: file.name,
    ...(prompt ? { prompt } : {}),
    ...(model ? { model } : {}),
    ...(provider ? { modelProvider: provider, provider } : {}),
    ...(lineageInputs.length > 0 ? { parentVariantIds: lineageInputs.map((lineage) => lineage.parentVariantId) } : {}),
    sidecars: audioSidecars.map(({ kind, key, mimeType }) => ({ kind, key, mimeType })),
    ...(operation === 'import' ? { importedAt: uploadedAt } : {}),
    uploadedAt,
  });

  const doId = env.SPACES_DO.idFromName(spaceId);
  const doStub = env.SPACES_DO.get(doId);

  // =========================================================================
  // Step 1: Create upload placeholder (broadcasts to all clients immediately)
  // =========================================================================
  let createdNewAsset: UploadMediaResponse['asset'];
  try {
    const placeholderResponse = await doStub.fetch(
      new Request('http://do/internal/upload-placeholder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variantId,
          assetId: assetId || undefined,
          assetName: assetId ? undefined : assetName,
          assetType: assetId ? undefined : assetType,
          mediaKind,
          recipe,
          createdBy: userId,
        }),
      })
    );

    if (!placeholderResponse.ok) {
      const errorData = await placeholderResponse.json().catch(() => ({})) as { error?: string };
      return c.json(
        { error: errorData.error || 'Failed to create upload placeholder' },
        placeholderResponse.status as 400 | 403 | 404 | 500
      );
    }

    const placeholderResult = await placeholderResponse.json() as {
      variant: unknown;
      asset?: unknown;
      assetId: string;
    };
    createdNewAsset = placeholderResult.asset as UploadMediaResponse['asset'];
  } catch (error) {
    console.error('Failed to create upload placeholder:', error);
    return c.json({ error: 'Failed to create upload placeholder' }, 500);
  }

  // =========================================================================
  // Step 2: Upload to R2 (clients see "Uploading" state during this)
  // =========================================================================
  try {
    const mediaBuffer = new Uint8Array(await file.arrayBuffer());
    const dimensions = isImageUpload ? getImageDimensions(mediaBuffer) : null;
    const sidecarBytes = new Map<AudioSidecarKind, number>();

    // Upload primary media to R2
    await env.IMAGES.put(mediaKey, mediaBuffer, {
      httpMetadata: { contentType: mimeType },
    });

    for (const sidecar of audioSidecars) {
      const sidecarBuffer = new Uint8Array(await sidecar.file.arrayBuffer());
      sidecarBytes.set(sidecar.kind, sidecarBuffer.byteLength);
      await env.IMAGES.put(sidecar.key, sidecarBuffer, {
        httpMetadata: { contentType: sidecar.mimeType },
      });
    }

    if (isImageUpload && imageKey && thumbKey) {
      // Create and upload thumbnail
      const baseUrl = getBaseUrl(env);
      try {
        const { buffer: thumbBuffer, mimeType: thumbMimeType } = await createThumbnail(
          imageKey,
          baseUrl,
          env,
          {
            width: 512,
            height: 512,
            fit: 'cover',
            gravity: 'auto',
            quality: 80,
            format: 'webp',
          }
        );

        await env.IMAGES.put(thumbKey, thumbBuffer, {
          httpMetadata: { contentType: thumbMimeType },
        });
      } catch (thumbError) {
        // Fallback: use original image as thumbnail
        console.warn('Thumbnail creation failed, using original:', thumbError);
        await env.IMAGES.put(thumbKey, mediaBuffer, {
          httpMetadata: { contentType: mimeType },
        });
      }
    }

    // =========================================================================
    // Step 3: Complete the upload (broadcasts completed variant to all clients)
    // =========================================================================
    const completeResponse = await doStub.fetch(
      new Request('http://do/internal/complete-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variantId,
          imageKey,
          thumbKey,
          mediaKey,
          mediaMimeType: mimeType,
          mediaSizeBytes: mediaBuffer.byteLength,
          mediaWidth: dimensions?.width ?? null,
          mediaHeight: dimensions?.height ?? null,
          mediaDurationMs: null,
          providerMetadata,
          activeVariantBehavior,
          lineage: lineageInputs,
          ...getSidecarCompletionFields(audioSidecars, sidecarBytes),
        }),
      })
    );

    if (!completeResponse.ok) {
      // R2 upload succeeded but DO update failed - clean up R2
      await deleteUploadedKeys(env, [mediaKey, imageKey, thumbKey, ...audioSidecars.map((sidecar) => sidecar.key)]);
      try {
        await failUploadPlaceholder(doStub, variantId, 'Upload completion failed');
      } catch {
        // Ignore fail-upload errors; the original completion error is returned below.
      }

      const errorData = await completeResponse.json().catch(() => ({})) as { error?: string };
      return c.json(
        { error: errorData.error || 'Failed to complete upload' },
        completeResponse.status as 400 | 403 | 404 | 500
      );
    }

    const result = await completeResponse.json() as {
      variant: UploadMediaResponse['variant'];
      lineage?: UploadMediaResponse['lineage'];
    };
    const responseBody = UploadMediaResponseSchema.parse({
      success: true as const,
      variant: result.variant,
      ...(createdNewAsset ? { asset: createdNewAsset } : {}), // Included when new asset was created
      ...(result.lineage && result.lineage.length > 0 ? { lineage: result.lineage } : {}),
    });

    return c.json(responseBody, 200);
  } catch (error) {
    console.error('Upload failed:', error);

    // Try to clean up R2
    try {
      await deleteUploadedKeys(env, [mediaKey, imageKey, thumbKey]);
      await deleteUploadedKeys(env, audioSidecars.map((sidecar) => sidecar.key));
    } catch {
      // Ignore cleanup errors
    }

    // Mark the placeholder variant as failed
    try {
      await failUploadPlaceholder(doStub, variantId, error instanceof Error ? error.message : 'Upload failed');
    } catch {
      // Ignore fail-upload errors
    }

    return c.json({ error: 'Upload failed' }, 500);
  }
});
