import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { resolve } from 'path';
import { serviceWorkerPlugin } from './scripts/vite-plugin-service-worker';

const repoRoot = resolve(__dirname, '../..');

/**
 * Pages that are documents and not the app: `<name>.html` beside
 * index.html, served by Pages at `/<name>`. They are plain HTML with no
 * script, and the service worker leaves them to the network.
 */
const DOCUMENT_PAGES = ['privacy', 'terms'];

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
  plugins: [react(), wasm(), topLevelAwait(), serviceWorkerPlugin({ documentPages: DOCUMENT_PAGES })],
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
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        ...Object.fromEntries(DOCUMENT_PAGES.map((name) => [name, resolve(__dirname, `${name}.html`)])),
      },
    },
  },
});
