/**
 * Messages between the RAW decode (main thread, `raw-decode.ts`) and its
 * workers (`raw-worker.ts`), for every format on the engine's RAW
 * interface (`rawPrepare` and the `raw…` band renders). Each worker runs
 * its own instance of the WASM module: one prepares the whole frame
 * (`prepare`), then every worker renders row bands of its plane (`band`).
 */

export type RawWorkerRequest =
  /** `renderer`: which build `module` was compiled from, so the worker loads that build's glue. */
  | { kind: 'init'; module: WebAssembly.Module; renderer: 'webgl' | 'wgpu' }
  | {
      kind: 'prepare';
      data: Uint8Array;
      /**
       * Also bin the whole frame to linear camera RGB with at least this long
       * edge (`binnedLinear`), for a first view; null for none.
       */
      binnedLongEdge: number | null;
    }
  | {
      kind: 'band';
      index: number;
      /** The format id `rawPrepare` gave, passed to every `raw…` call. */
      format: string;
      /** Plane rows `[srcY0, srcY1)`, each `planeWidth × samplesPerPixel` values. */
      src: Float32Array;
      paramsJson: string;
      y0: number;
      y1: number;
      srcY0: number;
      srcY1: number;
      /** Linear camera RGB for the develop stage (`rawRenderLinearBand`) rather than the finished look (`rawRenderFinishedBand`). */
      linear: boolean;
    };

export type RawWorkerResponse =
  | {
      kind: 'prepared';
      /** The format id: `"raf"`, `"dng"`, `"arw"`. */
      format: string;
      /** The engine's `RawDescription`, as JSON (`parseRawDescription`). */
      describeJson: string;
      /** The format's own render parameters, as the engine wrote them. */
      paramsJson: string;
      plane: Float32Array;
      binned: RawBandPixels | null;
      /** Auto white balance of the binned frame: camera-space multipliers, green 1. */
      autoWbRatio: [number, number, number] | null;
    }
  | {
      kind: 'band';
      index: number;
      /** Where the band lands in the final (oriented) image. */
      x: number;
      y: number;
      width: number;
      height: number;
      /** RGBA f32, `width`×`height`. */
      pixels: Float32Array;
    }
  | { kind: 'error'; message: string };

export interface RawBandPixels {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: Float32Array;
}
