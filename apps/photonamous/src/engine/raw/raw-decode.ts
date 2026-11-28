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

import { rawPlanBands, rawPlanScaledBands, rawPlanWindowBands } from '@lopsy/engine-pkg/lopsy_wasm';
import { wasmUrlFor } from '../engine-files';
import { rendererName } from '../wasm';
import { RAW_BANDS_PER_WORKER, rawWorkerCount } from './raw-decode-plan';
import { parseRawDescription, type RawDescription } from './raw-format';
import type { RawBandPixels, RawWorkerRequest, RawWorkerResponse } from './raw-worker-protocol';

/** A width and height in pixels. */
export interface FrameSize {
  readonly width: number;
  readonly height: number;
}

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

/** `rawPrepare` refused the file: its message is the engine's sentence. */
export class RawPrepareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RawPrepareError';
  }
}

/** The engine's baked decode (`decodeAndUploadRawBaked`) refused the file: its message is the engine's sentence. */
export class RawRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RawRefusedError';
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

/**
 * The frame reduced to `frame`, which is smaller than its own size: bands
 * of destination rows (or columns), each rendering the plane rows it reads
 * and reducing them by area in the worker (`rawPlanScaledBands`,
 * `rawRenderScaledBand`), so the frame is never whole at its own size.
 */
async function renderScaledBands(
  workers: Worker[],
  prepared: PreparedPlane,
  linear: boolean,
  frame: FrameSize,
  onBand: (band: RawBandPixels, done: number, count: number) => void,
  signal: AbortSignal | undefined,
): Promise<void> {
  const { format, description, paramsJson, plane } = prepared;
  const plan = rawPlanScaledBands(format, paramsJson, frame.width, frame.height, workers.length * RAW_BANDS_PER_WORKER);
  const bandCount = plan.length / 6;
  const rowLength = description.planeWidth * description.samplesPerPixel;
  let next = 0;
  let done = 0;

  const drain = async (worker: Worker): Promise<void> => {
    while (next < bandCount) {
      const index = next++;
      const [y0 = 0, y1 = 0, srcY0 = 0, srcY1 = 0, d0 = 0, d1 = 0] = plan.subarray(index * 6, index * 6 + 6);
      const src = plane.slice(srcY0 * rowLength, srcY1 * rowLength);
      const scaled = { dstWidth: frame.width, dstHeight: frame.height, d0, d1 };
      const res = await call(worker, { kind: 'band', index, format, src, paramsJson, y0, y1, srcY0, srcY1, linear, scaled }, [src.buffer], signal);
      if (res.kind !== 'band') throw new Error(`RAW worker sent ${res.kind} for band ${index}`);
      done++;
      onBand(res, done, bandCount);
    }
  };

  await Promise.all(workers.map(drain));
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
      const res = await call(worker, { kind: 'band', index, format, src, paramsJson, y0, y1, srcY0, srcY1, linear, scaled: null }, [src.buffer], signal);
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
  /**
   * The size to render the frame at, once its description is known; the
   * frame's own size when omitted or when it answers that. A smaller size
   * renders the frame reduced by area, band by band.
   */
  readonly frameSize?: (description: RawDescription) => FrameSize;
}

/**
 * Decodes a RAW file across a pool of workers. `onBand` receives each
 * finished band (already oriented, positioned in the frame, whose size is
 * `frame`) as soon as it is ready, in no particular order. Resolves with
 * the file's description once every band has been delivered. Without
 * `linear` the bands are the format's finished look, which only a format
 * whose description has `finishedBands` renders.
 */
export async function decodeRawInWorkers(
  data: Uint8Array,
  onBand: (description: RawDescription, band: RawBandPixels, frame: FrameSize) => void,
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
    let prepared: RawWorkerResponse;
    try {
      prepared = await call(first, { kind: 'prepare', data, binnedLongEdge }, [], signal);
    } catch (err) {
      if (err instanceof DecodeAbortedError) throw err;
      throw new RawPrepareError(err instanceof Error ? err.message : String(err));
    }
    if (prepared.kind !== 'prepared') throw new Error(`RAW worker sent ${prepared.kind} instead of the prepared frame`);
    const description = parseRawDescription(prepared.describeJson);
    onPrepared?.(description, { paramsJson: prepared.paramsJson, binned: prepared.binned, autoWbRatio: prepared.autoWbRatio });
    if (options.renderBands === false) return description;
    if (!linear && !description.finishedBands) throw new Error(`${prepared.format.toUpperCase()} has no finished look in bands`);
    const own: FrameSize = { width: description.width, height: description.height };
    const frame = options.frameSize ? options.frameSize(description) : own;
    const preparedPlane = { format: prepared.format, description, paramsJson: prepared.paramsJson, plane: prepared.plane };
    if (frame.width !== own.width || frame.height !== own.height) {
      await renderScaledBands(
        workers,
        preparedPlane,
        linear,
        frame,
        (band, done, count) => {
          onBand(description, band, frame);
          onProgress?.({ stage: 'rendering', bandsDone: done, bandCount: count });
        },
        signal,
      );
      return description;
    }
    await renderBands(
      workers,
      { format: prepared.format, description, paramsJson: prepared.paramsJson, plane: prepared.plane },
      linear,
      (band, done, count) => {
        onBand(description, band, own);
        onProgress?.({ stage: 'rendering', bandsDone: done, bandCount: count });
      },
      signal,
    );
    return description;
  } finally {
    for (const worker of workers) worker.terminate();
  }
}

/** A rectangle of the oriented frame, in its own pixels. */
export interface FrameWindow {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A RAW file prepared once and kept, with its workers, so windows of its
 * frame can be rendered at the frame's own size one after another: the
 * tiles of an export larger than the GPU's textures (tile-plan.ts). The
 * plane stays on this thread between windows; each band is cut from it and
 * handed to a worker, as `decodeRawInWorkers` does.
 */
export interface RawFrame {
  readonly description: RawDescription;
  /**
   * Renders the bands that cover `window` (`rawPlanWindowBands`) and hands
   * each to `onBand` as it is ready, oriented and placed in the frame:
   * whole rows, or whole columns for a frame turned a quarter, of which
   * only the part inside `window` belongs to it. Linear camera RGB.
   */
  renderWindow(window: FrameWindow, onBand: (band: RawBandPixels) => void, signal?: AbortSignal): Promise<void>;
  /** Ends the workers and lets go of the plane. */
  close(): void;
}

/** Prepares `data` for `RawFrame.renderWindow`. Rejects with `RawPrepareError` when the RAW interface refuses the file. */
export async function openRawFrame(data: Uint8Array, signal?: AbortSignal): Promise<RawFrame> {
  const compiled = await compileWasmModule();
  if (signal?.aborted) throw new DecodeAbortedError();
  let workers: Worker[] = Array.from({ length: rawWorkerCount(navigator.hardwareConcurrency) }, () => spawnWorker(compiled));
  const close = () => {
    for (const worker of workers) worker.terminate();
    workers = [];
  };
  try {
    const [first] = workers;
    if (!first) throw new Error('No RAW decode workers');
    let prepared: RawWorkerResponse;
    try {
      prepared = await call(first, { kind: 'prepare', data, binnedLongEdge: null }, [], signal);
    } catch (err) {
      if (err instanceof DecodeAbortedError) throw err;
      throw new RawPrepareError(err instanceof Error ? err.message : String(err));
    }
    if (prepared.kind !== 'prepared') throw new Error(`RAW worker sent ${prepared.kind} instead of the prepared frame`);
    const description = parseRawDescription(prepared.describeJson);
    const { format, paramsJson, plane } = prepared;
    const rowLength = description.planeWidth * description.samplesPerPixel;
    const renderWindow = async (window: FrameWindow, onBand: (band: RawBandPixels) => void, windowSignal?: AbortSignal): Promise<void> => {
      if (workers.length === 0) throw new Error('The RAW frame was closed');
      const plan = rawPlanWindowBands(format, paramsJson, window.x, window.y, window.width, window.height, workers.length * RAW_BANDS_PER_WORKER);
      const bandCount = plan.length / 4;
      let next = 0;
      const drain = async (worker: Worker): Promise<void> => {
        while (next < bandCount) {
          const index = next++;
          const [y0 = 0, y1 = 0, srcY0 = 0, srcY1 = 0] = plan.subarray(index * 4, index * 4 + 4);
          const src = plane.slice(srcY0 * rowLength, srcY1 * rowLength);
          const res = await call(worker, { kind: 'band', index, format, src, paramsJson, y0, y1, srcY0, srcY1, linear: true, scaled: null }, [src.buffer], windowSignal);
          if (res.kind !== 'band') throw new Error(`RAW worker sent ${res.kind} for band ${index}`);
          onBand(res);
        }
      };
      await Promise.all(workers.map(drain));
    };
    return { description, renderWindow, close };
  } catch (err) {
    close();
    throw err;
  }
}
