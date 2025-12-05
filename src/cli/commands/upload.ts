/**
 * Upload Command - Upload images to create variants
 *
 * Usage:
 *   npm run cli upload <file> --space <id> --asset <id>     Upload to existing asset
 *   npm run cli upload <file> --space <id> --name <name>    Create new asset
 *   npm run cli upload <file> --space <id> --name <name> --type <type>
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import { loadStoredConfig, resolveBaseUrl } from '../lib/config';

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

interface UploadResponse {
  success: boolean;
  variant?: {
    id: string;
    asset_id: string;
    image_key: string;
    thumb_key: string;
    status: string;
    recipe: string;
  };
  asset?: {
    id: string;
    name: string;
    type: string;
  };
  error?: string;
}

export async function handleUpload(parsed: ParsedArgs): Promise<void> {
  const isLocal = parsed.options.local === 'true';
  const env = isLocal ? 'local' : (parsed.options.env || 'stage');
  const spaceId = parsed.options.space;
  const assetId = parsed.options.asset;
  const assetName = parsed.options.name;
  const assetType = parsed.options.type || 'character';
  const parentAssetId = parsed.options.parent;
  const filePath = parsed.positionals[0];

  // Validate required args
  if (!filePath) {
    console.error('Error: File path is required');
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (!spaceId) {
    console.error('Error: --space is required');
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (!assetId && !assetName) {
    console.error('Error: Either --asset or --name is required');
    printUsage();
    process.exitCode = 1;
    return;
  }

  // Validate file extension
  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    console.error(`Error: Invalid file type "${ext}"`);
    console.error(`Allowed types: ${ALLOWED_EXTENSIONS.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  // Load config
  const config = await loadStoredConfig(env);
  if (!config) {
    console.error(`Not logged in to ${env} environment.`);
    console.error(`Run: npm run cli login --env ${env}`);
    process.exitCode = 1;
    return;
  }

  // Check token expiry
  if (config.token.expiresAt < Date.now()) {
    console.error(`Token expired for ${env} environment.`);
    console.error(`Run: npm run cli login --env ${env}`);
    process.exitCode = 1;
    return;
  }

  const baseUrl = resolveBaseUrl(env);
  const accessToken = config.token.accessToken;

  // Disable SSL verification for local dev
  if (env === 'local') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  try {
    // Check file exists and size
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      console.error(`Error: "${filePath}" is not a file`);
      process.exitCode = 1;
      return;
    }

    if (fileStat.size > MAX_FILE_SIZE_BYTES) {
      console.error(`Error: File too large (${(fileStat.size / 1024 / 1024).toFixed(2)}MB)`);
      console.error(`Maximum size: ${MAX_FILE_SIZE_MB}MB`);
      process.exitCode = 1;
      return;
    }

    // Read file
    const fileBuffer = await readFile(filePath);
    const fileName = path.basename(filePath);
    const mimeType = EXT_TO_MIME[ext] || 'image/png';

    // Build FormData
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append('file', blob, fileName);

    if (assetId) {
      formData.append('assetId', assetId);
    } else {
      formData.append('assetName', assetName!);
      formData.append('assetType', assetType);
      if (parentAssetId) {
        formData.append('parentAssetId', parentAssetId);
      }
    }

    console.log(`\nUploading "${fileName}" to space ${spaceId}...`);
    if (assetId) {
      console.log(`  Target asset: ${assetId}`);
    } else {
      console.log(`  Creating asset: "${assetName}" (${assetType})`);
    }

    // Upload
    const response = await fetch(`${baseUrl}/api/spaces/${spaceId}/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
      body: formData,
    });

    const data = await response.json() as UploadResponse;

    if (!response.ok || !data.success) {
      console.error(`\nUpload failed: ${data.error || response.statusText}`);
      process.exitCode = 1;
      return;
    }

    console.log('\n✓ Upload successful!\n');

    if (data.asset) {
      console.log('New Asset:');
      console.log(`  ID:   ${data.asset.id}`);
      console.log(`  Name: ${data.asset.name}`);
      console.log(`  Type: ${data.asset.type}`);
      console.log('');
    }

    if (data.variant) {
      console.log('Variant:');
      console.log(`  ID:       ${data.variant.id}`);
      console.log(`  Asset:    ${data.variant.asset_id}`);
      console.log(`  Status:   ${data.variant.status}`);
      console.log(`  Image:    ${data.variant.image_key}`);
      console.log(`  Thumb:    ${data.variant.thumb_key}`);
    }

    // Parse and show recipe
    if (data.variant?.recipe) {
      try {
        const recipe = JSON.parse(data.variant.recipe);
        console.log('\nRecipe:');
        console.log(`  Operation: ${recipe.operation}`);
        console.log(`  Original:  ${recipe.originalFilename}`);
        console.log(`  Uploaded:  ${recipe.uploadedAt}`);
      } catch {
        // Ignore parse errors
      }
    }

    console.log('\nTo use in chat:');
    console.log(`  npm run cli chat send "Describe this image" --space ${spaceId}`);

  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error(`Error: File not found: ${filePath}`);
    } else {
      console.error('Error:', error instanceof Error ? error.message : error);
    }
    process.exitCode = 1;
  }
}

function printUsage(): void {
  console.log(`
Usage:
  npm run cli upload <file> --space <id> --asset <id>     Upload to existing asset
  npm run cli upload <file> --space <id> --name <name>    Create new asset

Options:
  --space <id>      Target space ID (required)
  --asset <id>      Target asset ID (upload as new variant)
  --name <name>     New asset name (creates asset + variant)
  --type <type>     Asset type for new assets (default: character)
  --parent <id>     Parent asset ID for new assets
  --env <env>       Environment (production|stage|local)
  --local           Shortcut for --env local

Examples:
  npm run cli upload hero.png --space abc123 --name "Hero Character"
  npm run cli upload variant.jpg --space abc123 --asset def456
  npm run cli upload sword.png --space abc123 --name "Sword" --type item --parent abc789
`);
}
