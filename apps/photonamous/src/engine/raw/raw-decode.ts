/**
 * Parallel decode of a RAW file of any format, through the engine's RAW
 * interface. One worker runs the whole-frame stage (`rawPrepare`: parse,
 * decompress, describe); then the plane is cut into row bands, planned by
 * the format (`rawPlanBands`), that every worker renders concurrently.
 * Bands carry enough overlapping context rows that stitching them is
 * exact, which the engine's tests prove for every format.
 *
 * Workers are spawned per decode and terminated afterwards, which also
 * hands their never-shrinking WASM memory back to the browser. Aborting
 * terminates them at once.
 */

import { rawPlanBands } from '@lopsy/engine-pkg/lopsy_wasm';
import { wasmUrlFor } from '../engine-files';
import { rendererName } from '../wasm';
import { RAW_BANDS_PER_WORKER, rawWorkerCount } from './raw-decode-plan';
import { parseRawDescription, type RawDescription } from './raw-format';
import type { RawBandPixels, RawWorkerRequest, RawWorkerResponse } from './raw-worker-protocol';

export interface RawDecodeProgress {
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
 * started by the time a RAW file is decoded), so the browser fetches one
 * wasm, not both. The workers call only its pure decode functions, which
 * are the same on either build.
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
  const init: RawWorkerRequest = { kind: 'init', module, renderer };
  worker.postMessage(init);
  return worker;
}

function call(
  worker: Worker,
  req: RawWorkerRequest,
  transfer: Transferable[],
  signal: AbortSignal | undefined,
): Promise<RawWorkerResponse> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DecodeAbortedError());
      return;
    }
    const onAbort = () => reject(new DecodeAbortedError());
    signal?.addEventListener('abort', onAbort, { once: true });
    const done = () => signal?.removeEventListener('abort', onAbort);
    worker.onmessage = (e: MessageEvent<RawWorkerResponse>) => {
      done();
      if (e.data.kind === 'error') reject(new Error(e.data.message));
      else resolve(e.data);
    };
    worker.onerror = (e) => {
      e.preventDefault();
      done();
      reject(new Error(e.message || 'RAW decode worker failed'));
    };
    worker.onmessageerror = () => {
      done();
      reject(new Error('RAW decode worker message could not be read'));
    };
    worker.postMessage(req, transfer);
  });
}

interface PreparedPlane {
  readonly format: string;
  readonly description: RawDescription;
  readonly paramsJson: string;
  readonly plane: Float32Array;
}

async function renderBands(
  workers: Worker[],
  prepared: PreparedPlane,
  linear: boolean,
  onBand: (band: RawBandPixels, done: number, count: number) => void,
  signal: AbortSignal | undefined,
): Promise<void> {
  const { format, description, paramsJson, plane } = prepared;
  const plan = rawPlanBands(format, paramsJson, workers.length * RAW_BANDS_PER_WORKER);
  const bandCount = plan.length / 4;
  // A plane row holds every sample of each pixel: one for a mosaic, three for linear RGB.
  const rowLength = description.planeWidth * description.samplesPerPixel;
  let next = 0;
  let done = 0;

  const drain = async (worker: Worker): Promise<void> => {
    while (next < bandCount) {
      const index = next++;
      const [y0 = 0, y1 = 0, srcY0 = 0, srcY1 = 0] = plan.subarray(index * 4, index * 4 + 4);
      const src = plane.slice(srcY0 * rowLength, srcY1 * rowLength);
      const res = await call(worker, { kind: 'band', index, format, src, paramsJson, y0, y1, srcY0, srcY1, linear }, [src.buffer], signal);
      if (res.kind !== 'band') throw new Error(`RAW worker sent ${res.kind} for band ${index}`);
      done++;
      onBand(res, done, bandCount);
    }
  };

  await Promise.all(workers.map(drain));
}

export interface RawPrepared {
  /** The format's own render parameters, as the engine wrote them. */
  readonly paramsJson: string;
  readonly binned: RawBandPixels | null;
  readonly autoWbRatio: [number, number, number] | null;
}

export interface RawDecodeOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: RawDecodeProgress) => void;
  /** Linear camera RGB for the develop stage rather than the finished look. */
  readonly linear?: boolean;
  /** With `linear`: also bin the whole frame to at least this long edge for a first view. */
  readonly binnedLongEdge?: number;
  /** Once the frame is prepared, before any band: its description, the binned first view (if asked for) and Auto's answer. */
  readonly onPrepared?: (description: RawDescription, prepared: RawPrepared) => void;
  /** False stops after the prepared frame (and its binned view): no full-size bands. */
  readonly renderBands?: boolean;
}

/**
 * Decodes a RAW file across a pool of workers. `onBand` receives each
 * finished band (already oriented, positioned in the final image) as soon
 * as it is ready, in no particular order. Resolves with the file's
 * description once every band has been delivered. Without `linear` the
 * bands are the format's finished look, which only a format whose
 * description has `finishedBands` renders.
 */
export async function decodeRawInWorkers(
  data: Uint8Array,
  onBand: (description: RawDescription, band: RawBandPixels) => void,
  options: RawDecodeOptions = {},
): Promise<RawDescription> {
  const { signal, onProgress, onPrepared } = options;
  const linear = options.linear === true;
  const compiled = await compileWasmModule();
  if (signal?.aborted) throw new DecodeAbortedError();
  const workers = Array.from({ length: rawWorkerCount(navigator.hardwareConcurrency) }, () => spawnWorker(compiled));
  try {
    const [first] = workers;
    if (!first) throw new Error('No RAW decode workers');
    onProgress?.({ stage: 'preparing', bandsDone: 0, bandCount: 0 });
    const binnedLongEdge = linear && options.binnedLongEdge ? options.binnedLongEdge : null;
    const prepared = await call(first, { kind: 'prepare', data, binnedLongEdge }, [], signal);
    if (prepared.kind !== 'prepared') throw new Error(`RAW worker sent ${prepared.kind} instead of the prepared frame`);
    const description = parseRawDescription(prepared.describeJson);
    onPrepared?.(description, { paramsJson: prepared.paramsJson, binned: prepared.binned, autoWbRatio: prepared.autoWbRatio });
    if (options.renderBands === false) return description;
    if (!linear && !description.finishedBands) throw new Error(`${prepared.format.toUpperCase()} has no finished look in bands`);
    await renderBands(
      workers,
      { format: prepared.format, description, paramsJson: prepared.paramsJson, plane: prepared.plane },
      linear,
      (band, done, count) => {
        onBand(description, band);
        onProgress?.({ stage: 'rendering', bandsDone: done, bandCount: count });
      },
      signal,
    );
    return description;
  } finally {
    for (const worker of workers) worker.terminate();
  }
}
