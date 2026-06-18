#!/usr/bin/env node
// Exchange a stored Make Effects CLI login token for a short-lived web session
// token, then format it for Playwright or shell tools (curl).

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import os from 'node:os';

const DEFAULT_ENV = 'production';
const COOKIE_NAME = 'auth_token';
const CLI_CONFIG_DIR = 'makefx-cli';
const ENV_ORIGIN = {
  production: 'https://makefx.app',
  stage: 'https://makefx-stage.krasnoperov.me',
  staging: 'https://makefx-stage.krasnoperov.me',
  local: 'http://localhost:3001',
};

function parseArgs(argv) {
  const opts = { env: DEFAULT_ENV, format: 'storage', token: null, baseUrl: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value == null) throw new Error(`${arg} needs a value`);
      return value;
    };
    if (arg === '--env' || arg === '-e') opts.env = next();
    else if (arg === '--token' || arg === '-t') opts.token = next();
    else if (arg === '--format' || arg === '-f') opts.format = next();
    else if (arg === '--base-url' || arg === '-b') opts.baseUrl = next();
    else if (arg === '--out' || arg === '-o') opts.out = next();
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

const HELP = `mint-session - exchange CLI auth for a short-lived Playwright/curl session

Usage:
  pnpm auth:session-state --env <env> [options]

Options:
  -e, --env <env>        production | stage | local  (default: production)
  -t, --token <jwt>      Use this CLI bearer JWT directly instead of stored login
  -f, --format <fmt>     storage | env | cookie | jwt  (default: storage)
                           storage -> Playwright storageState JSON
                           env     -> INVENTORY_SESSION_COOKIE=auth_token=<short-lived-jwt>
                           cookie  -> "auth_token=<short-lived-jwt>"
                           jwt     -> raw short-lived JWT
  -b, --base-url <url>   App origin (default per --env or stored CLI login)
  -o, --out <file>       Write to a file instead of stdout
  -h, --help             Show this help

Get CLI auth first:
  pnpm cli login --env stage

Local shortcut (no login required): the dev-auth bypass token works directly,
e.g. AUDIT_AUTH_TOKEN=inventory-dev-token for the audit spec.`;

function originForEnv(env) {
  const origin = ENV_ORIGIN[env];
  if (!origin) throw new Error(`Unknown --env "${env}". Valid: production, stage, local`);
  return origin;
}

function cliLoginCommand(env) {
  return env === 'local' ? 'pnpm cli login --local' : `pnpm cli login --env ${env}`;
}

function isLocalOrigin(baseUrl) {
  try {
    const hostname = new URL(baseUrl).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function enableLocalTlsBypass(env, baseUrl) {
  if (env === 'local' || isLocalOrigin(baseUrl)) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }
}

function tokenFromCliConfig(env) {
  const base = process.env.XDG_CONFIG_HOME || join(os.homedir(), '.config');
  const configPath = join(base, CLI_CONFIG_DIR, 'config.json');
  let data;
  try {
    data = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`No CLI credentials at ${configPath}. Run: ${cliLoginCommand(env)}`);
    }
    throw error;
  }
  const cfg = data.configs?.[env] ?? (data.environment === env ? data : null);
  const token = cfg?.token?.accessToken;
  if (!token) throw new Error(`No stored token for env "${env}". Run: ${cliLoginCommand(env)}`);
  if (cfg?.token?.expiresAt && cfg.token.expiresAt <= Date.now()) {
    throw new Error(`Stored token for "${env}" is expired. Run: ${cliLoginCommand(env)}`);
  }
  return { token, baseUrl: cfg.baseUrl ?? null };
}

async function exchangeSessionState(baseUrl, bearerToken) {
  const response = await fetch(new URL('/api/auth/session-state', baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Session-state exchange failed (${response.status}): ${await response.text()}`);
  }
  const body = await response.json();
  if (!body || typeof body.token !== 'string') {
    throw new Error('Session-state exchange response did not include token');
  }
  return {
    token: body.token,
    cookieName: typeof body.cookieName === 'string' ? body.cookieName : COOKIE_NAME,
    expiresIn: typeof body.expiresIn === 'number' ? body.expiresIn : null,
  };
}

function storageState(cookieName, jwt, baseUrl) {
  const url = new URL(baseUrl);
  return {
    cookies: [
      {
        name: cookieName,
        value: jwt,
        domain: url.hostname,
        path: '/',
        httpOnly: true,
        secure: url.protocol === 'https:',
        sameSite: 'Lax',
      },
    ],
    origins: [],
  };
}

async function resolveCliAccess(opts) {
  if (opts.token) return { token: opts.token, baseUrl: null };
  if (process.env.INVENTORY_SESSION_TOKEN) {
    return { token: process.env.INVENTORY_SESSION_TOKEN, baseUrl: null };
  }
  return tokenFromCliConfig(opts.env);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }

  const cli = await resolveCliAccess(opts);
  const baseUrl = opts.baseUrl ?? cli.baseUrl ?? originForEnv(opts.env);
  enableLocalTlsBypass(opts.env, baseUrl);
  const session = await exchangeSessionState(baseUrl, cli.token);

  let output;
  switch (opts.format) {
    case 'storage':
      output = JSON.stringify(storageState(session.cookieName, session.token, baseUrl), null, 2);
      break;
    case 'env':
      output = `INVENTORY_SESSION_COOKIE=${session.cookieName}=${session.token}`;
      break;
    case 'cookie':
      output = `${session.cookieName}=${session.token}`;
      break;
    case 'jwt':
      output = session.token;
      break;
    default:
      throw new Error(`Unknown --format: ${opts.format} (expected storage | env | cookie | jwt)`);
  }

  if (opts.out) {
    mkdirSync(dirname(opts.out), { recursive: true, mode: 0o700 });
    writeFileSync(opts.out, output.endsWith('\n') ? output : `${output}\n`, { mode: 0o600 });
    chmodSync(opts.out, 0o600);
    const ttl = session.expiresIn == null ? '' : `, expires in ${session.expiresIn}s`;
    process.stderr.write(`Wrote ${opts.format} (${opts.env}, ${new URL(baseUrl).hostname}${ttl}) -> ${opts.out} (mode 600)\n`);
  } else {
    process.stdout.write(`${output}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`mint-session: ${error.message}\n`);
  process.exit(1);
});
