/**
 * Upload Command - Upload one media file to create variants
 *
 * Usage:
 *   makefx upload <file> --space <id> --asset <id>     Upload to existing asset
 *   makefx upload <file> --space <id> --name <name>    Upload as new asset
 *   makefx upload <file> --space <id> --name <name> --type <type>
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import { loadStoredConfig, resolveBaseUrl } from '../lib/config';
import { loadProjectConfig, type ProjectConfig } from '../lib/project-config';
import {
  loginCommandForEnvironment,
  resolveCommandEnvironment,
  resolveCommandSpace,
} from '../lib/command-context';
import type { ErrorResponse, UploadMediaResponse } from '../../api/types';
import {
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_MB,
  resolveMediaType,
} from '../lib/media-upload';
import { recordMirrorForFile } from '../lib/mirror-store';

type LineageRelationType = 'derived' | 'refined' | 'forked';
type ActiveVariantBehavior = 'if-missing' | 'set-active' | 'keep';

interface UploadResult {
  asset?: UploadMediaResponse['asset'];
  variant: UploadMediaResponse['variant'];
  lineage?: UploadMediaResponse['lineage'];
}

interface UploadContext {
  spaceId: string;
  baseUrl: string;
  accessToken: string;
}

interface VariantSummary {
  id: string;
  asset_id: string;
  media_kind?: string | null;
}

interface UploadDeps {
  loadConfig: typeof loadStoredConfig;
  loadProjectConfig: () => Promise<ProjectConfig | null>;
  resolveBaseUrl: typeof resolveBaseUrl;
  fetch: typeof fetch;
  readFile: typeof readFile;
  stat: typeof stat;
  recordMirrorForFile?: typeof recordMirrorForFile;
  print: (message: string) => void;
}

const defaultDeps: UploadDeps = {
  loadConfig: loadStoredConfig,
  loadProjectConfig,
  resolveBaseUrl,
  fetch,
  readFile,
  stat,
  recordMirrorForFile,
  print: console.log,
};

class UploadUsageError extends Error {}

const RETIRED_UPLOAD_ORGANIZATION_OPTIONS: Array<[string, string]> = [
  ['collection', '--collection'],
  ['collection-name', '--collection-name'],
  ['collectionName', '--collection-name'],
  ['collection-role', '--collection-role'],
  ['collectionRole', '--collection-role'],
  ['collection-subject', '--collection-subject'],
  ['collectionSubject', '--collection-subject'],
  ['manual-relation', '--manual-relation'],
  ['manualRelation', '--manual-relation'],
  ['manual-relation-context', '--manual-relation-context'],
  ['manualRelationContext', '--manual-relation-context'],
];

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
  const filePath = parsed.positionals[0];
  if (!filePath) {
    throw new UploadUsageError('File path is required');
  }
  rejectRetiredUploadOrganizationOptions(parsed);

  const projectConfig = await deps.loadProjectConfig();
  const env = resolveCommandEnvironment(parsed, projectConfig);
  const spaceId = resolveCommandSpace(parsed, projectConfig);
  const assetId = parsed.options.asset;
  const assetName = parsed.options.name;
  const assetType = parsed.options.type || 'character';
  const requestedMediaKind = parsed.options['media-kind'] || parsed.options.mediaKind;
  const prompt = parsed.options.prompt;
  const model = parsed.options.model;
  const provider = parsed.options.provider;
  const rawProviderMetadata = parsed.options['provider-metadata'] ?? parsed.options.providerMetadata ?? parsed.options.provider_metadata;
  const rawGenerationProvenance = parsed.options['generation-provenance'] ?? parsed.options.generationProvenance ?? parsed.options.generation_provenance;
  const rawSourceVariantIds = parsed.options['source-variants']
    ?? parsed.options.sourceVariants
    ?? parsed.options.sourceVariantIds
    ?? parsed.options['source-variant']
    ?? parsed.options.sourceVariantId
    ?? parsed.options.parentVariantId;
  const rawRelationType = parsed.options['relation-type'] ?? parsed.options.relationType;
  const rawActiveVariantBehavior = parsed.options['active-variant-behavior'] ?? parsed.options.activeVariantBehavior;
  const jsonOutput = parsed.options.json === 'true';

  if (parsed.options['dry-run'] === 'true' || parsed.options.dryRun === 'true') {
    throw new UploadUsageError('--dry-run is not supported for direct file upload');
  }

  if (!spaceId) {
    throw new UploadUsageError('--space is required, or run: makefx init --space <id>');
  }

  if (!assetId && !assetName) {
    throw new UploadUsageError('Either --asset or --name is required');
  }

  const providerMetadata = parseJsonObjectOption(rawProviderMetadata, '--provider-metadata');
  const generationProvenance = parseJsonObjectOption(rawGenerationProvenance, '--generation-provenance');
  const sourceVariantIds = parseCsvOption(rawSourceVariantIds, '--source-variant');
  const relationType = normalizeRelationType(rawRelationType);
  const activeVariantBehavior = normalizeActiveVariantBehavior(rawActiveVariantBehavior);

  if (sourceVariantIds.length === 0 && (parsed.options['relation-type'] || parsed.options.relationType)) {
    throw new UploadUsageError('--relation-type requires --source-variant or --source-variants');
  }

  // Validate file extension
  const ext = path.extname(filePath).toLowerCase();
  const mediaType = resolveMediaType(ext, requestedMediaKind);

  // Load config
  const config = await deps.loadConfig(env);
  if (!config) {
    throw new Error(`Not logged in to ${env} environment. Run: ${loginCommandForEnvironment(env)}`);
  }

  // Check token expiry
  if (config.token.expiresAt < Date.now()) {
    throw new Error(`Token expired for ${env} environment. Run: ${loginCommandForEnvironment(env)}`);
  }

  const baseUrl = deps.resolveBaseUrl(env);
  const accessToken = config.token.accessToken;
  const ctx: UploadContext = { spaceId, baseUrl, accessToken };

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

    await preflightSourceVariants(ctx, deps, sourceVariantIds);

    // Read file
    const fileBuffer = await deps.readFile(filePath);
    const fileName = path.basename(filePath);

    // Build FormData
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mediaType.mimeType });
    formData.append('file', blob, fileName);
    formData.append('mediaKind', mediaType.mediaKind);
    formData.append('activeVariantBehavior', activeVariantBehavior);

    if (assetId) {
      formData.append('assetId', assetId);
    } else {
      formData.append('assetName', assetName!);
      formData.append('assetType', assetType);
    }
    if (prompt) formData.append('prompt', prompt);
    if (model) formData.append('model', model);
    if (provider) formData.append('provider', provider);
    if (providerMetadata) formData.append('providerMetadata', JSON.stringify(providerMetadata));
    if (generationProvenance) formData.append('generationProvenance', JSON.stringify(generationProvenance));
    if (sourceVariantIds.length > 0) {
      formData.append('lineage', JSON.stringify(
        sourceVariantIds.map((parentVariantId) => ({ parentVariantId, relationType }))
      ));
    }

    if (!jsonOutput) {
      deps.print(`\nUploading "${fileName}" to space ${spaceId}...`);
      deps.print(`  Media kind: ${mediaType.mediaKind}`);
      if (assetId) {
        deps.print(`  Target asset: ${assetId}`);
      } else {
        deps.print(`  Creating asset: "${assetName}" (${assetType})`);
      }
      if (sourceVariantIds.length === 1) {
        deps.print(`  Source variant: ${sourceVariantIds[0]} (${relationType})`);
      } else if (sourceVariantIds.length > 1) {
        deps.print(`  Source variants: ${sourceVariantIds.join(', ')} (${relationType})`);
      }
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
    const result: UploadResult = {
      asset: upload.asset,
      variant: upload.variant,
      lineage: upload.lineage,
    };

    await recordUploadMirror({
      deps,
      projectRoot: projectConfig?.projectRoot,
      env,
      baseUrl,
      spaceId,
      filePath,
      assetId: upload.asset?.id ?? upload.variant.asset_id,
      variantId: upload.variant.id,
      mediaKind: upload.variant.media_kind || mediaType.mediaKind,
      mediaKey: upload.variant.media_key || upload.variant.image_key,
    });

    if (jsonOutput) {
      deps.print(JSON.stringify(result, null, 2));
      return result;
    }

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
    deps.print(`  makefx assets show ${upload.variant.asset_id} --space ${spaceId}`);

    return result;

  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`);
    }
    throw error;
  }
}

async function recordUploadMirror(input: {
  deps: Pick<UploadDeps, 'recordMirrorForFile'>;
  projectRoot?: string;
  env: string;
  baseUrl: string;
  spaceId: string;
  filePath: string;
  assetId: string;
  variantId: string;
  mediaKind: UploadMediaResponse['variant']['media_kind'];
  mediaKey?: string | null;
}): Promise<void> {
  if (!input.deps.recordMirrorForFile) return;
  try {
    await input.deps.recordMirrorForFile({
      projectRoot: input.projectRoot,
      baseUrl: input.baseUrl,
      environment: input.env,
      spaceId: input.spaceId,
      filePath: input.filePath,
      assetId: input.assetId,
      variantId: input.variantId,
      mediaKind: input.mediaKind,
      mediaKey: input.mediaKey,
    });
  } catch (error) {
    console.warn(`Warning: upload succeeded but mirror registry was not updated: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseJsonObjectOption(value: string | undefined, optionName: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new UploadUsageError(`${optionName} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UploadUsageError(`${optionName} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function normalizeRelationType(value: string | undefined): LineageRelationType {
  if (!value) return 'derived';
  if (value === 'derived' || value === 'refined' || value === 'forked') return value;
  throw new UploadUsageError('--relation-type must be derived, refined, or forked');
}

function normalizeActiveVariantBehavior(value: string | undefined): ActiveVariantBehavior {
  if (!value || value === 'if-missing' || value === 'if_missing') return 'if-missing';
  if (value === 'set-active' || value === 'set_active') return 'set-active';
  if (value === 'keep') return 'keep';
  throw new UploadUsageError('--active-variant-behavior must be if-missing, set-active, or keep');
}

function rejectRetiredUploadOrganizationOptions(parsed: ParsedArgs): void {
  const usedOptions = RETIRED_UPLOAD_ORGANIZATION_OPTIONS
    .filter(([key]) => parsed.options[key] !== undefined)
    .map(([, flag]) => flag);

  if (usedOptions.length === 0) return;

  const uniqueFlags = Array.from(new Set(usedOptions)).join(', ');
  throw new UploadUsageError(
    `${uniqueFlags} ${usedOptions.length === 1 ? 'was' : 'were'} removed. ` +
    'Upload creates assets or variants only; organize the result visually on the Space canvas. ' +
    'Use --source-variant for immutable lineage provenance.'
  );
}

function parseCsvOption(value: string | undefined, optionName: string): string[] {
  if (!value) return [];
  if (value === 'true') {
    throw new UploadUsageError(`${optionName} requires a value`);
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function preflightSourceVariants(
  ctx: UploadContext,
  deps: Pick<UploadDeps, 'fetch'>,
  sourceVariantIds: string[]
): Promise<void> {
  if (sourceVariantIds.length === 0) return;
  const state = await fetchVariantState(ctx, deps);
  for (const sourceVariantId of sourceVariantIds) {
    if (!state.variantsById.has(sourceVariantId)) {
      throw new Error(`Source variant not found in space: ${sourceVariantId}`);
    }
  }
}

async function fetchVariantState(
  ctx: UploadContext,
  deps: Pick<UploadDeps, 'fetch'>
): Promise<{ variantsById: Map<string, VariantSummary> }> {
  const data = await fetchJson<{ assets: Array<{ id: string }> }>(ctx, deps, `/api/spaces/${ctx.spaceId}/assets`);
  const assets = data.assets ?? [];
  const variantsById = new Map<string, VariantSummary>();
  await Promise.all(assets.map(async (asset) => {
    const details = await fetchJson<{ variants?: VariantSummary[] }>(
      ctx,
      deps,
      `/api/spaces/${ctx.spaceId}/assets/${encodeURIComponent(asset.id)}`
    );
    for (const variant of details.variants ?? []) {
      variantsById.set(variant.id, variant);
    }
  }));
  return {
    variantsById,
  };
}

async function fetchJson<T>(
  ctx: UploadContext,
  deps: Pick<UploadDeps, 'fetch'>,
  requestPath: string
): Promise<T> {
  const response = await deps.fetch(`${ctx.baseUrl}${requestPath}`, {
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      Accept: 'application/json',
    },
  });
  const data = await response.json().catch(() => ({})) as T & ErrorResponse;
  if (!response.ok) {
    throw new Error('error' in data ? data.error : `Request failed: ${response.status}`);
  }
  return data as T;
}

function printUsage(): void {
  console.log(`
Usage:
  makefx upload <file> --asset <id> [--space <id>]     Upload media to existing asset
  makefx upload <file> --name <name> [--space <id>]    Upload media as a new asset

Options:
  --space <id>      Target space ID; defaults from initialized project
  --asset <id>      Target asset ID (upload as new variant)
  --name <name>     New asset name (creates asset + variant)
  --type <type>     Asset type for new assets (default: character)
  --media-kind <k>  Optional explicit kind: image, audio, or video
  --prompt <text>   Prompt provenance for uploaded media
  --model <model>   Model provenance for uploaded media
  --provider <name> Provider provenance for uploaded media
  --provider-metadata <json>     Provider metadata JSON object
  --generation-provenance <json> Extra provenance JSON object
  --source-variant <ids>         Comma-separated source variants for upload lineage
  --source-variants <ids>        Alias for --source-variant
  --relation-type <type>         Lineage type: derived, refined, or forked (default: derived)
  --active-variant-behavior <b>  if-missing, set-active, or keep
  --json            Print machine-readable upload output with Space IDs
  --env <env>       Environment (production|stage|local)
  --local           Shortcut for --env local

Examples:
  makefx upload hero.png --space abc123 --name "Hero Character"
  makefx upload hero.png --space abc123 --name "Hero" --prompt "external render" --provider blender
  makefx upload paintover.png --space abc123 --asset def456 --source-variant var123 --relation-type refined
  makefx upload scene.png --space abc123 --name "Cocina" --type scene --source-variants anna,roman,bg
  makefx upload theme.mp3 --space abc123 --name "Theme Music" --type audio
  makefx upload cutscene.mp4 --space abc123 --name "Opening Cutscene" --type video
  makefx upload variant.jpg --space abc123 --asset def456
  makefx upload hero.png --space abc123 --name "Hero" --json
`);
}
