import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

export default defineConfig({
  root: path.resolve(__dirname, 'src/frontend'),
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/component-harness'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1700,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/frontend/component-harness.html'),
    },
  },
  preview: {
    port: 4175,
    strictPort: true,
  },
});
