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
  assembleExportTile as rawAssembleExportTile,
  compositeForExport as rawCompositeForExport,
  compositeForExportSized as rawCompositeForExportSized,
  createEngine as rawCreateEngine,
  exportPng16 as rawExportPng16,
  exportTiff16 as rawExportTiff16,
  readDevelopHistogram as rawReadDevelopHistogram,
  readHdrHistogram as rawReadHdrHistogram,
  readHdrOutputF32 as rawReadHdrOutputF32,
  readHdrOutputF32Sized as rawReadHdrOutputF32Sized,
  readRenderedF32 as rawReadRenderedF32,
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
/**
 * The histogram (4 × 256 bins) of the composite as last rendered. It
 * changes nothing in the document, so it need not wait its turn (the
 * engine's doc comment says to wrap it with 'any-time').
 */
export const readDevelopHistogram = readbacks.asyncReadback(rawReadDevelopHistogram, 'any-time');
/** The white balance picker's answer. It reads the source and changes nothing, so it need not wait its turn. */
export const sampleNeutralWhiteBalance = readbacks.asyncReadback(rawSampleNeutralWhiteBalance, 'any-time');
/**
 * Auto tone's scene statistics (8 floats). It renders a live frame of the
 * engine's current state and changes nothing in the document, so it need
 * not wait its turn.
 */
export const readSceneStatistics = readbacks.asyncReadback(rawReadSceneStatistics, 'any-time');
export const exportPng16 = readbacks.asyncReadback(rawExportPng16);
/** The document as RGBA8 sRGB at its own size: the gain map's SDR picture. */
export const compositeForExport = readbacks.asyncReadback(rawCompositeForExport);
/**
 * The HDR picture for a file (linear Rec. 2020 f32 at the document's
 * size). It replaces the live composite, so it waits its turn.
 */
export const readHdrOutputF32 = readbacks.asyncReadback(rawReadHdrOutputF32);
/**
 * The HDR picture at an output size no larger than the document's: the
 * rendered image reduced on the GPU before the output step. It re-composites,
 * so it waits its turn.
 */
export const readHdrOutputF32Sized = readbacks.asyncReadback(rawReadHdrOutputF32Sized);
/**
 * The RGBA8 sRGB picture at an output size no larger than the document's:
 * the same picture `readHdrOutputF32Sized` makes at that size, for the gain
 * map. It re-composites, so it waits its turn.
 */
export const compositeForExportSized = readbacks.asyncReadback(rawCompositeForExportSized);
/** The HDR histogram (4 × 256 bins up to a peak). It changes nothing in the document. */
export const readHdrHistogram = readbacks.asyncReadback(rawReadHdrHistogram, 'any-time');
/**
 * The last live frame as rendered with the working space (linear Rec. 2020,
 * unclamped f32 RGBA at the document's size), drawn first if stale. It
 * changes nothing in the document (the engine's doc comment says to wrap
 * it with 'any-time'). Development builds read it for the RAW parity
 * fingerprints (e2e/raw-parity.spec.ts).
 */
export const readRenderedF32 = readbacks.asyncReadback(rawReadRenderedF32, 'any-time');
export const exportTiff16 = readbacks.asyncReadback(rawExportTiff16);
/**
 * A tile's export read into the whole picture being assembled in the
 * engine (`beginExportAssembly`); the pixels stay in the module. It
 * re-composites, so it waits its turn.
 */
export const assembleExportTile = readbacks.asyncReadback(rawAssembleExportTile);

/** Readbacks out, as Lopsy's `parkedReadbackCount`: always 0 on WebGL. */
export function parkedReadbackCount(): number {
  return readbacks.parkedCount();
}

declare global {
  interface Window {
    /** Development builds: `parkedReadbackCount`, for e2e tests that act while a read is out. */
    __photonamousParkedReads?: () => number;
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') window.__photonamousParkedReads = parkedReadbackCount;
