/**
 * Which build of the engine this page load runs, for Photonamous. The
 * mechanism is Lopsy's (apps/lopsy-web/scripts/vite-plugin-renderer.ts and
 * its renderer-choice.ts); this is the choice module the plugin is pointed
 * at here (vite.config.ts), with Photonamous' rules:
 *
 * - `?renderer=wgpu|webgl` in the URL, for tests and support; else the
 *   default the dev server or build was made with (PHOTONAMOUS_RENDERER,
 *   else WebGPU).
 * - WebGPU only where `navigator.gpu` hands out an adapter; otherwise
 *   WebGL in the same page load.
 * - A wgpu engine that fails to start changes the page to WebGL without a
 *   reload (`fallBackToWebgl`), and the tab remembers it for the session,
 *   so the next load goes straight to WebGL.
 *
 * There is no stored preference: Photonamous has no Renderer menu.
 */

import {
  canUseWebGpu as probeWebGpu,
  chooseRenderer,
  hasWebGpu,
  noteRunningRenderer as noteRunning,
  runningRenderer as running,
  type Renderer,
} from '@lopsy/engine-wasm/renderer-choice';

export type { Renderer };

/** sessionStorage: set when the wgpu engine failed to start in this tab. */
export const RENDERER_FAILED_KEY = 'photonamous:renderer-failed';

function hasFailedInTab(): boolean {
  try {
    return sessionStorage.getItem(RENDERER_FAILED_KEY) !== null;
  } catch {
    // Storage is blocked in some privacy modes.
    return false;
  }
}

/** The renderer this page load asks for, before the adapter is probed. Called by the generated selector. */
export function requestedRenderer(fallback: Renderer, hasWgpuBuild: boolean): Renderer {
  if (typeof location === 'undefined') return 'webgl';
  return chooseRenderer({
    search: location.search,
    stored: null,
    fallback,
    hasWebGpu: hasWebGpu(),
    hasWgpuBuild,
    hasFailed: hasFailedInTab(),
  });
}

/** Whether the browser hands out a WebGPU adapter. Called by the generated selector. */
export function canUseWebGpu(): Promise<boolean> {
  return probeWebGpu();
}

const runningListeners = new Set<() => void>();

/** Called by the generated selector once it has initialized a build. */
export function noteRunningRenderer(renderer: Renderer): void {
  noteRunning(renderer);
  for (const listener of [...runningListeners]) listener();
}

/** Calls `listener` whenever the build this page runs is set or changes (the status bar). Returns the unsubscribe. */
export function onRunningRendererChange(listener: () => void): () => void {
  runningListeners.add(listener);
  return () => {
    runningListeners.delete(listener);
  };
}

/** The build this page load runs, once the engine's wasm is initialized; null before. */
export function runningRenderer(): Renderer | null {
  return running();
}

/** Records that the wgpu engine failed to start in this tab, so the next load runs WebGL. */
export function markWgpuFailed(): void {
  try {
    sessionStorage.setItem(RENDERER_FAILED_KEY, '1');
  } catch {
    // Without storage the next load tries WebGPU again, and falls back again.
  }
}

let webglFallback: (() => Promise<void>) | null = null;
let fallingBack: Promise<boolean> | null = null;

/** Called by the generated selector when it chose wgpu: how to change to WebGL. */
export function setWebglFallback(fallBack: () => Promise<void>): void {
  webglFallback = fallBack;
  fallingBack = null;
}

/**
 * After the wgpu engine failed to start: records that for the tab and
 * changes this page load to the WebGL build. Resolves true once the page
 * runs WebGL (also for a second caller while the first is changing it),
 * false when it cannot change. Only safe while no wgpu engine exists: the
 * caller makes sure of that (develop-engine.ts).
 */
export function fallBackToWebgl(): Promise<boolean> {
  markWgpuFailed();
  if (fallingBack) return fallingBack;
  const fallBack = webglFallback;
  if (!fallBack) return Promise.resolve(false);
  webglFallback = null;
  fallingBack = fallBack().then(
    () => true,
    () => false,
  );
  return fallingBack;
}
