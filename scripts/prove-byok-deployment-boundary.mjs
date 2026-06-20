#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

const WORKER_CONFIGS = [
  'wrangler.toml',
  'wrangler.generation.toml',
  'wrangler.polar.toml',
  'wrangler.dev.toml',
  'wrangler.key-broker.toml',
];
const CALLER_CONFIGS = ['wrangler.toml', 'wrangler.generation.toml', 'wrangler.polar.toml', 'wrangler.dev.toml'];
const BROKER_CONFIG = 'wrangler.key-broker.toml';
const KEK_BINDINGS = ['BYOK_KEK_V1', 'BYOK_KEK_V2'];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readProjectFile(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function uncommentedText(text) {
  return text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
}

function parseStringAssignments(text) {
  const assignments = new Map();
  let currentTable = '';
  let currentArrayTable = '';

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const arrayMatch = trimmed.match(/^\[\[([^\]]+)]]$/);
    if (arrayMatch) {
      currentArrayTable = arrayMatch[1];
      currentTable = currentArrayTable;
      continue;
    }

    const tableMatch = trimmed.match(/^\[([^\]]+)]$/);
    if (tableMatch) {
      currentTable = tableMatch[1];
      currentArrayTable = '';
      continue;
    }

    const assignmentMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*"([^"]*)"$/);
    if (!assignmentMatch) {
      continue;
    }

    const [, key, value] = assignmentMatch;
    const tableKey = currentArrayTable || currentTable || 'root';
    const scopedKey = `${tableKey}.${key}`;
    const values = assignments.get(scopedKey) ?? [];
    values.push(value);
    assignments.set(scopedKey, values);
  }

  return assignments;
}

function assignmentValues(assignments, table, key) {
  return assignments.get(`${table}.${key}`) ?? [];
}

function requireNoActiveByokKekOutsideBroker() {
  const violations = [];

  for (const file of CALLER_CONFIGS) {
    const active = uncommentedText(readProjectFile(file));
    const forbiddenPattern = /\bBYOK_(?:ACTIVE_KEK_VERSION|KEK_V\d+)\b/;
    active.split('\n').forEach((line, index) => {
      if (forbiddenPattern.test(line)) {
        violations.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    });
  }

  if (violations.length > 0) {
    fail(`BYOK KEK material must not be configured on app/generation/billing/local workers:\n${violations.join('\n')}`);
  }
}

function requireCallerServiceBindings() {
  const expectations = [
    ['wrangler.toml', 'services', 'makefx-key-broker-stage'],
    ['wrangler.toml', 'env.production.services', 'makefx-key-broker-production'],
    ['wrangler.generation.toml', 'services', 'makefx-key-broker-stage'],
    ['wrangler.generation.toml', 'env.production.services', 'makefx-key-broker-production'],
  ];

  const missing = [];
  for (const [file, table, service] of expectations) {
    const assignments = parseStringAssignments(uncommentedText(readProjectFile(file)));
    const bindings = assignmentValues(assignments, table, 'binding');
    const services = assignmentValues(assignments, table, 'service');
    const hasBinding = bindings.includes('KEY_BROKER');
    const hasService = services.includes(service);
    if (!hasBinding || !hasService) {
      missing.push(`${file}: expected [[${table}]] binding KEY_BROKER -> ${service}`);
    }
  }

  if (missing.length > 0) {
    fail(`Missing app/generation service binding to the key broker:\n${missing.join('\n')}`);
  }
}

function requireBrokerConfigBoundary() {
  const active = uncommentedText(readProjectFile(BROKER_CONFIG));
  const assignments = parseStringAssignments(active);
  const topLevelNames = assignmentValues(assignments, 'root', 'name');
  const productionNames = assignmentValues(assignments, 'env.production', 'name');

  if (!topLevelNames.includes('makefx-key-broker-stage')) {
    fail(`${BROKER_CONFIG}: stage worker name must be makefx-key-broker-stage`);
  }
  if (!productionNames.includes('makefx-key-broker-production')) {
    fail(`${BROKER_CONFIG}: production worker name must be makefx-key-broker-production`);
  }
  if (!/^workers_dev\s*=\s*false$/m.test(active)) {
    fail(`${BROKER_CONFIG}: broker must set top-level workers_dev = false`);
  }
  if (!/\[env\.production]\s*\n(?:.*\n)*?workers_dev\s*=\s*false/m.test(active)) {
    fail(`${BROKER_CONFIG}: broker production env must set workers_dev = false`);
  }

  for (const forbidden of ['[[routes]]', '[[env.production.routes]]', 'KEY_BROKER']) {
    if (active.includes(forbidden)) {
      fail(`${BROKER_CONFIG}: broker must not expose public routes or bind to itself (${forbidden})`);
    }
  }
}

function requireBrokerKekTemplates() {
  const text = readProjectFile(BROKER_CONFIG);
  const missing = [];

  for (const binding of KEK_BINDINGS) {
    if (!text.includes(`binding = "${binding}"`) || !text.includes(`secret_name = "${binding}"`)) {
      missing.push(`${BROKER_CONFIG}: missing ${binding} Secrets Store binding template`);
    }
  }

  if (!text.includes('[[env.production.secrets_store_secrets]]')) {
    missing.push(`${BROKER_CONFIG}: missing production Secrets Store binding template`);
  }

  if (missing.length > 0) {
    fail(missing.join('\n'));
  }
}

function requireNormalDeployExcludesBroker() {
  const deploy = readProjectFile('.github/workflows/deploy.yml');
  const forbidden = ['wrangler.key-broker.toml', 'makefx-key-broker', 'CLOUDFLARE_KEY_BROKER_API_TOKEN', 'BYOK_SECRET_STORE_ID'];
  const violations = forbidden.filter((text) => deploy.includes(text));

  if (violations.length > 0) {
    fail(`Normal deploy workflow must not deploy or credential the key broker: ${violations.join(', ')}`);
  }
}

function requireBrokerDeployUsesSeparateToken() {
  const workflow = readProjectFile('.github/workflows/deploy-key-broker.yml');
  if (workflow.includes('github.event.inputs.ref')) {
    fail('Broker deploy workflow must not accept or checkout dispatcher-provided refs');
  }
  if (!workflow.includes("if: github.ref == 'refs/heads/main'")) {
    fail('Broker deploy workflow must run only from the main branch');
  }
  if (!workflow.includes('ref: refs/heads/main')) {
    fail('Broker deploy workflow must checkout reviewed main branch code');
  }
  if (!workflow.includes('CLOUDFLARE_KEY_BROKER_API_TOKEN')) {
    fail('Broker deploy workflow must use CLOUDFLARE_KEY_BROKER_API_TOKEN');
  }
  if (workflow.includes('secrets.CLOUDFLARE_API_TOKEN')) {
    fail('Broker deploy workflow must not use the normal CLOUDFLARE_API_TOKEN');
  }
  if (!workflow.includes('BYOK_SECRET_STORE_ID')) {
    fail('Broker deploy workflow must require BYOK_SECRET_STORE_ID from the protected environment');
  }
}

function materializedSecretsStoreBlocks(tablePrefix) {
  const storeId = process.env.BYOK_SECRET_STORE_ID;
  if (!storeId) {
    fail('BYOK_SECRET_STORE_ID is required when materializing a broker deploy config');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(storeId)) {
    fail('BYOK_SECRET_STORE_ID must contain only letters, numbers, underscores, or dashes');
  }

  return KEK_BINDINGS
    .map(
      (binding) => `[[${tablePrefix}secrets_store_secrets]]
binding = "${binding}"
store_id = "${storeId}"
secret_name = "${binding}"`,
    )
    .join('\n\n');
}

function tomlPath(path) {
  return path.split(sep).join('/');
}

function rewritePathsForOutput(text, outPath) {
  const outDir = dirname(resolve(process.cwd(), outPath));
  const workerMain = tomlPath(relative(outDir, resolve(process.cwd(), 'src/worker/key-broker.ts')));
  const migrationsDir = tomlPath(relative(outDir, resolve(process.cwd(), 'db/migrations')));

  return text
    .replace(/^main = "src\/worker\/key-broker\.ts"$/m, `main = "${workerMain}"`)
    .replaceAll('migrations_dir = "db/migrations"', `migrations_dir = "${migrationsDir}"`);
}

function insertAfter(text, marker, insertion) {
  const index = text.indexOf(marker);
  if (index === -1) {
    fail(`Cannot materialize broker config: marker not found: ${marker}`);
  }
  const end = index + marker.length;
  return `${text.slice(0, end)}\n\n${insertion}${text.slice(end)}`;
}

function stripCommentedSecretStoreTemplates(text) {
  return text
    .replace(
      /\n# Secrets Store bindings materialized for stage broker deploys:[\s\S]*?(?=\n\[env\.production])/,
      '\n',
    )
    .replace(
      /\n# Secrets Store bindings materialized for production broker deploys:[\s\S]*$/,
      '\n',
    );
}

function materializeBrokerConfig(environment, outPath) {
  if (!['stage', 'production'].includes(environment)) {
    fail('Broker config materialization requires environment "stage" or "production"');
  }
  if (!outPath) {
    fail('Broker config materialization requires --out <path>');
  }

  let text = stripCommentedSecretStoreTemplates(readProjectFile(BROKER_CONFIG));
  if (environment === 'stage') {
    text = insertAfter(text, 'BYOK_ACTIVE_KEK_VERSION = "1"', materializedSecretsStoreBlocks(''));
  } else {
    text = insertAfter(
      text,
      '[env.production.vars]\nNODE_ENV = "production"\nENVIRONMENT = "production"\nBYOK_ACTIVE_KEK_VERSION = "1"',
      materializedSecretsStoreBlocks('env.production.'),
    );
  }

  const absoluteOut = resolve(process.cwd(), outPath);
  mkdirSync(dirname(absoluteOut), { recursive: true });
  writeFileSync(absoluteOut, rewritePathsForOutput(text, outPath));
  console.log(`Wrote ${outPath}`);
}

function proveBoundary() {
  for (const file of WORKER_CONFIGS) {
    readProjectFile(file);
  }

  requireNoActiveByokKekOutsideBroker();
  requireCallerServiceBindings();
  requireBrokerConfigBoundary();
  requireBrokerKekTemplates();
  requireNormalDeployExcludesBroker();
  requireBrokerDeployUsesSeparateToken();

  console.log('BYOK deployment boundary proof passed.');
  console.log('- app/generation/billing/local configs have no active BYOK_KEK_* bindings');
  console.log('- app/generation configs bind KEY_BROKER to the broker worker');
  console.log('- broker config is route-less, workers_dev=false, and contains KEK Secrets Store templates');
  console.log('- normal deploy workflow excludes broker deployment and broker credentials');
  console.log('- broker deploy workflow uses separate broker credentials and reviewed main branch code');
}

const args = process.argv.slice(2);
const materializeIndex = args.indexOf('--materialize-broker-config');
if (materializeIndex !== -1) {
  const environment = args[materializeIndex + 1];
  const outIndex = args.indexOf('--out');
  materializeBrokerConfig(environment, outIndex === -1 ? '' : args[outIndex + 1]);
} else {
  proveBoundary();
}
