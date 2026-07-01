export const ACCEPTED_UPLOAD_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'audio/aac',
  'audio/flac',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/x-wav',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
];

export const ACCEPTED_UPLOAD_TYPES = ACCEPTED_UPLOAD_MIME_TYPES.join(',');

export function findAcceptedUploadFile(files: FileList | File[]): File | null {
  return Array.from(files).find((file) => ACCEPTED_UPLOAD_MIME_TYPES.includes(file.type)) ?? null;
}

export function defaultAssetNameFromFile(file: File): string {
  return file.name.replace(/\.[^/.]+$/, '');
}
