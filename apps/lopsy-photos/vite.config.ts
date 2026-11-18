import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { resolve } from 'path';
import { serviceWorkerPlugin } from './scripts/vite-plugin-service-worker';

const repoRoot = resolve(__dirname, '../..');

/**
 * Lopsy Photos. Served at `/` in development and at PHOTOS_BASE in a
 * build (`/photos/` when it ships inside lopsy.art; `/` on its own domain).
 *
 * The engine is the wasm package `npm run wasm:build` writes into
 * lopsy-web (`@lopsy/engine-pkg`). Moving it to packages/engine-web is
 * Phase 0 work in docs/lopsy-photos-spec.md; until then this app reads it
 * from there.
 */
/** `photos`, `/photos` and `/photos/` all mean `/photos/`: Vite needs both slashes for asset URLs. */
function photosBase(value: string | undefined): string {
  const trimmed = value?.trim().replace(/^\/+|\/+$/g, '') ?? '';
  return trimmed === '' ? '/' : `/${trimmed}/`;
}

export default defineConfig({
  base: photosBase(process.env.PHOTOS_BASE),
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
