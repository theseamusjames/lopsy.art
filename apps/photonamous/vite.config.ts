import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { resolve } from 'path';
import { serviceWorkerPlugin } from './scripts/vite-plugin-service-worker';

const repoRoot = resolve(__dirname, '../..');

/**
 * Photonamous, served at `/` on its own origin (photonamous.com in
 * production, docs/photonamous-spec.md 6.3).
 *
 * The engine is the wasm package `npm run wasm:build` writes into
 * lopsy-web (`@lopsy/engine-pkg`). Moving it to packages/engine-web is
 * Phase 0 work in docs/photonamous-spec.md; until then this app reads it
 * from there.
 */
export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait(), serviceWorkerPlugin()],
  worker: {
    format: 'es',
    plugins: () => [wasm(), topLevelAwait()],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@lopsy/engine-pkg': resolve(repoRoot, 'apps/lopsy-web/src/engine-wasm/pkg'),
    },
  },
  server: {
    port: 5174,
    fs: { allow: [repoRoot] },
  },
  preview: {
    port: 4174,
  },
  css: {
    modules: {
      localsConvention: 'camelCaseOnly',
    },
  },
  build: {
    chunkSizeWarningLimit: 750,
  },
});
