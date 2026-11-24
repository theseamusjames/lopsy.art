/**
 * The engine's exports whose type differs between its two builds, typed
 * for both. The app imports the glue as `@lopsy/engine-pkg/lopsy_wasm`,
 * whose declarations are the WebGL build's: there `createEngine` returns an
 * engine and every readback its value. On the wgpu build `createEngine`
 * returns a Promise and a readback may answer with a parked command
 * (engine/hosts/wasm/src/readback.rs). Everything else is the same on both,
 * and is imported from the glue directly; these are imported from here
 * (eslint.config.js enforces it), so a missing `await` is a type error.
 */

import {
  createEngine as rawCreateEngine,
  exportPng16 as rawExportPng16,
  exportTiff16 as rawExportTiff16,
  readDevelopHistogram as rawReadDevelopHistogram,
  readSceneStatistics as rawReadSceneStatistics,
  rendererName as rawRendererName,
  resumeTask,
  sampleColor as rawSampleColor,
  sampleNeutralWhiteBalance as rawSampleNeutralWhiteBalance,
  type Engine,
} from '@lopsy/engine-pkg/lopsy_wasm';
import { createReadbackQueue } from '@lopsy/engine-wasm/readback-order';
import type { Renderer } from './renderer-choice';

/** A new engine drawing into `canvas`. Await it: on WebGPU the device comes through a Promise. */
export async function createEngine(canvas: HTMLCanvasElement): Promise<Engine> {
  const made: Engine | Promise<Engine> = rawCreateEngine(canvas);
  return made;
}

/** Which build is running. Only known once the wasm is initialized. */
export function rendererName(): Renderer {
  return rawRendererName() === 'wgpu' ? 'wgpu' : 'webgl';
}

/** wasm-bindgen zeroes an object's pointer when it is freed. */
function isFreed(engine: Engine): boolean {
  return (engine as unknown as { __wbg_ptr?: number }).__wbg_ptr === 0;
}

const readbacks = createReadbackQueue<Engine>(resumeTask, isFreed);

/**
 * The pixel readout's one pixel. Nothing is changed with what it reads,
 * so it need not wait its turn.
 */
export const sampleColor = readbacks.asyncReadback(rawSampleColor, 'any-time');
/** The histogram (4 × 256 bins) of the composite as last rendered. */
export const readDevelopHistogram = readbacks.asyncReadback(rawReadDevelopHistogram);
export const sampleNeutralWhiteBalance = readbacks.asyncReadback(rawSampleNeutralWhiteBalance);
/**
 * Auto tone's scene statistics (8 floats). It renders a live frame of the
 * engine's current state and changes nothing in the document, so it need
 * not wait its turn.
 */
export const readSceneStatistics = readbacks.asyncReadback(rawReadSceneStatistics, 'any-time');
export const exportPng16 = readbacks.asyncReadback(rawExportPng16);
export const exportTiff16 = readbacks.asyncReadback(rawExportTiff16);

/** Readbacks out, as Lopsy's `parkedReadbackCount`: always 0 on WebGL. */
export function parkedReadbackCount(): number {
  return readbacks.parkedCount();
}
