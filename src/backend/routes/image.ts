import type { Context } from 'hono';
import type { AppContext } from './types';
import { createOpenApiRouter } from './openapi';
import { authMiddleware } from '../middleware/auth-middleware';
import { MemberDAO } from '../../dao/member-dao';
import {
  getVariantMediaRoute,
  getVariantPosterRoute,
  getVariantRenderMetadataRoute,
  getVariantTranscriptRoute,
  getVariantWordTimingsRoute,
} from '../../shared/api/routes';
import { trackPlatformUsage } from '../platform/platformUsage';

const imageRoutes = createOpenApiRouter();

type StorageKind = 'image' | 'media';
type VariantMediaArtifact = 'media' | 'poster' | 'transcript' | 'wordTimings' | 'renderMetadata';

interface VariantMediaRecord {
  id: string;
  status: string;
  media_kind?: 'image' | 'audio' | 'video' | null;
  image_key?: string | null;
  media_key?: string | null;
  media_mime_type?: string | null;
  poster_key?: string | null;
  transcript_key?: string | null;
  transcript_mime_type?: string | null;
  word_timings_key?: string | null;
  word_timings_mime_type?: string | null;
  render_metadata_key?: string | null;
  render_metadata_mime_type?: string | null;
}

const MEDIA_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  json: 'application/json',
  txt: 'text/plain',
};

function getKey(path: string, prefix: string): string {
  return path.slice(prefix.length);
}

function inferMediaContentType(key: string): string {
  const extension = key.split('.').pop()?.toLowerCase();
  if (!extension) return 'application/octet-stream';
  return MEDIA_MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

function getContentType(object: R2ObjectBody, key: string, kind: StorageKind): string {
  if (object.httpMetadata?.contentType) return object.httpMetadata.contentType;
  return kind === 'image' ? 'image/png' : inferMediaContentType(key);
}

function getMediaContentType(object: R2ObjectBody, key: string, fallbackContentType?: string | null): string {
  if (object.httpMetadata?.contentType) return object.httpMetadata.contentType;
  return fallbackContentType ?? inferMediaContentType(key);
}

function getRangeContentLength(range: R2Range, totalSize: number): number | null {
  if ('suffix' in range) return Math.min(range.suffix, totalSize);
  if (range.length !== undefined) return range.length;
  if (range.offset !== undefined) return totalSize - range.offset;
  return null;
}

function getContentRange(range: R2Range, totalSize: number): string | null {
  if ('suffix' in range) {
    const length = Math.min(range.suffix, totalSize);
    return `bytes ${totalSize - length}-${totalSize - 1}/${totalSize}`;
  }

  if (range.offset === undefined) return null;

  const length = range.length ?? totalSize - range.offset;
  return `bytes ${range.offset}-${range.offset + length - 1}/${totalSize}`;
}

function getArtifactKey(variant: VariantMediaRecord, artifact: VariantMediaArtifact): string | null {
  if (artifact === 'media') return variant.media_key ?? variant.image_key ?? null;
  if (artifact === 'poster') return variant.poster_key ?? null;
  if (artifact === 'transcript') return variant.transcript_key ?? null;
  if (artifact === 'wordTimings') return variant.word_timings_key ?? null;
  return variant.render_metadata_key ?? null;
}

function getArtifactFallbackContentType(variant: VariantMediaRecord, artifact: VariantMediaArtifact): string | null | undefined {
  if (artifact === 'media') return variant.media_mime_type;
  if (artifact === 'transcript') return variant.transcript_mime_type;
  if (artifact === 'wordTimings') return variant.word_timings_mime_type;
  if (artifact === 'renderMetadata') return variant.render_metadata_mime_type;
  return null;
}

function getArtifactUnavailableMessage(artifact: VariantMediaArtifact): string {
  switch (artifact) {
    case 'media':
      return 'Variant media not available';
    case 'poster':
      return 'Variant poster not available';
    case 'transcript':
      return 'Variant transcript not available';
    case 'wordTimings':
      return 'Variant word timings not available';
    case 'renderMetadata':
      return 'Variant render metadata not available';
  }
}

function isLegacyImageKey(key: string): boolean {
  return key.startsWith('images/') || key.startsWith('styles/') || key.startsWith('thumbs/');
}

async function serveR2Object(
  c: Context<AppContext>,
  options: {
    key: string;
    kind: StorageKind;
    supportsRange: boolean;
    fallbackContentType?: string | null;
    cacheControl?: string;
    platformUsage?: {
      spaceId: string;
      userId?: number | null;
      variantId: string;
      artifact: VariantMediaArtifact;
      mediaKind?: 'image' | 'audio' | 'video' | null;
    };
  }
): Promise<Response> {
  const env = c.env;

  if (!env.IMAGES) {
    return c.json({ error: options.kind === 'image' ? 'Image storage not configured' : 'Media storage not configured' }, 503);
  }

  const range = options.supportsRange ? c.req.raw.headers.get('Range') : null;
  const object = await env.IMAGES.get(
    options.key,
    range ? { range: c.req.raw.headers } : undefined
  );

  if (!object) {
    return c.json({ error: options.kind === 'image' ? 'Image not found' : 'Media not found' }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set(
    'Content-Type',
    options.kind === 'media'
      ? getMediaContentType(object, options.key, options.fallbackContentType)
      : getContentType(object, options.key, options.kind)
  );
  headers.set('Cache-Control', options.cacheControl ?? 'public, max-age=31536000, immutable');
  headers.set('ETag', object.httpEtag);

  const ifNoneMatch = c.req.header('If-None-Match');
  if (ifNoneMatch === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }

  if (object.range) {
    headers.set('Accept-Ranges', 'bytes');
    const contentRange = getContentRange(object.range, object.size);
    if (contentRange) headers.set('Content-Range', contentRange);
    const contentLength = getRangeContentLength(object.range, object.size);
    if (contentLength !== null) headers.set('Content-Length', String(contentLength));
    await recordDeliveryUsage(c, options, contentLength ?? 0, 206, contentRange);
    return new Response(object.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(object.size));
  if (options.supportsRange) headers.set('Accept-Ranges', 'bytes');

  await recordDeliveryUsage(c, options, object.size, 200);
  return new Response(object.body, { headers });
}

async function recordDeliveryUsage(
  c: Context<AppContext>,
  options: Parameters<typeof serveR2Object>[1],
  bytesDelivered: number,
  status: 200 | 206,
  contentRange?: string | null
): Promise<void> {
  if (!options.platformUsage || bytesDelivered <= 0) return;

  try {
    await trackPlatformUsage(c.env.DB, {
      spaceId: options.platformUsage.spaceId,
      userId: options.platformUsage.userId ?? null,
      usageType: 'delivery',
      quantity: bytesDelivered,
      unit: 'byte',
      variantId: options.platformUsage.variantId,
      artifactKey: options.key,
      mediaKind: options.platformUsage.mediaKind ?? null,
      metadata: {
        artifact: options.platformUsage.artifact,
        status,
        contentRange: contentRange ?? undefined,
      },
    });
  } catch (error) {
    console.warn('Failed to track delivery usage:', error);
  }
}

async function getVariantFromSpace(
  c: Context<AppContext>,
  spaceId: string,
  variantId: string
): Promise<VariantMediaRecord | Response> {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }

  const env = c.env;
  if (!env.SPACES_DO) {
    return c.json({ error: 'Asset storage not available' }, 503);
  }

  const doId = env.SPACES_DO.idFromName(spaceId);
  const doStub = env.SPACES_DO.get(doId);
  const variantResponse = await doStub.fetch(
    new Request(`http://do/internal/variant/${encodeURIComponent(variantId)}`)
  );

  if (variantResponse.status === 404) {
    return c.json({ error: 'Variant not found' }, 404);
  }

  if (!variantResponse.ok) {
    return c.json({ error: 'Failed to fetch variant' }, 500);
  }

  return (await variantResponse.json()) as VariantMediaRecord;
}

// GET /api/images/* - Serve image from R2
// Key can contain slashes, e.g., images/spaceId/variantId.png
imageRoutes.get('/api/images/*', async (c) => {
  try {
    const key = getKey(c.req.path, '/api/images/');
    if (!isLegacyImageKey(key)) {
      return c.json({ error: 'Image not found' }, 404);
    }
    return serveR2Object(c, { key, kind: 'image', supportsRange: false });
  } catch (error) {
    console.error('Error serving image:', error);
    return c.json({ error: 'Failed to serve image' }, 500);
  }
});

// Authenticated variant media routes. Callers identify a variant artifact; the
// server resolves the stored R2 key after membership checks.
imageRoutes.use('/api/spaces/*', authMiddleware);

async function serveVariantArtifact(c: Context<AppContext>, artifact: VariantMediaArtifact): Promise<Response> {
  try {
    const spaceId = c.req.param('spaceId') ?? '';
    const variantId = c.req.param('variantId') ?? '';
    const variantOrResponse = await getVariantFromSpace(c, spaceId, variantId);

    if (variantOrResponse instanceof Response) {
      return variantOrResponse;
    }

    if (variantOrResponse.status !== 'completed') {
      return c.json({ error: getArtifactUnavailableMessage(artifact) }, 404);
    }

    const key = getArtifactKey(variantOrResponse, artifact);
    if (!key) {
      return c.json({ error: getArtifactUnavailableMessage(artifact) }, 404);
    }

    return serveR2Object(c, {
      key,
      kind: 'media',
      supportsRange: artifact === 'media',
      fallbackContentType: getArtifactFallbackContentType(variantOrResponse, artifact),
      cacheControl: 'private, max-age=31536000, immutable',
      platformUsage: {
        spaceId,
        userId: c.get('userId') ?? null,
        variantId,
        artifact,
        mediaKind: variantOrResponse.media_kind ?? null,
      },
    });
  } catch (error) {
    console.error('Error serving media:', error);
    return c.json({ error: 'Failed to serve media' }, 500);
  }
}

imageRoutes.openapi(getVariantMediaRoute, (c) => serveVariantArtifact(c, 'media'));
imageRoutes.openapi(getVariantPosterRoute, (c) => serveVariantArtifact(c, 'poster'));
imageRoutes.openapi(getVariantTranscriptRoute, (c) => serveVariantArtifact(c, 'transcript'));
imageRoutes.openapi(getVariantWordTimingsRoute, (c) => serveVariantArtifact(c, 'wordTimings'));
imageRoutes.openapi(getVariantRenderMetadataRoute, (c) => serveVariantArtifact(c, 'renderMetadata'));

export { imageRoutes };
