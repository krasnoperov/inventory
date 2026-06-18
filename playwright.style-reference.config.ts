import { defineConfig } from '@playwright/test';

// Drives the built Ladle catalog (build/ladle) via `ladle preview` and captures
// every story across viewport × color-scheme. Run through
// `pnpm style-reference`, which builds the catalog first.
const LADLE_PORT = Number(process.env.STYLE_REFERENCE_LADLE_PORT ?? 61100);

export default defineConfig({
  testDir: './tests/components',
  testMatch: 'style-reference.spec.ts',
  timeout: 300_000,
  retries: 0,
  workers: 1,
  reporter: 'dot',
  outputDir: './test-results/style-reference',
  use: {
    baseURL: `http://127.0.0.1:${LADLE_PORT}`,
    headless: true,
  },
  webServer: {
    command: `LADLE=true pnpm exec ladle preview --outDir build/ladle --port ${LADLE_PORT} --host 127.0.0.1`,
    url: `http://127.0.0.1:${LADLE_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
