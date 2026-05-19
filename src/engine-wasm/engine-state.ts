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
let engineCanvas: HTMLCanvasElement | null = null;

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
      (gl as unknown as Record<string, string>).drawingBufferColorSpace = 'display-p3';
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
  let cacheTimer: ReturnType<typeof setTimeout> | null = null;
  useToolSettingsStore.subscribe((state) => {
    if (state.activeSubBrushes !== prevSubBrushes) {
      prevSubBrushes = state.activeSubBrushes;
      if (cacheTimer) clearTimeout(cacheTimer);
      const subs = state.activeSubBrushes;
      cacheTimer = setTimeout(() => {
        cacheTimer = null;
        const eng = getEngine();
        if (!eng || subs.length === 0) return;
        cacheSubBrushTips(eng, subs);
      }, 150);
    }
  });

  // Expose for e2e testing (memory profiling needs to query GPU texture dimensions)
  const w = window as unknown as Record<string, unknown>;
  w.__engineState = { getEngine };
  // Dynamically import wasm-bridge to expose getLayerTextureDimensions
  import('./wasm-bridge').then((mod) => { w.__wasmBridge = mod; }).catch(() => {});

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
  if (engine) {
    engine.free();
  }
  engine = null;
  engineCanvas = null;
}
