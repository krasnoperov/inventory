import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_MEDIA_KIND } from '../../shared/websocket-types';

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export interface UploadedImage {
  asset?: {
    id: string;
    name: string;
    type: string;
  };
  variant: {
    id: string;
    asset_id: string;
    image_key: string;
    thumb_key: string;
    media_key?: string | null;
    media_mime_type?: string | null;
    media_size_bytes?: number | null;
    media_width?: number | null;
    media_height?: number | null;
    media_duration_ms?: number | null;
    status: string;
    recipe: string;
  };
}

interface UploadResponse {
  success: boolean;
  asset?: UploadedImage['asset'];
  variant?: UploadedImage['variant'];
  error?: string;
}

export function isSupportedImagePath(filePath: string): boolean {
  return ALLOWED_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

export function looksLikeFilePath(value: string): boolean {
  return (
    value.startsWith('.') ||
    value.includes('/') ||
    value.includes('\\') ||
    isSupportedImagePath(value)
  );
}

export async function uploadLocalImageAsReference(input: {
  baseUrl: string;
  accessToken: string;
  spaceId: string;
  filePath: string;
  assetName?: string;
}): Promise<UploadedImage> {
  const ext = path.extname(input.filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(`Invalid reference file type "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
  }

  const fileStat = await stat(input.filePath);
  if (!fileStat.isFile()) {
    throw new Error(`Reference is not a file: ${input.filePath}`);
  }
  if (fileStat.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`Reference file too large (${(fileStat.size / 1024 / 1024).toFixed(2)}MB). Maximum size: ${MAX_FILE_SIZE_MB}MB`);
  }

  const fileBuffer = await readFile(input.filePath);
  const filename = path.basename(input.filePath);
  const mimeType = EXT_TO_MIME[ext] || 'image/png';
  const assetName = input.assetName || `Reference: ${filename.replace(/\.[^/.]+$/, '')}`;

  const formData = new FormData();
  formData.append('file', new Blob([fileBuffer], { type: mimeType }), filename);
  formData.append('assetName', assetName);
  formData.append('assetType', 'reference');
  formData.append('mediaKind', DEFAULT_MEDIA_KIND);

  const response = await fetch(`${input.baseUrl}/api/spaces/${input.spaceId}/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${input.accessToken}`,
    },
    body: formData,
  });

  const data = await response.json() as UploadResponse;
  if (!response.ok || !data.success || !data.variant) {
    throw new Error(`Failed to upload reference "${input.filePath}": ${data.error || response.statusText}`);
  }

  return {
    asset: data.asset,
    variant: data.variant,
  };
}

export async function downloadImage(input: {
  baseUrl: string;
  accessToken?: string;
  imageKey: string;
  outputPath: string;
  force?: boolean;
}): Promise<void> {
  if (!input.force) {
    try {
      const existing = await stat(input.outputPath);
      if (existing.isFile()) {
        throw new Error(`Output file already exists: ${input.outputPath}. Pass --force to overwrite.`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  const headers: Record<string, string> = {};
  if (input.accessToken) {
    headers.Authorization = `Bearer ${input.accessToken}`;
  }

  const response = await fetch(`${input.baseUrl}/api/images/${input.imageKey}`, { headers });
  if (!response.ok) {
    throw new Error(`Failed to download image ${input.imageKey}: ${response.status} ${response.statusText}`);
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  await mkdir(path.dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, buffer);
}
