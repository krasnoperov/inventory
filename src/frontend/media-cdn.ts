let mediaCdnBaseUrl: string | null = null;

function normalizeBaseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, '');
}

function encodeStorageKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

export function configureMediaCdnBaseUrl(value: string | null | undefined): void {
  mediaCdnBaseUrl = normalizeBaseUrl(value);
}

export function getMediaCdnBaseUrl(): string | null {
  return mediaCdnBaseUrl;
}

export function isLegacyImageStorageKey(key: string): boolean {
  return key.startsWith('images/') || key.startsWith('thumbs/') || key.startsWith('styles/');
}

export function getR2ImageUrl(key: string): string {
  if (mediaCdnBaseUrl && isLegacyImageStorageKey(key)) {
    return `${mediaCdnBaseUrl}/${encodeStorageKey(key)}`;
  }
  return `/api/images/${key}`;
}
