import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_MEDIA_KIND, type MediaKind } from '../../shared/websocket-types';

const MIRROR_REGISTRY_VERSION = 1;
const MIRROR_REGISTRY_FILE = 'mirrors.json';

export interface FileFingerprint {
  sha256: string;
  sizeBytes: number;
}

export interface MirrorEntry {
  version: 1;
  baseUrl: string;
  environment?: string;
  spaceId: string;
  sha256: string;
  sizeBytes: number;
  paths: string[];
  assetId: string;
  variantId: string;
  mediaKind: MediaKind;
  mediaKey?: string | null;
  updatedAt: string;
}

export interface MirrorRegistry {
  version: 1;
  entries: MirrorEntry[];
}

export interface MirrorLookupInput {
  projectRoot?: string;
  baseUrl: string;
  environment?: string;
  spaceId: string;
  filePath: string;
  mediaKind?: MediaKind;
}

export interface MirrorRecordInput extends MirrorLookupInput {
  assetId: string;
  variantId: string;
  mediaKey?: string | null;
}

export interface MirrorResolution {
  fingerprint: FileFingerprint;
  digestEntry?: MirrorEntry;
  pathEntry?: MirrorEntry;
  pathAlias: string;
}

export function getMirrorRegistryPath(projectRoot = process.cwd()): string {
  return path.join(projectRoot, '.inventory', MIRROR_REGISTRY_FILE);
}

export async function readMirrorRegistry(projectRoot = process.cwd()): Promise<MirrorRegistry> {
  const registryPath = getMirrorRegistryPath(projectRoot);
  let raw: string;
  try {
    raw = await readFile(registryPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyRegistry();
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Mirror registry is not valid JSON: ${registryPath}. Move it aside or delete it so the CLI can recreate it.`);
  }

  if (!isMirrorRegistry(parsed)) {
    throw new Error(`Mirror registry has an unsupported format: ${registryPath}`);
  }

  return parsed;
}

export async function writeMirrorRegistry(
  registry: MirrorRegistry,
  projectRoot = process.cwd()
): Promise<string> {
  const registryPath = getMirrorRegistryPath(projectRoot);
  await mkdir(path.dirname(registryPath), { recursive: true });
  const tempPath = `${registryPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  await rename(tempPath, registryPath);
  return registryPath;
}

export async function fingerprintFile(filePath: string): Promise<FileFingerprint> {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new Error(`Mirror source is not a file: ${filePath}`);
  }

  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });

  return {
    sha256: hash.digest('hex'),
    sizeBytes: fileStat.size,
  };
}

export async function resolveMirrorForFile(input: MirrorLookupInput): Promise<MirrorResolution> {
  const projectRoot = input.projectRoot ?? process.cwd();
  const registry = await readMirrorRegistry(projectRoot);
  const fingerprint = await fingerprintFile(input.filePath);
  const pathAlias = toMirrorPathAlias(input.filePath, projectRoot);
  const mediaKind = input.mediaKind ?? DEFAULT_MEDIA_KIND;
  const digestEntry = findMirrorByDigest(registry, {
    ...input,
    mediaKind,
    ...fingerprint,
  });
  const pathEntry = findMirrorByPath(registry, {
    ...input,
    mediaKind,
    pathAlias,
  });

  return {
    fingerprint,
    digestEntry,
    pathEntry,
    pathAlias,
  };
}

export async function recordMirrorForFile(input: MirrorRecordInput): Promise<MirrorEntry> {
  const projectRoot = input.projectRoot ?? process.cwd();
  const registry = await readMirrorRegistry(projectRoot);
  const fingerprint = await fingerprintFile(input.filePath);
  const pathAlias = toMirrorPathAlias(input.filePath, projectRoot);
  const mediaKind = input.mediaKind ?? DEFAULT_MEDIA_KIND;
  const now = new Date().toISOString();

  movePathAliasToCurrentMirror(registry, {
    ...input,
    mediaKind,
    pathAlias,
  });

  const existing = findMirrorByDigest(registry, {
    ...input,
    mediaKind,
    ...fingerprint,
  });

  const entry: MirrorEntry = {
    version: MIRROR_REGISTRY_VERSION,
    baseUrl: input.baseUrl,
    ...(input.environment ? { environment: input.environment } : {}),
    spaceId: input.spaceId,
    sha256: fingerprint.sha256,
    sizeBytes: fingerprint.sizeBytes,
    paths: mergePathAliases(existing?.paths ?? [], pathAlias),
    assetId: input.assetId,
    variantId: input.variantId,
    mediaKind,
    mediaKey: input.mediaKey ?? null,
    updatedAt: now,
  };

  if (existing) {
    const index = registry.entries.indexOf(existing);
    registry.entries[index] = entry;
  } else {
    registry.entries.push(entry);
  }

  await writeMirrorRegistry(registry, projectRoot);
  return entry;
}

export function describeMirrorMismatch(filePath: string, entry: MirrorEntry): string {
  return [
    `Local reference changed since it was mirrored: ${filePath}`,
    `Previously mirrored to variant ${entry.variantId} in space ${entry.spaceId}.`,
    'Use the existing variant ID explicitly, restore the original file, or upload/register a new reference intentionally.',
  ].join(' ');
}

function findMirrorByDigest(
  registry: MirrorRegistry,
  input: MirrorLookupInput & FileFingerprint & { mediaKind: MediaKind }
): MirrorEntry | undefined {
  return registry.entries.find((entry) =>
    entry.baseUrl === input.baseUrl &&
    entry.spaceId === input.spaceId &&
    entry.sha256 === input.sha256 &&
    entry.sizeBytes === input.sizeBytes &&
    entry.mediaKind === input.mediaKind &&
    environmentMatches(entry.environment, input.environment)
  );
}

function findMirrorByPath(
  registry: MirrorRegistry,
  input: MirrorLookupInput & { pathAlias: string; mediaKind: MediaKind }
): MirrorEntry | undefined {
  return registry.entries.find((entry) =>
    entry.baseUrl === input.baseUrl &&
    entry.spaceId === input.spaceId &&
    entry.paths.includes(input.pathAlias) &&
    entry.mediaKind === input.mediaKind &&
    environmentMatches(entry.environment, input.environment)
  );
}

function environmentMatches(entryEnvironment: string | undefined, inputEnvironment: string | undefined): boolean {
  return (entryEnvironment ?? '') === (inputEnvironment ?? '');
}

function movePathAliasToCurrentMirror(
  registry: MirrorRegistry,
  input: MirrorLookupInput & { pathAlias: string; mediaKind: MediaKind }
): void {
  for (const entry of registry.entries) {
    if (
      entry.baseUrl !== input.baseUrl ||
      entry.spaceId !== input.spaceId ||
      entry.mediaKind !== input.mediaKind ||
      !environmentMatches(entry.environment, input.environment)
    ) {
      continue;
    }
    entry.paths = entry.paths.filter((pathAlias) => pathAlias !== input.pathAlias);
  }
}

function toMirrorPathAlias(filePath: string, projectRoot: string): string {
  const absolutePath = path.resolve(filePath);
  const relativePath = path.relative(projectRoot, absolutePath);
  if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return normalizePath(relativePath);
  }
  return normalizePath(absolutePath);
}

function normalizePath(value: string): string {
  return value.split(path.sep).join('/');
}

function mergePathAliases(paths: string[], pathAlias: string): string[] {
  return Array.from(new Set([...paths, pathAlias])).sort();
}

function emptyRegistry(): MirrorRegistry {
  return {
    version: MIRROR_REGISTRY_VERSION,
    entries: [],
  };
}

function isMirrorRegistry(value: unknown): value is MirrorRegistry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const registry = value as Partial<MirrorRegistry>;
  if (registry.version !== MIRROR_REGISTRY_VERSION || !Array.isArray(registry.entries)) return false;
  return registry.entries.every(isMirrorEntry);
}

function isMirrorEntry(value: unknown): value is MirrorEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Partial<MirrorEntry>;
  return (
    entry.version === MIRROR_REGISTRY_VERSION &&
    typeof entry.baseUrl === 'string' &&
    (entry.environment === undefined || typeof entry.environment === 'string') &&
    typeof entry.spaceId === 'string' &&
    typeof entry.sha256 === 'string' &&
    typeof entry.sizeBytes === 'number' &&
    Array.isArray(entry.paths) &&
    entry.paths.every((item) => typeof item === 'string') &&
    typeof entry.assetId === 'string' &&
    typeof entry.variantId === 'string' &&
    typeof entry.mediaKind === 'string' &&
    (entry.mediaKey === undefined || entry.mediaKey === null || typeof entry.mediaKey === 'string') &&
    typeof entry.updatedAt === 'string'
  );
}
