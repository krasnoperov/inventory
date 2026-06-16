import type { Context } from 'hono';
import type { AppContext } from './types';
import { createOpenApiRouter } from './openapi';
import { authMiddleware } from '../middleware/auth-middleware';
import { MemberDAO } from '../../dao/member-dao';
import { getVariantMediaRoute, getVariantPosterRoute } from '../../shared/api/routes';

const imageRoutes = createOpenApiRouter();

type StorageKind = 'image' | 'media';
type VariantMediaArtifact = 'media' | 'poster';

interface VariantMediaRecord {
  id: string;
  status: string;
  media_key?: string | null;
  media_mime_type?: string | null;
  poster_key?: string | null;
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
  if (artifact === 'media') return variant.media_key ?? null;
  return variant.poster_key ?? null;
}

async function serveR2Object(
  c: Context<AppContext>,
  options: {
    key: string;
    kind: StorageKind;
    supportsRange: boolean;
    fallbackContentType?: string | null;
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
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
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
    return new Response(object.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(object.size));
  if (options.supportsRange) headers.set('Accept-Ranges', 'bytes');

  return new Response(object.body, { headers });
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

    const key = getArtifactKey(variantOrResponse, artifact);
    if (!key) {
      return c.json({ error: artifact === 'media' ? 'Variant media not available' : 'Variant poster not available' }, 404);
    }

    return serveR2Object(c, {
      key,
      kind: 'media',
      supportsRange: artifact === 'media',
      fallbackContentType: artifact === 'media' ? variantOrResponse.media_mime_type : null,
    });
  } catch (error) {
    console.error('Error serving media:', error);
    return c.json({ error: 'Failed to serve media' }, 500);
  }
}

imageRoutes.openapi(getVariantMediaRoute, (c) => serveVariantArtifact(c, 'media'));
imageRoutes.openapi(getVariantPosterRoute, (c) => serveVariantArtifact(c, 'poster'));

export { imageRoutes };
