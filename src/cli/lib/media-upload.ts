import type { MediaKind } from '../../shared/websocket-types';

export const MAX_FILE_SIZE_MB = 10;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export interface MediaType {
  mediaKind: MediaKind;
  mimeType: string;
}

const EXT_TO_MEDIA_TYPE: Record<string, MediaType> = {
  '.aac': { mediaKind: 'audio', mimeType: 'audio/aac' },
  '.flac': { mediaKind: 'audio', mimeType: 'audio/flac' },
  '.gif': { mediaKind: 'image', mimeType: 'image/gif' },
  '.jpg': { mediaKind: 'image', mimeType: 'image/jpeg' },
  '.jpeg': { mediaKind: 'image', mimeType: 'image/jpeg' },
  '.m4a': { mediaKind: 'audio', mimeType: 'audio/mp4' },
  '.m4v': { mediaKind: 'video', mimeType: 'video/x-m4v' },
  '.mov': { mediaKind: 'video', mimeType: 'video/quicktime' },
  '.mp3': { mediaKind: 'audio', mimeType: 'audio/mpeg' },
  '.mp4': { mediaKind: 'video', mimeType: 'video/mp4' },
  '.ogg': { mediaKind: 'audio', mimeType: 'audio/ogg' },
  '.png': { mediaKind: 'image', mimeType: 'image/png' },
  '.wav': { mediaKind: 'audio', mimeType: 'audio/wav' },
  '.webm': { mediaKind: 'video', mimeType: 'video/webm' },
  '.webp': { mediaKind: 'image', mimeType: 'image/webp' },
};

const ALLOWED_EXTENSIONS = Object.keys(EXT_TO_MEDIA_TYPE).sort();

export function resolveMediaType(ext: string, requestedMediaKind?: string): MediaType {
  const mediaType = EXT_TO_MEDIA_TYPE[ext];
  if (!mediaType) {
    throw new Error(`Invalid file type "${ext}". Allowed types: ${ALLOWED_EXTENSIONS.join(', ')}`);
  }

  if (
    requestedMediaKind !== undefined &&
    requestedMediaKind !== 'image' &&
    requestedMediaKind !== 'audio' &&
    requestedMediaKind !== 'video'
  ) {
    throw new Error('Invalid --media-kind. Expected image, audio, or video');
  }

  if (ext === '.webm' && requestedMediaKind === 'audio') {
    return { mediaKind: 'audio', mimeType: 'audio/webm' };
  }

  if (requestedMediaKind && requestedMediaKind !== mediaType.mediaKind) {
    throw new Error(`--media-kind ${requestedMediaKind} does not match ${ext} (${mediaType.mediaKind})`);
  }

  return mediaType;
}
