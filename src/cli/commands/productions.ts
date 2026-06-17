import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import type { ParsedArgs, StoredConfig } from '../lib/types';
import { loadStoredConfig, resolveBaseUrl } from '../lib/config';
import { loadProjectConfig, type ProjectConfig } from '../lib/project-config';
import { downloadFile } from '../lib/image-transfer';
import {
  loginCommandForEnvironment,
  resolveCommandEnvironment,
  resolveCommandSpace,
} from '../lib/command-context';
import { truncate } from '../lib/utils';
import { apiFetch } from '../../shared/api/client';
import type { PlaceProductionRecordRequest, ProductionRecord } from '../../shared/api/schemas';

type ProductionsResult =
  | { type: 'list'; records: ProductionRecord[] }
  | { type: 'place'; record: ProductionRecord }
  | { type: 'delete'; recordId: string }
  | { type: 'export'; records: ProductionRecord[]; outputPath?: string; content: string };

interface ProductionsDeps {
  loadConfig: (env: string) => Promise<StoredConfig | null>;
  loadProjectConfig: () => Promise<ProjectConfig | null>;
  resolveBaseUrl: (env: string) => string;
  fetch: typeof fetch;
  downloadFile: typeof downloadFile;
  writeFile: typeof writeFile;
  print: (message: string) => void;
}

interface ProductionsContext {
  env: string;
  spaceId: string;
  baseUrl: string;
  accessToken: string;
}

const defaultDeps: ProductionsDeps = {
  loadConfig: loadStoredConfig,
  loadProjectConfig,
  resolveBaseUrl,
  fetch,
  downloadFile,
  writeFile,
  print: console.log,
};

interface ProductionExportMedia {
  recordId: string;
  localPath: string;
  absolutePath: string;
}

export async function handleProductions(parsed: ParsedArgs): Promise<void> {
  try {
    await executeProductions(parsed);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    printUsage();
    process.exitCode = 1;
  }
}

export async function executeProductions(
  parsed: ParsedArgs,
  deps: ProductionsDeps = defaultDeps
): Promise<ProductionsResult> {
  const ctx = await buildContext(parsed, deps);
  const subcommand = parsed.positionals[0] || 'list';

  if (subcommand === 'list') {
    const productionId = readProductionId(parsed, 1);
    const records = await listProductionRecords(ctx, deps, productionId);
    if (parsed.options.json === 'true') {
      deps.print(JSON.stringify(records.map((record) => toRecordJson(record, ctx)), null, 2));
    } else {
      printRecordList(records, ctx, deps.print);
    }
    return { type: 'list', records };
  }

  if (subcommand === 'export') {
    const productionId = readProductionId(parsed, 1);
    const outputPath = parsed.options.o || parsed.options.output;
    const records = sortProductionRecords(await listProductionRecords(ctx, deps, productionId));
    if (records.length === 0) {
      throw new Error(`No production records found for production ID: ${productionId}`);
    }
    const media = await downloadProductionExportMedia(records, ctx, deps, {
      productionId,
      outputPath: outputPath === 'true' ? undefined : outputPath,
      mediaDir: readOptionalOption(parsed, 'media-dir', 'mediaDir'),
      force: parsed.options.force === 'true',
    });
    const content = parsed.options.json === 'true'
      ? JSON.stringify(createProductionHandoffExport(records, ctx, productionId, media), null, 2)
      : formatProductionSceneArgs(records, media);
    if (!content) {
      throw new Error(`No image or video production records found for production ID: ${productionId}`);
    }

    if (outputPath && outputPath !== 'true') {
      await deps.writeFile(outputPath, content + '\n', 'utf8');
      deps.print(`Wrote production scene export: ${outputPath}`);
    } else {
      deps.print(content);
    }

    return {
      type: 'export',
      records,
      outputPath: outputPath === 'true' ? undefined : outputPath,
      content,
    };
  }

  if (subcommand === 'place') {
    const record = await placeProductionRecord(ctx, deps, parsePlaceRequest(parsed));
    if (parsed.options.json === 'true') {
      deps.print(JSON.stringify(toRecordJson(record, ctx), null, 2));
    } else {
      deps.print(`Placed ${record.variant_id} in production ${record.production_id} at ${record.timeline_start_ms}ms`);
      deps.print(`  Record:  ${record.id}`);
      deps.print(`  Scene:   ${record.scene_label}`);
      deps.print(`  Media:   ${buildVariantMediaUrl(ctx, record.variant_id)}`);
    }
    return { type: 'place', record };
  }

  if (subcommand === 'delete') {
    const recordId = parsed.positionals[1];
    if (!recordId) {
      throw new Error('Production record ID is required: pnpm run cli productions delete <record-id>');
    }
    await deleteProductionRecord(ctx, deps, recordId);
    deps.print(`Deleted production record: ${recordId}`);
    return { type: 'delete', recordId };
  }

  throw new Error(`Unknown productions command: ${subcommand}`);
}

export async function placeProductionRecordForCli(input: {
  baseUrl: string;
  accessToken: string;
  spaceId: string;
  fetch?: typeof fetch;
  record: PlaceProductionRecordRequest;
}): Promise<ProductionRecord> {
  const response = await apiFetch('POST /api/spaces/:id/production/placements', {
    baseUrl: input.baseUrl,
    fetch: input.fetch,
    params: { id: input.spaceId },
    json: input.record,
    headers: {
      'Authorization': `Bearer ${input.accessToken}`,
      'Accept': 'application/json',
    },
  });
  return response.record;
}

async function buildContext(parsed: ParsedArgs, deps: ProductionsDeps): Promise<ProductionsContext> {
  const projectConfig = await deps.loadProjectConfig();
  const env = resolveCommandEnvironment(parsed, projectConfig);
  const spaceId = resolveCommandSpace(parsed, projectConfig);
  if (!spaceId) {
    throw new Error('--space is required, or run: pnpm run cli init --space <id>');
  }

  const config = await deps.loadConfig(env);
  if (!config) {
    throw new Error(`Not logged in to ${env} environment. Run: ${loginCommandForEnvironment(env)}`);
  }
  if (config.token.expiresAt < Date.now()) {
    throw new Error(`Token expired for ${env} environment. Run: ${loginCommandForEnvironment(env)}`);
  }
  if (env === 'local') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  return {
    env,
    spaceId,
    baseUrl: deps.resolveBaseUrl(env),
    accessToken: config.token.accessToken,
  };
}

async function listProductionRecords(
  ctx: ProductionsContext,
  deps: Pick<ProductionsDeps, 'fetch'>,
  productionId: string
): Promise<ProductionRecord[]> {
  const response = await apiFetch('GET /api/spaces/:id/productions/:productionId/records', {
    baseUrl: ctx.baseUrl,
    fetch: deps.fetch,
    params: { id: ctx.spaceId, productionId },
    headers: {
      'Authorization': `Bearer ${ctx.accessToken}`,
      'Accept': 'application/json',
    },
  });
  return response.records;
}

async function placeProductionRecord(
  ctx: ProductionsContext,
  deps: Pick<ProductionsDeps, 'fetch'>,
  record: PlaceProductionRecordRequest
): Promise<ProductionRecord> {
  return placeProductionRecordForCli({
    baseUrl: ctx.baseUrl,
    accessToken: ctx.accessToken,
    spaceId: ctx.spaceId,
    fetch: deps.fetch,
    record,
  });
}

async function deleteProductionRecord(
  ctx: ProductionsContext,
  deps: Pick<ProductionsDeps, 'fetch'>,
  recordId: string
): Promise<void> {
  await apiFetch('DELETE /api/spaces/:id/production/records/:recordId', {
    baseUrl: ctx.baseUrl,
    fetch: deps.fetch,
    params: { id: ctx.spaceId, recordId },
    headers: {
      'Authorization': `Bearer ${ctx.accessToken}`,
      'Accept': 'application/json',
    },
  });
}

function readProductionId(parsed: ParsedArgs, positionalIndex: number): string {
  const productionId = parsed.positionals[positionalIndex] || parsed.options['production-id'] || parsed.options.productionId;
  if (!productionId || productionId === 'true') {
    throw new Error('--production-id is required');
  }
  return productionId;
}

function parsePlaceRequest(parsed: ParsedArgs): PlaceProductionRecordRequest {
  const productionId = readRequiredOption(parsed, 'production-id', 'productionId');
  const variantId = readRequiredOption(parsed, 'variant', 'variantId');
  const sceneLabel = readRequiredOption(parsed, 'scene-label', 'sceneLabel');
  const timelineStartMs = parseNonNegativeInteger(
    readRequiredOption(parsed, 'timeline-start-ms', 'timelineStartMs'),
    '--timeline-start-ms'
  );
  const durationValue = readOptionalOption(parsed, 'duration-ms', 'durationMs');

  return {
    id: readOptionalOption(parsed, 'id', 'id'),
    productionId,
    variantId,
    shotId: readOptionalOption(parsed, 'shot-id', 'shotId'),
    sceneLabel,
    timelineStartMs,
    durationMs: durationValue === undefined ? undefined : parseNonNegativeInteger(durationValue, '--duration-ms'),
    motionPrompt: readOptionalOption(parsed, 'motion-prompt', 'motionPrompt'),
    sourceRefs: parseCsvOption(readOptionalOption(parsed, 'source-refs', 'sourceRefs')),
    sourceVariantIds: parseCsvOption(readOptionalOption(parsed, 'source-variant-ids', 'sourceVariantIds')),
    metadata: parseMetadataJson(readOptionalOption(parsed, 'metadata-json', 'metadataJson')),
  };
}

function readRequiredOption(parsed: ParsedArgs, kebabName: string, camelName: string): string {
  const value = readOptionalOption(parsed, kebabName, camelName);
  if (value === undefined) {
    throw new Error(`--${kebabName} is required`);
  }
  return value;
}

function readOptionalOption(parsed: ParsedArgs, kebabName: string, camelName: string): string | undefined {
  const value = parsed.options[kebabName] ?? parsed.options[camelName];
  if (value === undefined || value === 'true') return undefined;
  return value;
}

function parseCsvOption(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function parseMetadataJson(value: string | undefined): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--metadata-json must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function parseNonNegativeInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

function printRecordList(records: ProductionRecord[], ctx: ProductionsContext, print: (message: string) => void): void {
  if (records.length === 0) {
    print('No production records found.');
    return;
  }

  print(`Found ${records.length} production record(s):\n`);
  print('Start'.padEnd(10) + 'Kind'.padEnd(8) + 'Scene'.padEnd(24) + 'Shot'.padEnd(20) + 'Variant'.padEnd(28) + 'Record');
  print('-'.repeat(112));
  for (const record of records) {
    print(
      `${record.timeline_start_ms}ms`.padEnd(10) +
      record.media_kind.padEnd(8) +
      truncate(record.scene_label, 22).padEnd(24) +
      truncate(record.shot_id || '-', 18).padEnd(20) +
      truncate(record.variant_id, 26).padEnd(28) +
      record.id
    );
  }
  print(`\nMedia URLs resolve through ${ctx.baseUrl}/api/spaces/${ctx.spaceId}/variants/<variant>/media`);
}

function createProductionHandoffExport(
  records: ProductionRecord[],
  ctx: ProductionsContext,
  productionId: string,
  media: ProductionExportMedia[]
): Record<string, unknown> {
  const mediaByRecordId = new Map(media.map((item) => [item.recordId, item]));
  return {
    version: 1,
    format: 'website-production-handoff',
    productionId,
    spaceId: ctx.spaceId,
    generatedAt: new Date().toISOString(),
    records: records.map((record) => {
      const item = mediaByRecordId.get(record.id);
      const recordJson = toRecordJson(record, ctx);
      delete recordJson.mediaUrl;
      return {
        ...recordJson,
        mediaPath: item?.absolutePath,
        localPath: item?.localPath,
        absolutePath: item?.absolutePath,
        sceneArg: item ? `${record.timeline_start_ms}|${record.scene_label}|${item.absolutePath}` : undefined,
      };
    }),
  };
}

function formatProductionSceneArgs(records: ProductionRecord[], media: ProductionExportMedia[]): string {
  const mediaByRecordId = new Map(media.map((item) => [item.recordId, item]));
  return records
    .filter((record) => record.media_kind === 'image' || record.media_kind === 'video')
    .map((record) => {
      const item = mediaByRecordId.get(record.id);
      if (!item) return '';
      const sceneArg = `${record.timeline_start_ms}|${record.scene_label}|${item.absolutePath}`;
      return `--scene ${shellQuote(sceneArg)}`;
    })
    .filter(Boolean)
    .join('\n');
}

async function downloadProductionExportMedia(
  records: ProductionRecord[],
  ctx: ProductionsContext,
  deps: Pick<ProductionsDeps, 'downloadFile'>,
  options: {
    productionId: string;
    outputPath?: string;
    mediaDir?: string;
    force: boolean;
  }
): Promise<ProductionExportMedia[]> {
  const visualRecords = records.filter((record) => record.media_kind === 'image' || record.media_kind === 'video');
  if (visualRecords.length === 0) return [];

  const mediaDir = options.mediaDir || defaultProductionMediaDir(options.productionId, options.outputPath);
  const media: ProductionExportMedia[] = [];
  for (let index = 0; index < visualRecords.length; index += 1) {
    const record = visualRecords[index];
    const localPath = path.join(mediaDir, productionMediaFilename(record, index));
    await deps.downloadFile({
      baseUrl: ctx.baseUrl,
      accessToken: ctx.accessToken,
      requestPath: buildVariantMediaPath(ctx, record.variant_id),
      outputPath: localPath,
      force: options.force,
    });
    media.push({
      recordId: record.id,
      localPath,
      absolutePath: path.resolve(localPath),
    });
  }
  return media;
}

function defaultProductionMediaDir(productionId: string, outputPath?: string): string {
  if (outputPath) {
    const parsed = path.parse(outputPath);
    return path.join(parsed.dir, `${parsed.name}.media`);
  }
  return path.join('.inventory', 'productions', slugify(productionId));
}

function productionMediaFilename(record: ProductionRecord, index: number): string {
  const extension = record.media_kind === 'video' ? 'mp4' : 'png';
  const prefix = String(index + 1).padStart(4, '0');
  return `${prefix}-${slugify(record.scene_label)}-${slugify(record.variant_id)}.${extension}`;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'media';
}

function sortProductionRecords(records: ProductionRecord[]): ProductionRecord[] {
  return [...records].sort((a, b) => {
    if (a.timeline_start_ms !== b.timeline_start_ms) return a.timeline_start_ms - b.timeline_start_ms;
    if ((a.shot_id || '') !== (b.shot_id || '')) return (a.shot_id || '').localeCompare(b.shot_id || '');
    return a.created_at - b.created_at;
  });
}

function toRecordJson(record: ProductionRecord, ctx: ProductionsContext): Record<string, unknown> {
  return {
    ...record,
    sourceRefs: parseJsonArray(record.source_refs),
    sourceVariantIds: parseJsonArray(record.source_variant_ids),
    metadata: parseJsonObject(record.metadata),
    mediaUrl: buildVariantMediaUrl(ctx, record.variant_id),
    webUrl: `${ctx.baseUrl}/spaces/${encodeURIComponent(ctx.spaceId)}/assets/${encodeURIComponent(record.asset_id)}`,
  };
}

function buildVariantMediaUrl(ctx: ProductionsContext, variantId: string): string {
  return `${ctx.baseUrl}${buildVariantMediaPath(ctx, variantId)}`;
}

function buildVariantMediaPath(ctx: ProductionsContext, variantId: string): string {
  return `/api/spaces/${encodeURIComponent(ctx.spaceId)}/variants/${encodeURIComponent(variantId)}/media`;
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function printUsage(): void {
  console.log(`
Usage:
  pnpm run cli productions list --production-id <id>
  pnpm run cli productions export --production-id <id> [-o scenes.args] [--media-dir media]
  pnpm run cli productions export --production-id <id> --json [-o scenes.json] [--media-dir media]
  pnpm run cli productions place --production-id <id> --variant <variant_id> --scene-label <label> --timeline-start-ms <ms>
  pnpm run cli productions delete <record-id>
`);
}
