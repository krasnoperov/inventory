import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import { loadProjectConfig, type ProjectConfig } from '../lib/project-config';
import {
  createRemotionRunExport,
  listRunManifests,
  readRunManifest,
  resolveRunManifest,
  type RemotionRunExport,
  type RunManifest,
  type RunManifestRecord,
} from '../lib/run-manifest';
import { truncate } from '../lib/utils';

type RunsResult =
  | { type: 'list'; records: RunManifestRecord[] }
  | { type: 'show'; record: RunManifestRecord }
  | { type: 'export'; outputPath: string; exportData: RemotionRunExport };

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
    throw new Error('Inventory project config not found. Run: pnpm run cli init --space <id>');
  }

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
    const format = parsed.options.format || 'remotion';
    if (format !== 'remotion') {
      throw new Error(`Unsupported run export format: ${format}`);
    }
    const outputPath = parsed.options.o || parsed.options.output;
    if (!outputPath || outputPath === 'true') {
      throw new Error('Output path is required: pass -o <file> or --output <file>');
    }

    const record = await resolveSelectedRun(parsed, deps, projectConfig.projectRoot, 1);
    const exportData = createRemotionRunExport(record, projectConfig.projectRoot);
    await deps.writeFile(outputPath, JSON.stringify(exportData, null, 2) + '\n', 'utf8');
    deps.print(`Wrote ${format} export: ${outputPath}`);
    return { type: 'export', outputPath, exportData };
  }

  throw new Error(`Unknown runs command: ${subcommand}`);
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
  print(`  Manifest: ${record.manifestPath}`);
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
  pnpm run cli runs
  pnpm run cli runs show <run-id|manifest.json>
  pnpm run cli runs show --latest
  pnpm run cli runs export <run-id|manifest.json> --format remotion -o media-run.json
  pnpm run cli runs export --latest --format remotion -o media-run.json
`);
}
