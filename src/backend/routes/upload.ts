/**
 * Upload Routes
 *
 * Handles media uploads to create new variants on existing assets.
 */
import { Hono } from 'hono';
import type { AppContext } from './types';
import { authMiddleware } from '../middleware/auth-middleware';
import { MemberDAO } from '../../dao/member-dao';
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

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
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

function parseMediaKind(value: FormDataEntryValue | null): MediaKind | undefined {
  if (value === null || typeof value !== 'string' || value === '') return undefined;
  if (value === 'image' || value === 'audio' || value === 'video') return value;
  return undefined;
}

function getOptionalString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === 'string' && value !== '' ? value : null;
}

async function deleteUploadedKeys(env: AppContext['Bindings'], keys: Array<string | null>): Promise<void> {
  const uniqueKeys = [...new Set(keys.filter((key): key is string => Boolean(key)))];
  await Promise.all(uniqueKeys.map((key) => env.IMAGES.delete(key)));
}

export const uploadRoutes = new Hono<AppContext>();

// All upload routes require authentication
uploadRoutes.use('/api/spaces/*', authMiddleware);

/**
 * POST /api/spaces/:id/upload
 *
 * Upload an image, audio, or video file to create a new variant on an existing asset.
 *
 * FormData:
 * - file: Media file - max 10MB
 * - assetId: Target asset UUID, or assetName for a new asset
 */
uploadRoutes.post('/api/spaces/:id/upload', async (c) => {
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
    formData = await c.req.formData();
  } catch {
    return c.json({ error: 'Invalid form data' }, 400);
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
  const parentAssetId = getOptionalString(formData, 'parentAssetId');

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

  // Build recipe (consistent with generation recipes)
  const recipe = JSON.stringify({
    operation: 'upload',
    assetType: assetType,
    mediaKind,
    mimeType,
    originalFilename: file.name,
    uploadedAt: new Date().toISOString(),
  });

  const doId = env.SPACES_DO.idFromName(spaceId);
  const doStub = env.SPACES_DO.get(doId);

  // =========================================================================
  // Step 1: Create upload placeholder (broadcasts to all clients immediately)
  // =========================================================================
  let createdNewAsset: unknown;
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
          parentAssetId: assetId ? undefined : parentAssetId,
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
    createdNewAsset = placeholderResult.asset;
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

    // Upload primary media to R2
    await env.IMAGES.put(mediaKey, mediaBuffer, {
      httpMetadata: { contentType: mimeType },
    });

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
        }),
      })
    );

    if (!completeResponse.ok) {
      // R2 upload succeeded but DO update failed - clean up R2
      await deleteUploadedKeys(env, [mediaKey, imageKey, thumbKey]);

      const errorData = await completeResponse.json().catch(() => ({})) as { error?: string };
      return c.json(
        { error: errorData.error || 'Failed to complete upload' },
        completeResponse.status as 400 | 403 | 404 | 500
      );
    }

    const result = await completeResponse.json() as { variant: unknown };
    return c.json({
      success: true,
      variant: result.variant,
      asset: createdNewAsset, // Included when new asset was created
    });
  } catch (error) {
    console.error('Upload failed:', error);

    // Try to clean up R2
    try {
      await deleteUploadedKeys(env, [mediaKey, imageKey, thumbKey]);
    } catch {
      // Ignore cleanup errors
    }

    // Mark the placeholder variant as failed
    try {
      await doStub.fetch(
        new Request('http://do/internal/fail-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            variantId,
            error: error instanceof Error ? error.message : 'Upload failed',
          }),
        })
      );
    } catch {
      // Ignore fail-upload errors
    }

    return c.json({ error: 'Upload failed' }, 500);
  }
});

/**
 * POST /api/spaces/:id/style-images
 *
 * Upload a style reference image to R2.
 * Returns the imageKey — StylePanel sends it to the DO via sendStyleSet().
 *
 * FormData:
 * - file: Image file (JPEG, PNG, WebP, GIF) - max 10MB
 */
uploadRoutes.post('/api/spaces/:id/style-images', async (c) => {
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
    formData = await c.req.formData();
  } catch {
    return c.json({ error: 'Invalid form data' }, 400);
  }

  // Get file
  const file = formData.get('file') as File | null;
  if (!file) {
    return c.json({ error: 'No file provided' }, 400);
  }

  // Validate file type
  const mimeType = file.type as ImageMimeType;
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return c.json({
      error: `Invalid file type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
    }, 400);
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return c.json({
      error: `File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB`,
    }, 400);
  }

  // Validate minimum resolution for style reference images
  const styleImageBuffer = new Uint8Array(await file.arrayBuffer());
  const dimensions = getImageDimensions(styleImageBuffer);
  if (dimensions && (dimensions.width < 256 || dimensions.height < 256)) {
    return c.json({
      error: `Style image too small (${dimensions.width}x${dimensions.height}). Minimum resolution is 256x256.`,
    }, 400);
  }

  // Check R2 binding
  if (!env.IMAGES) {
    return c.json({ error: 'Image storage not available' }, 503);
  }

  // Generate key under styles/ prefix
  const id = crypto.randomUUID();
  const ext = MIME_TO_EXT[mimeType] || 'png';
  const imageKey = `styles/${spaceId}/${id}.${ext}`;
  const thumbKey = `styles/${spaceId}/${id}_thumb.webp`;

  try {
    // Upload full image to R2 (reuse buffer from dimension check)
    await env.IMAGES.put(imageKey, styleImageBuffer, {
      httpMetadata: { contentType: mimeType },
    });

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
      console.warn('Style thumbnail creation failed, using original:', thumbError);
      await env.IMAGES.put(thumbKey, styleImageBuffer, {
        httpMetadata: { contentType: mimeType },
      });
    }

    // Include dimension warning in response if aspect ratio is unusual
    let warning: string | undefined;
    if (dimensions) {
      const ratio = dimensions.width / dimensions.height;
      if (ratio > 2.5 || ratio < 0.4) {
        warning = `Unusual aspect ratio (${dimensions.width}x${dimensions.height}). Style references work best with standard aspect ratios.`;
      }
    }

    return c.json({ success: true, imageKey, warning });
  } catch (error) {
    console.error('Style image upload failed:', error);

    // Try to clean up R2
    try {
      await env.IMAGES.delete(imageKey);
      await env.IMAGES.delete(thumbKey);
    } catch {
      // Ignore cleanup errors
    }

    return c.json({ error: 'Upload failed' }, 500);
  }
});
