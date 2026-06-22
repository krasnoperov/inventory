export const IMMUTABLE_MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export function isLegacyImageStorageKey(key: string): boolean {
  return key.startsWith('images/') || key.startsWith('thumbs/') || key.startsWith('styles/');
}

export function immutableMediaHttpMetadata(
  key: string,
  contentType: string
): R2HTTPMetadata {
  return isLegacyImageStorageKey(key)
    ? { contentType, cacheControl: IMMUTABLE_MEDIA_CACHE_CONTROL }
    : { contentType };
}
