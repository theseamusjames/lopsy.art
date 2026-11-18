/**
 * Messages between the RAF decode (main thread) and its workers
 * (`raf-worker.ts`). Ported from lopsy-web's io/raf-worker-protocol.ts. Each
 * worker runs its own instance of the WASM module: one prepares the whole
 * frame (`prepare`), then every worker renders row bands of it (`band`).
 */

export type RafWorkerRequest =
  | { kind: 'init'; module: WebAssembly.Module }
  | {
      kind: 'prepare';
      data: Uint8Array;
      /**
       * Also bin the whole frame to linear camera RGB with at least this long
       * edge (`rafRenderBinnedLinear`), for a first view; null for none.
       */
      binnedLongEdge: number | null;
    }
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
      /** Linear camera RGB for the develop stage (`rafRenderLinearBand`) rather than the finished look. */
      linear: boolean;
    };

export type RafWorkerResponse =
  | {
      kind: 'prepared';
      metaJson: string;
      paramsJson: string;
      /** `rafDevelopDefaults(paramsJson)`. */
      developDefaultsJson: string;
      mosaic: Float32Array;
      binned: RafBandPixels | null;
    }
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
