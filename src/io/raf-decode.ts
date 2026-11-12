/**
 * Parallel RAF decode. One worker runs the whole-frame stage (parse,
 * decompress, white balance); then the frame is cut into row bands that
 * every worker renders (demosaic, denoise, tone, sharpen) concurrently.
 * Bands carry enough overlapping context rows that stitching them is exact
 * (see `BAND_HALO_ROWS` in engine-rs/crates/lopsy-core/src/raf/mod.rs).
 *
 * Workers are spawned per import and terminated afterwards, which also
 * hands their (never-shrinking) WASM memory back to the browser.
 */

import wasmUrl from '../engine-wasm/pkg/lopsy_wasm_bg.wasm?url';
import { rafPlanBands } from '../engine-wasm/wasm-bridge';
import { RAF_BANDS_PER_WORKER, rafWorkerCount } from './raf-decode-plan';
import type {
  RafBandPixels,
  RafPrepareMeta,
  RafWorkerRequest,
  RafWorkerResponse,
} from './raf-worker-protocol';

let modulePromise: Promise<WebAssembly.Module> | null = null;

/** Compiles the engine module once; workers instantiate it without recompiling. */
function compileWasmModule(): Promise<WebAssembly.Module> {
  if (!modulePromise) {
    modulePromise = WebAssembly.compileStreaming(fetch(wasmUrl))
      // Servers that don't send application/wasm reject streaming compiles.
      .catch(() => fetch(wasmUrl).then((r) => r.arrayBuffer()).then((b) => WebAssembly.compile(b)))
      .catch((err: unknown) => {
        modulePromise = null;
        throw err;
      });
  }
  return modulePromise;
}

function spawnWorker(module: WebAssembly.Module): Worker {
  const worker = new Worker(new URL('./raf-worker.ts', import.meta.url), { type: 'module' });
  const init: RafWorkerRequest = { kind: 'init', module };
  worker.postMessage(init);
  return worker;
}

/** Sends one request and resolves with the worker's reply to it. */
function call(worker: Worker, req: RafWorkerRequest, transfer: Transferable[]): Promise<RafWorkerResponse> {
  return new Promise((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<RafWorkerResponse>) => {
      if (e.data.kind === 'error') reject(new Error(e.data.message));
      else resolve(e.data);
    };
    worker.onerror = (e) => {
      e.preventDefault();
      reject(new Error(e.message || 'RAF decode worker failed'));
    };
    worker.onmessageerror = () => reject(new Error('RAF decode worker message could not be read'));
    worker.postMessage(req, transfer);
  });
}

async function renderBands(
  workers: Worker[],
  mosaic: Float32Array,
  meta: RafPrepareMeta,
  paramsJson: string,
  onBand: (band: RafBandPixels) => void,
): Promise<void> {
  const plan = rafPlanBands(meta.mosaicHeight, workers.length * RAF_BANDS_PER_WORKER);
  const bandCount = plan.length / 4;
  const w = meta.mosaicWidth;
  let next = 0;

  const drain = async (worker: Worker): Promise<void> => {
    while (next < bandCount) {
      const index = next++;
      const [y0 = 0, y1 = 0, srcY0 = 0, srcY1 = 0] = plan.subarray(index * 4, index * 4 + 4);
      const src = mosaic.slice(srcY0 * w, srcY1 * w);
      const res = await call(
        worker,
        { kind: 'band', index, src, paramsJson, y0, y1, srcY0, srcY1 },
        [src.buffer],
      );
      if (res.kind !== 'band') throw new Error(`RAF worker sent ${res.kind} for band ${index}`);
      onBand(res);
    }
  };

  await Promise.all(workers.map(drain));
}

/**
 * Decodes a RAF file across a pool of workers. `onBand` receives each
 * finished band (already oriented, positioned in the final image) as soon
 * as it is ready, in no particular order. Resolves with the image metadata
 * once every band has been delivered.
 */
export async function decodeRafInWorkers(
  data: Uint8Array,
  onBand: (meta: RafPrepareMeta, band: RafBandPixels) => void,
): Promise<RafPrepareMeta> {
  const module = await compileWasmModule();
  const workers = Array.from({ length: rafWorkerCount(navigator.hardwareConcurrency) }, () => spawnWorker(module));
  try {
    const [first] = workers;
    if (!first) throw new Error('No RAF decode workers');
    const prepared = await call(first, { kind: 'prepare', data }, []);
    if (prepared.kind !== 'prepared') throw new Error(`RAF worker sent ${prepared.kind} instead of the prepared frame`);

    const meta = JSON.parse(prepared.metaJson) as RafPrepareMeta;

    await renderBands(workers, prepared.mosaic, meta, prepared.paramsJson, (band) => onBand(meta, band));
    return meta;
  } finally {
    for (const worker of workers) worker.terminate();
  }
}
