import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Variant } from './websocket-client';
import type { MediaGenerationCommand } from '../../shared/mediaOperationMatrix';
import type { MediaKind } from '../../shared/websocket-types';

export type RunManifestMedia = {
  index: number;
  mediaKind: MediaKind;
  assetId: string;
  variantId: string;
  mediaKey: string;
  imageKey: string | null;
  thumbKey: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  localPath: string;
  webUrl: string;
};

export type RunManifestImage = RunManifestMedia & {
  mediaKind: 'image';
  imageKey: string;
};

export type RunManifestFailure = {
  variantId: string;
  error: string;
};

export type RunManifest = {
  version: 1;
  runId: string;
  command: MediaGenerationCommand;
  mediaKind: MediaKind;
  success: boolean;
  environment: string;
  spaceId: string;
  baseUrl: string;
  prompt: string;
  name: string;
  assetType: string;
  count: number;
  mode: string;
  refs: string[];
  referenceVariantIds: string[];
  outputDir: string;
  workingDir?: string;
  createdAt: string;
  completedAt: string;
  media: RunManifestMedia[];
  images: RunManifestImage[];
  failed: RunManifestFailure[];
};

export type RunManifestRecord = {
  manifest: RunManifest;
  manifestPath: string;
};

export type RemotionRunExport = {
  version: 1;
  format: 'remotion-keyframes';
  runId: string;
  manifestPath: string;
  projectRoot: string;
  success: boolean;
  prompt: string;
  name: string;
  assetType: string;
  spaceId: string;
  baseUrl: string;
  refs: string[];
  referenceVariantIds: string[];
  createdAt: string;
  completedAt: string;
  media: Array<RunManifestMedia & { absolutePath: string }>;
  images: Array<RunManifestImage & { absolutePath: string }>;
  failed: RunManifestFailure[];
};

export function createRunId(date = new Date()): string {
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const random = crypto.randomUUID().slice(0, 8);
  return `${stamp}-${random}`;
}

export async function saveRunManifest(
  manifest: RunManifest,
  cwd = process.cwd()
): Promise<string> {
  const manifestPath = path.join(cwd, '.inventory', 'runs', `${manifest.runId}.json`);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return manifestPath;
}

export function getRunManifestDir(projectRoot = process.cwd()): string {
  return path.join(projectRoot, '.inventory', 'runs');
}

export async function listRunManifests(projectRoot = process.cwd()): Promise<RunManifestRecord[]> {
  const runsDir = getRunManifestDir(projectRoot);
  let entries: string[];
  try {
    entries = await readdir(runsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const records = await Promise.all(entries
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => readRunManifest(path.join(runsDir, entry))));

  return records.sort((a, b) => {
    const byCreatedAt = Date.parse(b.manifest.createdAt) - Date.parse(a.manifest.createdAt);
    if (Number.isFinite(byCreatedAt) && byCreatedAt !== 0) return byCreatedAt;
    return b.manifestPath.localeCompare(a.manifestPath);
  });
}

export async function readRunManifest(manifestPath: string): Promise<RunManifestRecord> {
  const raw = await readFile(manifestPath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<RunManifest>;
  const manifest = normalizeRunManifest(parsed, manifestPath);
  return { manifest, manifestPath };
}

export async function resolveRunManifest(input: {
  projectRoot: string;
  runIdOrPath?: string;
  latest?: boolean;
}): Promise<RunManifestRecord> {
  if (input.latest) {
    const manifests = await listRunManifests(input.projectRoot);
    if (manifests.length === 0) {
      throw new Error(`No run manifests found in ${getRunManifestDir(input.projectRoot)}`);
    }
    return manifests[0];
  }

  const selector = input.runIdOrPath;
  if (!selector) {
    throw new Error('Run ID, manifest path, or --latest is required');
  }

  const manifestPath = looksLikeManifestPath(selector)
    ? path.resolve(selector)
    : path.join(getRunManifestDir(input.projectRoot), `${selector}.json`);
  return readRunManifest(manifestPath);
}

export function createRemotionRunExport(
  record: RunManifestRecord,
  projectRoot: string
): RemotionRunExport {
  const pathBase = record.manifest.workingDir || projectRoot;

  return {
    version: 1,
    format: 'remotion-keyframes',
    runId: record.manifest.runId,
    manifestPath: record.manifestPath,
    projectRoot,
    success: record.manifest.success,
    prompt: record.manifest.prompt,
    name: record.manifest.name,
    assetType: record.manifest.assetType,
    spaceId: record.manifest.spaceId,
    baseUrl: record.manifest.baseUrl,
    refs: record.manifest.refs,
    referenceVariantIds: record.manifest.referenceVariantIds,
    createdAt: record.manifest.createdAt,
    completedAt: record.manifest.completedAt,
    media: sortedMedia(record.manifest).map((media) => ({
      ...media,
      absolutePath: path.resolve(pathBase, media.localPath),
    })),
    images: [...record.manifest.images]
      .sort((a, b) => a.index - b.index)
      .map((image) => ({
        ...image,
        absolutePath: path.resolve(pathBase, image.localPath),
      })),
    failed: record.manifest.failed,
  };
}

export function manifestMediaFromVariant(input: {
  index: number;
  variant: Variant;
  localPath: string;
  baseUrl: string;
  spaceId: string;
}): RunManifestMedia {
  const mediaKind = input.variant.media_kind || 'image';
  const mediaKey = input.variant.media_key || input.variant.image_key;
  if (!mediaKey) {
    throw new Error(`Variant has no media key: ${input.variant.id}`);
  }

  return {
    index: input.index,
    mediaKind,
    assetId: input.variant.asset_id,
    variantId: input.variant.id,
    mediaKey,
    imageKey: input.variant.image_key,
    thumbKey: input.variant.thumb_key,
    mimeType: input.variant.media_mime_type || null,
    sizeBytes: input.variant.media_size_bytes ?? null,
    width: input.variant.media_width ?? null,
    height: input.variant.media_height ?? null,
    durationMs: input.variant.media_duration_ms ?? null,
    localPath: input.localPath,
    webUrl: `${input.baseUrl}/spaces/${input.spaceId}/assets/${input.variant.asset_id}`,
  };
}

export function manifestImageFromVariant(input: {
  index: number;
  variant: Variant;
  localPath: string;
  baseUrl: string;
  spaceId: string;
}): RunManifestImage {
  const media = manifestMediaFromVariant(input);
  if (media.mediaKind !== 'image' || !media.imageKey) {
    throw new Error(`Variant has no image key: ${input.variant.id}`);
  }
  return { ...media, mediaKind: 'image', imageKey: media.imageKey };
}

function looksLikeManifestPath(value: string): boolean {
  return path.isAbsolute(value) || value.endsWith('.json') || value.includes('/') || value.includes('\\');
}

function normalizeRunManifest(
  manifest: Partial<RunManifest>,
  manifestPath: string
): RunManifest {
  if (manifest.version !== 1) {
    throw new Error(`Unsupported run manifest version in ${manifestPath}`);
  }
  if (!isSupportedCommand(manifest.command)) {
    throw new Error(`Unsupported run manifest command in ${manifestPath}`);
  }
  if (!manifest.runId || typeof manifest.runId !== 'string') {
    throw new Error(`Run manifest is missing runId: ${manifestPath}`);
  }
  const media = Array.isArray(manifest.media) ? manifest.media : manifest.images;
  if (!Array.isArray(media)) {
    throw new Error(`Run manifest is missing media: ${manifestPath}`);
  }
  if (!Array.isArray(manifest.failed)) {
    throw new Error(`Run manifest is missing failed entries: ${manifestPath}`);
  }
  const normalizedMedia = media.map((entry) => normalizeManifestMedia(entry));
  return {
    ...manifest,
    mediaKind: manifest.mediaKind || inferManifestMediaKind(normalizedMedia),
    media: normalizedMedia,
    images: normalizedMedia.filter(isRunManifestImage),
  } as RunManifest;
}

function sortedMedia(manifest: RunManifest): RunManifestMedia[] {
  return [...manifest.media].sort((a, b) => a.index - b.index);
}

function isSupportedCommand(command: unknown): command is MediaGenerationCommand {
  return command === 'generate' || command === 'refine' || command === 'derive' || command === 'batch';
}

function normalizeManifestMedia(entry: RunManifestMedia | RunManifestImage): RunManifestMedia {
  const legacyImageKey = 'imageKey' in entry ? entry.imageKey : null;
  const mediaKey = 'mediaKey' in entry ? entry.mediaKey : legacyImageKey;
  return {
    index: entry.index,
    mediaKind: entry.mediaKind || 'image',
    assetId: entry.assetId,
    variantId: entry.variantId,
    mediaKey: mediaKey || '',
    imageKey: legacyImageKey,
    thumbKey: entry.thumbKey,
    mimeType: 'mimeType' in entry ? entry.mimeType : null,
    sizeBytes: 'sizeBytes' in entry ? entry.sizeBytes : null,
    width: 'width' in entry ? entry.width : null,
    height: 'height' in entry ? entry.height : null,
    durationMs: 'durationMs' in entry ? entry.durationMs : null,
    localPath: entry.localPath,
    webUrl: entry.webUrl,
  };
}

function isRunManifestImage(entry: RunManifestMedia): entry is RunManifestImage {
  return entry.mediaKind === 'image' && Boolean(entry.imageKey);
}

function inferManifestMediaKind(media: RunManifestMedia[]): MediaKind {
  return media[0]?.mediaKind || 'image';
}
