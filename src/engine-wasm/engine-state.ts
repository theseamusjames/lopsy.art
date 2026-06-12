/**
 * Engine singleton — manages the WASM engine lifecycle.
 *
 * The engine is lazily initialized the first time the canvas mounts.
 * All other modules access the current engine via getEngine().
 */

import type { Engine } from './wasm-bridge';
import { initWasm, createEngine, clearAllLayers } from './wasm-bridge';
import { resetTrackedState, cacheSubBrushTips } from './engine-sync';
import { setEngine as setGpuPixelEngine } from './gpu-pixel-access';
import { canvasColorSpace } from '../engine/color-space';
import { useToolSettingsStore } from '../app/tool-settings-store';

let engine: Engine | null = null;

declare global {
  interface Window {
    /** e2e memory profiling: query the current engine. */
    __engineState?: { getEngine: () => Engine | null };
    /** e2e memory profiling: bridge module (texture dimension queries). */
    __wasmBridge?: typeof import('./wasm-bridge');
  }
}
let engineCanvas: HTMLCanvasElement | null = null;

// Resources held by the current engine that must be released on
// destroyEngine. Without this, WebGL context-loss → initEngine adds a new
// Zustand subscriber on every recovery and the previous setTimeout fires
// against a freed engine.
let subBrushUnsubscribe: (() => void) | null = null;
let subBrushCacheTimer: ReturnType<typeof setTimeout> | null = null;

export function getEngine(): Engine | null {
  return engine;
}

export function getEngineCanvas(): HTMLCanvasElement | null {
  return engineCanvas;
}

export async function initEngine(canvas: HTMLCanvasElement): Promise<Engine> {
  await initWasm();
  import('../tools/brush/builtin-brushes').then((m) => m.loadBuiltinBitmapBrushes()).catch(() => {});
  engine = createEngine(canvas);
  engineCanvas = canvas;

  // Enable wide-gamut / EDR output if the display supports it.
  // The WASM engine already uses RGBA16F textures; setting the drawing buffer
  // color space to display-p3 tells the compositor to preserve values > 1.0.
  try {
    const gl = canvas.getContext('webgl2');
    if (gl && canvasColorSpace === 'display-p3') {
      gl.drawingBufferColorSpace = 'display-p3';
    }
  } catch {
    // drawingBufferColorSpace not supported — fall back silently
  }
  setGpuPixelEngine(engine);

  // Pre-cache sub-brush tip textures whenever the sub-brush list changes.
  // Debounced so slider drags don't re-cache on every mouse move.
  const initialSubs = useToolSettingsStore.getState().activeSubBrushes;
  if (initialSubs.length > 0) {
    cacheSubBrushTips(engine, initialSubs);
  }
  let prevSubBrushes = initialSubs;
  subBrushUnsubscribe = useToolSettingsStore.subscribe((state) => {
    if (state.activeSubBrushes !== prevSubBrushes) {
      prevSubBrushes = state.activeSubBrushes;
      if (subBrushCacheTimer) clearTimeout(subBrushCacheTimer);
      const subs = state.activeSubBrushes;
      subBrushCacheTimer = setTimeout(() => {
        subBrushCacheTimer = null;
        const eng = getEngine();
        if (!eng || subs.length === 0) return;
        cacheSubBrushTips(eng, subs);
      }, 150);
    }
  });

  // Expose for e2e testing (memory profiling needs to query GPU texture dimensions)
  window.__engineState = { getEngine };
  // Dynamically import wasm-bridge to expose getLayerTextureDimensions
  import('./wasm-bridge').then((mod) => { window.__wasmBridge = mod; }).catch(() => {});

  return engine;
}

/**
 * Clear all GPU resources (layers, textures, masks, etc.) without
 * destroying the engine. Used when creating/opening a new document.
 */
export function clearEngine(): void {
  if (engine) {
    clearAllLayers(engine);
    resetTrackedState(engine);
  }
}

export function destroyEngine(): void {
  // Release engine-scoped subscriptions and timers before freeing the
  // engine itself — otherwise the next initEngine stacks a second
  // subscriber and a stale timer can fire against a dropped engine.
  if (subBrushUnsubscribe) {
    subBrushUnsubscribe();
    subBrushUnsubscribe = null;
  }
  if (subBrushCacheTimer) {
    clearTimeout(subBrushCacheTimer);
    subBrushCacheTimer = null;
  }
  if (engine) {
    engine.free();
  }
  engine = null;
  engineCanvas = null;
}
