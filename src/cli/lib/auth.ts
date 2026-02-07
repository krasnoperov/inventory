import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';
import type { StoredConfig } from './types';

export const DEFAULT_CLIENT_ID = 'forgetray-cli';
export const DEFAULT_REDIRECT_PORT = 8765;
export const AUTH_SCOPES = 'openid profile email';

/**
 * Detect how the CLI was invoked and return the appropriate command string.
 * Examples:
 * - "npm run cli" when run via package.json script
 * - "npx inventory-cli" when run via npx
 * - "inventory-cli" when installed globally
 */
function detectCliCommand(): string {
  const argv = process.argv;

  // Check if run via npm/yarn run
  if (argv[1]?.includes('npm') || process.env.npm_lifecycle_event) {
    return 'npm run cli';
  }

  // Check if run via npx
  if (argv[0]?.includes('npx') || process.env.npm_execpath?.includes('npx')) {
    return 'npx inventory-cli';
  }

  // Check if run as a global binary
  if (argv[1]?.includes('inventory-cli')) {
    return 'inventory-cli';
  }

  // Fallback
  return 'npm run cli';
}

export const CLI_COMMAND = detectCliCommand();

export async function fetchOidcConfiguration(baseUrl: string, insecure = false): Promise<Record<string, unknown>> {
  const fetchOptions: RequestInit = {
    headers: {
      'accept': 'application/json',
    },
  };

  // For local dev with self-signed certificates
  if (insecure) {
    (fetchOptions as any).rejectUnauthorized = false;
  }

  const response = await fetch(`${baseUrl}/.well-known/openid-configuration`, fetchOptions);

  if (!response.ok) {
    throw new Error(`Failed to load OIDC configuration (${response.status})`);
  }

  return response.json() as Promise<Record<string, unknown>>;
}

export async function exchangeCodeForToken(input: {
  baseUrl: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
}) {
  const response = await fetch(`${input.baseUrl}/api/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${errorText}`);
  }

  return response.json() as Promise<{
    access_token: string;
    expires_in: number;
    scope?: string;
    token_type: string;
    user?: unknown;
  }>;
}

export function generateCodeVerifier(): string {
  return base64UrlEncode(randomBytes(32));
}

export async function generateCodeChallenge(codeVerifier: string): Promise<string> {
  const hash = createHash('sha256').update(codeVerifier).digest();
  return base64UrlEncode(hash);
}

export function generateState(): string {
  return base64UrlEncode(randomBytes(16));
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export async function waitForAuthorizationCode(port: number, expectedState: string): Promise<{ code: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(getErrorPage('invalid_request', 'Invalid request'));
        return;
      }

      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end(getErrorPage('not_found', 'Page not found'));
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const errorDescription = url.searchParams.get('error_description');

      // Handle OAuth error response
      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(getErrorPage(error, errorDescription || undefined));
        clearTimeout(timeout);
        server.close();
        reject(new Error(`OAuth error: ${error}${errorDescription ? ` - ${errorDescription}` : ''}`));
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(getErrorPage('invalid_request', 'Missing authorization code'));
        clearTimeout(timeout);
        server.close();
        reject(new Error('Missing authorization code'));
        return;
      }

      if (state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(getErrorPage('invalid_request', 'State parameter mismatch - possible CSRF attack'));
        clearTimeout(timeout);
        server.close();
        reject(new Error('State mismatch'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getSuccessPage());

      clearTimeout(timeout);
      server.close();
      resolve({ code });
    });

    server.listen(port, '127.0.0.1');

    server.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start local callback server: ${(error as Error).message}`));
    });

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('Login timed out waiting for authorization response'));
    }, 5 * 60 * 1000);
  });
}

function getSuccessPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login Successful - Inventory CLI</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f5f5f7; font-family: system-ui, -apple-system, sans-serif; padding: 2rem 1rem; color: #1a1a2e; }
    @media (prefers-color-scheme: dark) { body { background: #1a1a2e; color: #e8e8f0; } }
    .card { background: #fff; border: 1px solid #ddd; border-radius: 16px; padding: 2.25rem 2.5rem; max-width: 440px; width: 100%; box-shadow: 0 24px 40px rgba(0,0,0,0.1); text-align: center; }
    @media (prefers-color-scheme: dark) { .card { background: #2a2a3e; border-color: #3a3a4e; } }
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.75rem; }
    p { font-size: 1rem; color: #666; line-height: 1.5; }
    @media (prefers-color-scheme: dark) { p { color: #aaa; } }
    .success-icon { width: 64px; height: 64px; margin: 0 auto 1.25rem; border-radius: 50%; background: #f0fdf4; display: flex; align-items: center; justify-content: center; }
    @media (prefers-color-scheme: dark) { .success-icon { background: #1a3a2a; } }
    .success-icon svg { width: 32px; height: 32px; stroke: #22c55e; stroke-width: 3; fill: none; stroke-linecap: round; stroke-linejoin: round; }
  </style>
</head>
<body>
  <div class="card">
    <div class="success-icon">
      <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
    </div>
    <h1>Login Successful</h1>
    <p>You can close this window and return to the terminal.</p>
  </div>
</body>
</html>`;
}

function getErrorPage(error: string, description?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login Failed - Inventory CLI</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f5f5f7; font-family: system-ui, -apple-system, sans-serif; padding: 2rem 1rem; color: #1a1a2e; }
    @media (prefers-color-scheme: dark) { body { background: #1a1a2e; color: #e8e8f0; } }
    .card { background: #fff; border: 1px solid #ddd; border-radius: 16px; padding: 2.25rem 2.5rem; max-width: 440px; width: 100%; box-shadow: 0 24px 40px rgba(0,0,0,0.1); text-align: center; }
    @media (prefers-color-scheme: dark) { .card { background: #2a2a3e; border-color: #3a3a4e; } }
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 1rem; }
    .error-box { background: #fef2f2; border: 1px solid #f87171; border-radius: 8px; padding: 1rem 1.25rem; color: #b91c1c; line-height: 1.5; text-align: left; }
    @media (prefers-color-scheme: dark) { .error-box { background: #3b1c1c; border-color: #dc2626; color: #fca5a5; } }
    .hint { margin-top: 1rem; font-size: 0.875rem; color: #888; }
    .code { margin-top: 0.5rem; font-size: 0.8rem; color: #aaa; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Login Failed</h1>
    <div class="error-box">${description || 'Authorization was denied or failed.'}</div>
    <p class="hint">Please return to the terminal and try again.</p>
    <p class="code">${error}</p>
  </div>
</body>
</html>`;
}

export async function openBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    let command: string;
    let args: string[];

    if (platform === 'darwin') {
      command = 'open';
      args = [url];
    } else if (platform === 'win32') {
      command = 'cmd';
      args = ['/c', 'start', '""', url];
    } else {
      command = 'xdg-open';
      args = [url];
    }

    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', (error) => reject(error));
    child.on('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
