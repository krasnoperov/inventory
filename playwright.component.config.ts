import { defineConfig } from '@playwright/test';

const port = Number.parseInt(process.env.HARNESS_PORT ?? '4175', 10);
const skipWebServer = process.env.SKIP_WEBSERVER === '1';

export default defineConfig({
  testDir: './tests/components',
  testMatch: '**/*.spec.ts',
  timeout: process.env.CI ? 60_000 : 30_000,
  expect: { timeout: 2_000 },
  fullyParallel: true,
  workers: process.env.CI ? 1 : 4,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['dot']] : 'dot',
  webServer: skipWebServer
    ? undefined
    : {
        command: 'pnpm exec vite build --config vite.component-harness.config.ts && exec node ./scripts/component-harness-server.mjs',
        url: `http://127.0.0.1:${port}/component-harness.html`,
        reuseExistingServer: false,
        timeout: 60_000,
      },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  outputDir: 'test-results/components',
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
