import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Variant } from './websocket-client';

export type RunManifestImage = {
  index: number;
  assetId: string;
  variantId: string;
  imageKey: string;
  thumbKey: string | null;
  localPath: string;
  webUrl: string;
};

export type RunManifestFailure = {
  variantId: string;
  error: string;
};

export type RunManifest = {
  version: 1;
  runId: string;
  command: 'batch';
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
  createdAt: string;
  completedAt: string;
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
  validateRunManifest(parsed, manifestPath);
  return { manifest: parsed, manifestPath };
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
    images: [...record.manifest.images]
      .sort((a, b) => a.index - b.index)
      .map((image) => ({
        ...image,
        absolutePath: path.resolve(projectRoot, image.localPath),
      })),
    failed: record.manifest.failed,
  };
}

export function manifestImageFromVariant(input: {
  index: number;
  variant: Variant;
  localPath: string;
  baseUrl: string;
  spaceId: string;
}): RunManifestImage {
  if (!input.variant.image_key) {
    throw new Error(`Variant has no image key: ${input.variant.id}`);
  }

  return {
    index: input.index,
    assetId: input.variant.asset_id,
    variantId: input.variant.id,
    imageKey: input.variant.image_key,
    thumbKey: input.variant.thumb_key,
    localPath: input.localPath,
    webUrl: `${input.baseUrl}/spaces/${input.spaceId}/assets/${input.variant.asset_id}`,
  };
}

function looksLikeManifestPath(value: string): boolean {
  return path.isAbsolute(value) || value.endsWith('.json') || value.includes('/') || value.includes('\\');
}

function validateRunManifest(
  manifest: Partial<RunManifest>,
  manifestPath: string
): asserts manifest is RunManifest {
  if (manifest.version !== 1) {
    throw new Error(`Unsupported run manifest version in ${manifestPath}`);
  }
  if (manifest.command !== 'batch') {
    throw new Error(`Unsupported run manifest command in ${manifestPath}`);
  }
  if (!manifest.runId || typeof manifest.runId !== 'string') {
    throw new Error(`Run manifest is missing runId: ${manifestPath}`);
  }
  if (!Array.isArray(manifest.images)) {
    throw new Error(`Run manifest is missing images: ${manifestPath}`);
  }
  if (!Array.isArray(manifest.failed)) {
    throw new Error(`Run manifest is missing failed entries: ${manifestPath}`);
  }
}
