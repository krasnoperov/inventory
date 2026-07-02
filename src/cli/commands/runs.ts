import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import { loadProjectConfig, type ProjectConfig } from '../lib/project-config';
import {
  createMediaRunExport,
  createRemotionRunExport,
  listRunManifests,
  readRunManifest,
  resolveRunManifest,
  type MediaRunExport,
  type RemotionRunExport,
  type RunManifest,
  type RunManifestRecord,
} from '../lib/run-manifest';
import { truncate } from '../lib/utils';

type RunsResult =
  | { type: 'list'; records: RunManifestRecord[] }
  | { type: 'show'; record: RunManifestRecord }
  | { type: 'export'; outputPath: string; format: RunExportFormat; exportData: MediaRunExport | RemotionRunExport };

type RunExportFormat = 'media' | 'remotion';

interface RunsDeps {
  loadProjectConfig: () => Promise<ProjectConfig | null>;
  listRunManifests: typeof listRunManifests;
  readRunManifest: typeof readRunManifest;
  resolveRunManifest: typeof resolveRunManifest;
  writeFile: typeof writeFile;
  print: (message: string) => void;
}

const defaultDeps: RunsDeps = {
  loadProjectConfig,
  listRunManifests,
  readRunManifest,
  resolveRunManifest,
  writeFile,
  print: console.log,
};

export async function handleRuns(parsed: ParsedArgs): Promise<void> {
  try {
    await executeRuns(parsed);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    printUsage();
    process.exitCode = 1;
  }
}

export async function executeRuns(
  parsed: ParsedArgs,
  deps: RunsDeps = defaultDeps
): Promise<RunsResult> {
  const projectConfig = await deps.loadProjectConfig();
  if (!projectConfig?.projectRoot) {
    throw new Error('Make Effects project config not found. Run: makefx init --space <id>');
  }

  requireDebugAcknowledgement(parsed);

  const subcommand = parsed.positionals[0] || 'list';
  if (subcommand === 'list') {
    const records = await deps.listRunManifests(projectConfig.projectRoot);
    if (parsed.options.json === 'true') {
      deps.print(JSON.stringify(records.map(toListJson), null, 2));
    } else {
      printRunList(records, deps.print);
    }
    return { type: 'list', records };
  }

  if (subcommand === 'show') {
    const record = await resolveSelectedRun(parsed, deps, projectConfig.projectRoot, 1);
    if (parsed.options.json === 'true') {
      deps.print(JSON.stringify(record.manifest, null, 2));
    } else {
      printRunDetails(record, deps.print);
    }
    return { type: 'show', record };
  }

  if (subcommand === 'export') {
    const format = parseRunExportFormat(parsed.options.format || 'media');
    const outputPath = parsed.options.o || parsed.options.output;
    if (!outputPath || outputPath === 'true') {
      throw new Error('Output path is required: pass -o <file> or --output <file>');
    }

    const record = await resolveSelectedRun(parsed, deps, projectConfig.projectRoot, 1);
    const exportData = format === 'media'
      ? createMediaRunExport(record, projectConfig.projectRoot)
      : createRemotionRunExport(record, projectConfig.projectRoot);
    await deps.writeFile(outputPath, JSON.stringify(exportData, null, 2) + '\n', 'utf8');
    deps.print(`Wrote ${format} export: ${outputPath}`);
    return { type: 'export', outputPath, format, exportData };
  }

  throw new Error(`Unknown runs command: ${subcommand}`);
}

function requireDebugAcknowledgement(parsed: ParsedArgs): void {
  if (parsed.options.debug === 'true') return;
  throw new Error('Local run manifests are debug-only artifacts and are not a source of truth. Pass --debug to inspect them, or use website-backed assets.');
}

function parseRunExportFormat(value: string): RunExportFormat {
  if (value === 'media' || value === 'remotion') return value;
  if (value === 'remotion-scenes') {
    throw new Error('Local run manifests are debug-only artifacts. Export media or JSON from the asset/variant workflow instead.');
  }
  throw new Error(`Unsupported run export format: ${value}`);
}

async function resolveSelectedRun(
  parsed: ParsedArgs,
  deps: Pick<RunsDeps, 'resolveRunManifest'>,
  projectRoot: string,
  selectorIndex: number
): Promise<RunManifestRecord> {
  return deps.resolveRunManifest({
    projectRoot,
    runIdOrPath: parsed.positionals[selectorIndex],
    latest: parsed.options.latest === 'true',
  });
}

function printRunList(records: RunManifestRecord[], print: (message: string) => void): void {
  if (records.length === 0) {
    print('No run manifests found.');
    return;
  }

  print(`Found ${records.length} run(s):\n`);
  print('Created'.padEnd(21) + 'Status'.padEnd(8) + 'Media'.padEnd(8) + 'Failed'.padEnd(8) + 'Run'.padEnd(30) + 'Name');
  print('-'.repeat(96));
  for (const record of records) {
    print(
      formatCreated(record.manifest.createdAt).padEnd(21) +
      formatStatus(record.manifest).padEnd(8) +
      String(record.manifest.media.length).padEnd(8) +
      String(record.manifest.failed.length).padEnd(8) +
      record.manifest.runId.padEnd(30) +
      truncate(record.manifest.name, 28)
    );
  }
}

function printRunDetails(record: RunManifestRecord, print: (message: string) => void): void {
  const manifest = record.manifest;
  print(`\nRun ${manifest.runId}\n`);
  print(`  Status:   ${formatStatus(manifest)}`);
  print(`  Created:  ${manifest.createdAt}`);
  print(`  Debug manifest: ${record.manifestPath}`);
  print(`  Space:    ${manifest.spaceId}`);
  print(`  Name:     ${manifest.name}`);
  print(`  Type:     ${manifest.assetType}`);
  print(`  Media:    ${manifest.media.length} ${manifest.mediaKind}`);
  if (manifest.images.length > 0) {
    print(`  Images:   ${manifest.images.length}`);
  }
  print(`  Failed:   ${manifest.failed.length}`);
  print(`  Prompt:   ${manifest.prompt}`);

  if (manifest.media.length > 0) {
    print('\nMedia:');
    for (const media of [...manifest.media].sort((a, b) => a.index - b.index)) {
      print(`  ${String(media.index + 1).padStart(2, '0')}. ${media.localPath}`);
      print(`      Kind:    ${media.mediaKind}`);
      print(`      Variant: ${media.variantId}`);
      print(`      Web:     ${media.webUrl}`);
    }
  }

  if (manifest.failed.length > 0) {
    print('\nFailures:');
    for (const failure of manifest.failed) {
      print(`  ${failure.variantId}: ${failure.error}`);
    }
  }
}

function toListJson(record: RunManifestRecord): Record<string, unknown> {
  return {
    runId: record.manifest.runId,
    manifestPath: record.manifestPath,
    createdAt: record.manifest.createdAt,
    completedAt: record.manifest.completedAt,
    command: record.manifest.command,
    mediaKind: record.manifest.mediaKind,
    success: record.manifest.success,
    mediaCount: record.manifest.media.length,
    imageCount: record.manifest.images.length,
    failedCount: record.manifest.failed.length,
    name: record.manifest.name,
    prompt: record.manifest.prompt,
    spaceId: record.manifest.spaceId,
  };
}

function formatStatus(manifest: RunManifest): string {
  return manifest.success ? 'OK' : 'FAILED';
}

function formatCreated(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return value.replace('T', ' ').replace(/\.\d{3}Z$/, 'Z').slice(0, 20);
}

function printUsage(): void {
  console.log(`
Usage:
  makefx runs --debug
  makefx runs show <run-id|manifest.json> --debug
  makefx runs show --latest --debug
  makefx runs export <run-id|manifest.json> --debug --format media -o media-run.json
  makefx runs export --latest --debug --format media -o media-run.json
  makefx runs export --latest --debug --format remotion -o keyframes.json

Local run manifests are debug-only artifacts, not a source of truth.
`);
}
