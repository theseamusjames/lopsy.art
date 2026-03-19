/**
 * Engine singleton — manages the WASM engine lifecycle.
 *
 * The engine is lazily initialized the first time the canvas mounts.
 * All other modules access the current engine via getEngine().
 */

import type { Engine } from './wasm-bridge';
import { initWasm, createEngine } from './wasm-bridge';
import { setEngine as setGpuPixelEngine } from './gpu-pixel-access';

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
  engine = createEngine(canvas);
  engineCanvas = canvas;
  setGpuPixelEngine(engine);
  return engine;
}

export function destroyEngine(): void {
  if (engine) {
    engine.free();
  }
  engine = null;
  engineCanvas = null;
}
