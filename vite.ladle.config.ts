import { defineConfig } from 'vite';
import path from 'node:path';

// Extra Vite config Ladle merges on top of its own (Ladle injects the React
// plugin itself, so we don't add it here). postcss.config.js at the repo root
// is auto-discovered, so light-dark() and the oklch tokens compile as in the
// app. The root vite.config.ts skips its Cloudflare/Start plugins under LADLE.
const __dirname = path.dirname(new URL(import.meta.url).pathname);

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
