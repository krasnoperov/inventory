import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import path from 'node:path';
import { visualizer } from 'rollup-plugin-visualizer';

// Single config for dev and build. The worker runs inside workerd (via
// @cloudflare/vite-plugin) in BOTH modes, so SSR shares the runtime/bindings
// with the API. TanStack Start renders documents and injects per-route CSS
// (<HeadContent/>) at SSR time — no hand-rolled shell, no FOUC.
//
// Dev points the cloudflare plugin at wrangler.dev.toml via
// CLOUDFLARE_VITE_CONFIG_PATH (set in the `dev` script); build uses wrangler.toml.
export default defineConfig({
  plugins: [
    cloudflare({
      configPath: process.env.CLOUDFLARE_VITE_CONFIG_PATH ?? 'wrangler.toml',
      viteEnvironment: { name: 'ssr' },
      persistState: { path: path.resolve(__dirname, '.wrangler/state') },
    }),
    tanstackStart({
      srcDirectory: 'src/frontend',
      router: {
        generatedRouteTree: 'routeTree.gen.ts',
        quoteStyle: 'single',
      },
    }),
    react(),
    visualizer({
      filename: './dist/stats.html',
      open: false,
      gzipSize: true,
      brotliSize: true,
    }),
    visualizer({
      filename: './dist/stats.json',
      json: true,
    }),
  ],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  publicDir: path.resolve(__dirname, 'public'),
  server: {
    host: 'localhost',
    port: 3001,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  environments: {
    // Browser build: keep CSS code-splitting + vendor chunking. TanStack Start
    // injects each matched route's CSS <link> into <head> at SSR time, so the
    // split chunks load before first paint instead of during hydration.
    client: {
      build: {
        rollupOptions: {
          output: {
            manualChunks: (id) => {
              // React core libraries
              if (id.includes('node_modules/react/') ||
                  id.includes('node_modules/react-dom/') ||
                  id.includes('node_modules/scheduler/')) {
                return 'react-vendor';
              }

              // React ecosystem (router, markdown, etc.)
              if (id.includes('node_modules/react-router') ||
                  id.includes('node_modules/react-markdown') ||
                  id.includes('node_modules/@tanstack/react-query') ||
                  id.includes('node_modules/@react-oauth')) {
                return 'react-ecosystem';
              }

              // OpenAI and related libraries
              if (id.includes('node_modules/@openai/') ||
                  id.includes('node_modules/openai/') ||
                  id.includes('node_modules/zod/')) {
                return 'openai';
              }

              // Markdown processing libraries (used by react-markdown)
              if (id.includes('node_modules/unified') ||
                  id.includes('node_modules/remark-') ||
                  id.includes('node_modules/rehype-') ||
                  id.includes('node_modules/mdast-') ||
                  id.includes('node_modules/hast-') ||
                  id.includes('node_modules/micromark') ||
                  id.includes('node_modules/vfile') ||
                  id.includes('node_modules/unist-')) {
                return 'markdown-processor';
              }

              // Other vendor libraries
              if (id.includes('node_modules/')) {
                return 'vendor';
              }
            },
          },
        },
      },
    },
    // Bundle the worker (SSR) into a single file. Code-splitting only benefits
    // the browser; for the worker it forces workerd to lazy-load + compile a
    // chunk per route on first request, which serializes badly under load.
    ssr: {
      build: {
        rollupOptions: {
          output: { inlineDynamicImports: true },
        },
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/frontend-start'),
    emptyOutDir: true,
  },
});
