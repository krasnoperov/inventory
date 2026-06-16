/**
 * Upload Command - Upload media to create variants
 *
 * Usage:
 *   pnpm run cli upload <file> --space <id> --asset <id>     Upload to existing asset
 *   pnpm run cli upload <file> --space <id> --name <name>    Create new asset
 *   pnpm run cli upload <file> --space <id> --name <name> --type <type>
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import { loadStoredConfig, resolveBaseUrl } from '../lib/config';
import type { ErrorResponse, UploadMediaResponse } from '../../api/types';
import type { MediaKind } from '../../shared/websocket-types';

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

interface MediaType {
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

interface UploadResult {
  asset?: UploadMediaResponse['asset'];
  variant: UploadMediaResponse['variant'];
}

interface UploadDeps {
  loadConfig: typeof loadStoredConfig;
  resolveBaseUrl: typeof resolveBaseUrl;
  fetch: typeof fetch;
  readFile: typeof readFile;
  stat: typeof stat;
  print: (message: string) => void;
}

const defaultDeps: UploadDeps = {
  loadConfig: loadStoredConfig,
  resolveBaseUrl,
  fetch,
  readFile,
  stat,
  print: console.log,
};

class UploadUsageError extends Error {}

export async function handleUpload(parsed: ParsedArgs): Promise<void> {
  try {
    await executeUpload(parsed);
  } catch (error) {
    console.error(error instanceof Error ? `Error: ${error.message}` : 'Error: Upload failed');
    if (error instanceof UploadUsageError) {
      printUsage();
    }
    process.exitCode = 1;
  }
}

export async function executeUpload(
  parsed: ParsedArgs,
  deps: UploadDeps = defaultDeps
): Promise<UploadResult> {
  const isLocal = parsed.options.local === 'true';
  const env = isLocal ? 'local' : (parsed.options.env || 'stage');
  const spaceId = parsed.options.space;
  const assetId = parsed.options.asset;
  const assetName = parsed.options.name;
  const assetType = parsed.options.type || 'character';
  const parentAssetId = parsed.options.parent;
  const requestedMediaKind = parsed.options['media-kind'] || parsed.options.mediaKind;
  const filePath = parsed.positionals[0];

  // Validate required args
  if (!filePath) {
    throw new UploadUsageError('File path is required');
  }

  if (!spaceId) {
    throw new UploadUsageError('--space is required');
  }

  if (!assetId && !assetName) {
    throw new UploadUsageError('Either --asset or --name is required');
  }

  // Validate file extension
  const ext = path.extname(filePath).toLowerCase();
  const mediaType = resolveMediaType(ext, requestedMediaKind);

  // Load config
  const config = await deps.loadConfig(env);
  if (!config) {
    throw new Error(`Not logged in to ${env} environment. Run: pnpm run cli login --env ${env}`);
  }

  // Check token expiry
  if (config.token.expiresAt < Date.now()) {
    throw new Error(`Token expired for ${env} environment. Run: pnpm run cli login --env ${env}`);
  }

  const baseUrl = deps.resolveBaseUrl(env);
  const accessToken = config.token.accessToken;

  // Disable SSL verification for local dev
  if (env === 'local') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  try {
    // Check file exists and size
    const fileStat = await deps.stat(filePath);
    if (!fileStat.isFile()) {
      throw new Error(`"${filePath}" is not a file`);
    }

    if (fileStat.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`File too large (${(fileStat.size / 1024 / 1024).toFixed(2)}MB). Maximum size: ${MAX_FILE_SIZE_MB}MB`);
    }

    // Read file
    const fileBuffer = await deps.readFile(filePath);
    const fileName = path.basename(filePath);

    // Build FormData
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mediaType.mimeType });
    formData.append('file', blob, fileName);
    formData.append('mediaKind', mediaType.mediaKind);

    if (assetId) {
      formData.append('assetId', assetId);
    } else {
      formData.append('assetName', assetName!);
      formData.append('assetType', assetType);
      if (parentAssetId) {
        formData.append('parentAssetId', parentAssetId);
      }
    }

    deps.print(`\nUploading "${fileName}" to space ${spaceId}...`);
    deps.print(`  Media kind: ${mediaType.mediaKind}`);
    if (assetId) {
      deps.print(`  Target asset: ${assetId}`);
    } else {
      deps.print(`  Creating asset: "${assetName}" (${assetType})`);
    }

    // Upload
    const response = await deps.fetch(`${baseUrl}/api/spaces/${spaceId}/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
      body: formData,
    });

    const data = await response.json() as UploadMediaResponse | ErrorResponse;

    if (!response.ok) {
      throw new Error(`Upload failed: ${'error' in data ? data.error : response.statusText}`);
    }

    const upload = data as UploadMediaResponse;

    deps.print('\nUpload successful!\n');

    if (upload.asset) {
      deps.print('New Asset:');
      deps.print(`  ID:   ${upload.asset.id}`);
      deps.print(`  Name: ${upload.asset.name}`);
      deps.print(`  Type: ${upload.asset.type}`);
      deps.print('');
    }

    deps.print('Variant:');
    deps.print(`  ID:       ${upload.variant.id}`);
    deps.print(`  Asset:    ${upload.variant.asset_id}`);
    deps.print(`  Status:   ${upload.variant.status}`);
    deps.print(`  Media:    ${upload.variant.media_kind || mediaType.mediaKind}`);
    deps.print(`  File:     ${upload.variant.media_key || upload.variant.image_key || '-'}`);
    if (upload.variant.image_key) deps.print(`  Image:    ${upload.variant.image_key}`);
    if (upload.variant.thumb_key) deps.print(`  Thumb:    ${upload.variant.thumb_key}`);
    if (upload.variant.media_mime_type) deps.print(`  MIME:     ${upload.variant.media_mime_type}`);

    // Parse and show recipe
    if (upload.variant.recipe) {
      try {
        const recipe = JSON.parse(upload.variant.recipe);
        deps.print('\nRecipe:');
        deps.print(`  Operation: ${recipe.operation}`);
        deps.print(`  Original:  ${recipe.originalFilename}`);
        deps.print(`  Uploaded:  ${recipe.uploadedAt}`);
      } catch {
        // Ignore parse errors
      }
    }

    deps.print('\nTo inspect:');
    deps.print(`  pnpm run cli assets show ${upload.variant.asset_id} --space ${spaceId}`);

    return { asset: upload.asset, variant: upload.variant };

  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`);
    }
    throw error;
  }
}

function resolveMediaType(ext: string, requestedMediaKind?: string): MediaType {
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

function printUsage(): void {
  console.log(`
Usage:
  pnpm run cli upload <file> --space <id> --asset <id>     Upload media to existing asset
  pnpm run cli upload <file> --space <id> --name <name>    Create new asset

Options:
  --space <id>      Target space ID (required)
  --asset <id>      Target asset ID (upload as new variant)
  --name <name>     New asset name (creates asset + variant)
  --type <type>     Asset type for new assets (default: character)
  --media-kind <k>  Optional explicit kind: image, audio, or video
  --parent <id>     Parent asset ID for new assets
  --env <env>       Environment (production|stage|local)
  --local           Shortcut for --env local

Examples:
  pnpm run cli upload hero.png --space abc123 --name "Hero Character"
  pnpm run cli upload theme.mp3 --space abc123 --name "Theme Music" --type audio
  pnpm run cli upload cutscene.mp4 --space abc123 --name "Opening Cutscene" --type video
  pnpm run cli upload variant.jpg --space abc123 --asset def456
  pnpm run cli upload sword.png --space abc123 --name "Sword" --type item --parent abc789
`);
}
