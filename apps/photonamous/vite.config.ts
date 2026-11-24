import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { serviceWorkerPlugin } from './scripts/vite-plugin-service-worker';
import { rendererPlugin } from '../lopsy-web/scripts/vite-plugin-renderer';
import { parseRenderer } from '../lopsy-web/src/engine-wasm/renderer-choice';

const repoRoot = resolve(__dirname, '../..');
const engineWasm = resolve(repoRoot, 'apps/lopsy-web/src/engine-wasm');
/** The engine's glue as the app imports it, and as the alias below has resolved it by the time the plugin sees it. */
const ENGINE_IMPORTS = ['@lopsy/engine-pkg/lopsy_wasm', resolve(engineWasm, 'pkg/lopsy_wasm').replace(/\\/g, '/')];

/**
 * Which build of the engine a page load runs (src/engine/renderer-choice.ts):
 * `?renderer=`, else PHOTONAMOUS_RENDERER (`wgpu` or `webgl`) as the dev
 * server or build was started with, else WebGPU. Every import of the
 * engine's glue in the page goes through Lopsy's selector; the RAF workers
 * are built without it and load the build the page tells them to
 * (raf-decode.ts).
 */
const renderer = rendererPlugin({
  root: engineWasm,
  isEngineImport: (source, importer) => ENGINE_IMPORTS.includes(source.replace(/\\/g, '/')) && !importer.includes('/node_modules/'),
  webglGlue: 'pkg/lopsy_wasm.js',
  wgpuGlue: 'pkg-wgpu/lopsy_wasm.js',
  choice: resolve(__dirname, 'src/engine/renderer-choice.ts'),
  defaultRenderer: parseRenderer(process.env.PHOTONAMOUS_RENDERER) ?? 'wgpu',
  fallsBackInPage: true,
});

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
  plugins: [renderer, react(), wasm(), topLevelAwait(), serviceWorkerPlugin({ documentPages: DOCUMENT_PAGES })],
  worker: {
    format: 'es',
    plugins: () => [wasm(), topLevelAwait()],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // Without the wgpu build the page never runs it, and its imports (the RAF workers') resolve to the WebGL build's files.
      '@lopsy/engine-pkg-wgpu': resolve(engineWasm, existsSync(resolve(engineWasm, 'pkg-wgpu/lopsy_wasm.js')) ? 'pkg-wgpu' : 'pkg'),
      '@lopsy/engine-pkg': resolve(engineWasm, 'pkg'),
      // The parts of Lopsy's engine bridge both apps use: choosing a build, reading back in order.
      '@lopsy/engine-wasm': engineWasm,
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
