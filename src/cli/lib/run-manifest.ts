import { mkdir, writeFile } from 'node:fs/promises';
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

export type RunManifest = {
  version: 1;
  runId: string;
  command: 'batch';
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
