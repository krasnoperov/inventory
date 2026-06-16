import type { MediaKind } from '../shared/websocket-types';

export function formatMediaKind(mediaKind: MediaKind | string | null | undefined): string {
  if (!mediaKind) {
    return 'Unknown media';
  }

  return mediaKind
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
