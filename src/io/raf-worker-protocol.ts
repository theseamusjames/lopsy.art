/**
 * Messages between the RAF import (main thread) and its decode workers
 * (`raf-worker.ts`). Each worker runs its own instance of the WASM module:
 * one prepares the whole frame (`prepare`), then every worker renders row
 * bands of it (`band`).
 */

export type RafWorkerRequest =
  | { kind: 'init'; module: WebAssembly.Module }
  | { kind: 'prepare'; data: Uint8Array }
  | {
      kind: 'band';
      index: number;
      /** Mosaic rows `[srcY0, srcY1)`, full frame width. */
      src: Float32Array;
      paramsJson: string;
      y0: number;
      y1: number;
      srcY0: number;
      srcY1: number;
    };

export type RafWorkerResponse =
  | { kind: 'prepared'; metaJson: string; paramsJson: string; mosaic: Float32Array }
  | {
      kind: 'band';
      index: number;
      /** Where the band lands in the final (EXIF-oriented) image. */
      x: number;
      y: number;
      width: number;
      height: number;
      /** RGBA f32, `width`×`height`. */
      pixels: Float32Array;
    }
  | { kind: 'error'; message: string };

/** Parsed `metaJson` from `rafPrepare`. */
export interface RafPrepareMeta {
  /** Final image size, after EXIF orientation. */
  width: number;
  height: number;
  /** Mosaic size, before orientation. */
  mosaicWidth: number;
  mosaicHeight: number;
}

export interface RafBandPixels {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: Float32Array;
}
