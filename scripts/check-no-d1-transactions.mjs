#!/usr/bin/env node
/**
 * Cloudflare D1 does not support interactive transactions. Tests can pass on
 * better-sqlite3 while production fails when kysely-d1 sees `.transaction()`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src/backend', 'src/dao'];
const CALL = /\.\s*transaction\s*\(/;
const STRIP_LINE_COMMENT = /\/\/.*$/;

function collect(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }

  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      collect(full, out);
    } else if (
      (full.endsWith('.ts') || full.endsWith('.tsx')) &&
      !full.endsWith('.test.ts') &&
      !full.endsWith('.test.tsx')
    ) {
      out.push(full);
    }
  }

  return out;
}

const violations = [];
for (const root of ROOTS) {
  for (const file of collect(root, [])) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (CALL.test(line.replace(STRIP_LINE_COMMENT, ''))) {
        violations.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    });
  }
}

if (violations.length > 0) {
  console.error(
    'D1 does not support interactive transactions. Use per-statement atomicity, ' +
      'idempotency keys, or env.DB.batch() for multi-statement flows.\n',
  );
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  process.exit(1);
}
