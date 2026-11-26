/**
 * Parallel RAF decode, ported from lopsy-web's io/raf-decode.ts. One worker
 * runs the whole-frame stage (parse, decompress, white balance); then the
 * frame is cut into row bands that every worker renders (demosaic,
 * denoise, tone, sharpen) concurrently. Bands carry enough overlapping
 * context rows that stitching them is exact (`BAND_HALO_ROWS` in
 * engine/core/src/raf/mod.rs).
 *
 * Workers are spawned per decode and terminated afterwards, which also
 * hands their never-shrinking WASM memory back to the browser. Aborting
 * terminates them at once.
 */

import { rafPlanBands } from '@lopsy/engine-pkg/lopsy_wasm';
import { wasmUrlFor } from '../engine-files';
import { rendererName } from '../wasm';
import { RAF_BANDS_PER_WORKER, rafWorkerCount } from './raw-decode-plan';
import type { RafBandPixels, RafPrepareMeta, RafWorkerRequest, RafWorkerResponse } from './raw-worker-protocol';

export interface RafDecodeProgress {
  readonly stage: 'preparing' | 'rendering';
  /** Bands delivered so far, of `bandCount`. */
  readonly bandsDone: number;
  readonly bandCount: number;
}

export class DecodeAbortedError extends Error {
  constructor() {
    super('The decode was cancelled');
    this.name = 'DecodeAbortedError';
  }
}

interface CompiledEngine {
  readonly module: WebAssembly.Module;
  readonly renderer: 'webgl' | 'wgpu';
}

let modulePromise: Promise<CompiledEngine> | null = null;
let moduleRenderer: 'webgl' | 'wgpu' = 'webgl';

/**
 * Compiles the engine module once; workers instantiate it without
 * recompiling. It is the build the page runs (the page's engine has
 * started by the time a RAF is decoded), so the browser fetches one wasm,
 * not both. The workers call only its pure decode functions, which are the
 * same on either build.
 */
function compileWasmModule(): Promise<CompiledEngine> {
  const renderer = rendererName();
  if (modulePromise && moduleRenderer !== renderer) modulePromise = null;
  if (!modulePromise) {
    moduleRenderer = renderer;
    const wasmUrl = wasmUrlFor(renderer);
    modulePromise = WebAssembly.compileStreaming(fetch(wasmUrl))
      .catch(() =>
        fetch(wasmUrl)
          .then((r) => r.arrayBuffer())
          .then((b) => WebAssembly.compile(b)),
      )
      .then((module) => ({ module, renderer }))
      .catch((err: unknown) => {
        modulePromise = null;
        throw err;
      });
  }
  return modulePromise;
}

function spawnWorker({ module, renderer }: CompiledEngine): Worker {
  const worker = new Worker(new URL('./raw-worker.ts', import.meta.url), { type: 'module' });
  const init: RafWorkerRequest = { kind: 'init', module, renderer };
  worker.postMessage(init);
  return worker;
}

function call(
  worker: Worker,
  req: RafWorkerRequest,
  transfer: Transferable[],
  signal: AbortSignal | undefined,
): Promise<RafWorkerResponse> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DecodeAbortedError());
      return;
    }
    const onAbort = () => reject(new DecodeAbortedError());
    signal?.addEventListener('abort', onAbort, { once: true });
    const done = () => signal?.removeEventListener('abort', onAbort);
    worker.onmessage = (e: MessageEvent<RafWorkerResponse>) => {
      done();
      if (e.data.kind === 'error') reject(new Error(e.data.message));
      else resolve(e.data);
    };
    worker.onerror = (e) => {
      e.preventDefault();
      done();
      reject(new Error(e.message || 'RAF decode worker failed'));
    };
    worker.onmessageerror = () => {
      done();
      reject(new Error('RAF decode worker message could not be read'));
    };
    worker.postMessage(req, transfer);
  });
}

async function renderBands(
  workers: Worker[],
  mosaic: Float32Array,
  meta: RafPrepareMeta,
  paramsJson: string,
  linear: boolean,
  onBand: (band: RafBandPixels, done: number, count: number) => void,
  signal: AbortSignal | undefined,
): Promise<void> {
  const plan = rafPlanBands(meta.mosaicHeight, workers.length * RAF_BANDS_PER_WORKER);
  const bandCount = plan.length / 4;
  const w = meta.mosaicWidth;
  let next = 0;
  let done = 0;

  const drain = async (worker: Worker): Promise<void> => {
    while (next < bandCount) {
      const index = next++;
      const [y0 = 0, y1 = 0, srcY0 = 0, srcY1 = 0] = plan.subarray(index * 4, index * 4 + 4);
      const src = mosaic.slice(srcY0 * w, srcY1 * w);
      const res = await call(worker, { kind: 'band', index, src, paramsJson, y0, y1, srcY0, srcY1, linear }, [src.buffer], signal);
      if (res.kind !== 'band') throw new Error(`RAF worker sent ${res.kind} for band ${index}`);
      done++;
      onBand(res, done, bandCount);
    }
  };

  await Promise.all(workers.map(drain));
}

export interface RafPrepared {
  readonly binned: RafBandPixels | null;
  readonly developDefaultsJson: string;
  readonly autoWbRatio: [number, number, number] | null;
  readonly profilesJson: string | null;
}

export interface RafDecodeOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: RafDecodeProgress) => void;
  /** Linear camera RGB for the develop stage rather than the finished look. */
  readonly linear?: boolean;
  /** With `linear`: also bin the whole frame to at least this long edge for a first view. */
  readonly binnedLongEdge?: number;
  /** Once the frame is prepared, before any band: the binned first view (if asked for) and the develop defaults. */
  readonly onPrepared?: (meta: RafPrepareMeta, prepared: RafPrepared) => void;
  /** False stops after the prepared frame (and its binned view): no full-size bands. */
  readonly renderBands?: boolean;
}

/**
 * Decodes a RAF file across a pool of workers. `onBand` receives each
 * finished band (already oriented, positioned in the final image) as soon
 * as it is ready, in no particular order. Resolves with the image size
 * once every band has been delivered.
 */
export async function decodeRafInWorkers(
  data: Uint8Array,
  onBand: (meta: RafPrepareMeta, band: RafBandPixels) => void,
  options: RafDecodeOptions = {},
): Promise<RafPrepareMeta> {
  const { signal, onProgress, onPrepared } = options;
  const linear = options.linear === true;
  const compiled = await compileWasmModule();
  if (signal?.aborted) throw new DecodeAbortedError();
  const workers = Array.from({ length: rafWorkerCount(navigator.hardwareConcurrency) }, () => spawnWorker(compiled));
  try {
    const [first] = workers;
    if (!first) throw new Error('No RAF decode workers');
    onProgress?.({ stage: 'preparing', bandsDone: 0, bandCount: 0 });
    const binnedLongEdge = linear && options.binnedLongEdge ? options.binnedLongEdge : null;
    const prepared = await call(first, { kind: 'prepare', data, binnedLongEdge }, [], signal);
    if (prepared.kind !== 'prepared') throw new Error(`RAF worker sent ${prepared.kind} instead of the prepared frame`);
    const meta = JSON.parse(prepared.metaJson) as RafPrepareMeta;
    onPrepared?.(meta, {
      binned: prepared.binned,
      developDefaultsJson: prepared.developDefaultsJson,
      autoWbRatio: prepared.autoWbRatio,
      profilesJson: prepared.profilesJson,
    });
    if (options.renderBands === false) return meta;
    await renderBands(
      workers,
      prepared.mosaic,
      meta,
      prepared.paramsJson,
      linear,
      (band, done, count) => {
        onBand(meta, band);
        onProgress?.({ stage: 'rendering', bandsDone: done, bandCount: count });
      },
      signal,
    );
    return meta;
  } finally {
    for (const worker of workers) worker.terminate();
  }
}
