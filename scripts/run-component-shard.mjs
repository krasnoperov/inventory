#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const shard = process.argv[2];
const passthroughArgs = process.argv.slice(3);

if (!shard) {
  console.error('Usage: node ./scripts/run-component-shard.mjs <shard> or <shard>/<total>');
  process.exit(1);
}

function readShardFile(shardName) {
  const shardFile = resolve(process.cwd(), 'tests/components/shards', `${shardName}.txt`);
  return readFileSync(shardFile, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function countTests(file) {
  const source = readFileSync(resolve(process.cwd(), file), 'utf8');
  return (
    source.match(/\btest(?:\.(?:only|skip|fixme))?\s*\(/g)?.length ??
    source.match(/\btest\.describe\s*\(/g)?.length ??
    1
  );
}

function componentSpecFiles(dir = resolve(process.cwd(), 'tests/components')) {
  const files = [];

  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...componentSpecFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
      files.push(relative(process.cwd(), path));
    }
  }

  return files;
}

function balancedShardFiles(index, total) {
  const groups = Array.from({ length: total }, () => ({ weight: 0, files: [] }));
  const weightedFiles = componentSpecFiles()
    .map((file) => ({ file, weight: countTests(file) }))
    .sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file));

  for (const item of weightedFiles) {
    groups.sort((a, b) => a.weight - b.weight || a.files.length - b.files.length);
    groups[0].files.push(item.file);
    groups[0].weight += item.weight;
  }

  return groups[index - 1]?.files ?? [];
}

function filesForShard(shardName) {
  const dynamicShard = shardName.match(/^(\d+)\/(\d+)$/);
  if (!dynamicShard) {
    return readShardFile(shardName);
  }

  const index = Number.parseInt(dynamicShard[1], 10);
  const total = Number.parseInt(dynamicShard[2], 10);
  if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || total < 1 || index > total) {
    console.error(`Invalid component shard: ${shardName}`);
    process.exit(1);
  }

  return balancedShardFiles(index, total);
}

const files = filesForShard(shard);

if (files.length === 0) {
  console.log(`Component shard ${shard}: 0 files`);
  process.exit(shard.includes('/') ? 0 : 1);
}

console.log(`Component shard ${shard}: ${files.length} files`);

const result = spawnSync(
  'pnpm',
  ['exec', 'playwright', 'test', '--config', 'playwright.component.config.ts', ...files, ...passthroughArgs],
  { stdio: 'inherit' },
);

process.exit(result.status ?? 1);
