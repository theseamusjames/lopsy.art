/// <reference lib="webworker" />

/**
 * RAF decode worker (ported from lopsy-web's io/raf-worker.ts). Runs a
 * private instance of the engine's WASM module, instantiated from the
 * module the main thread compiled, and only calls its pure decode
 * functions: no engine, no GPU.
 *
 * The module is whichever build the page runs, and the JS glue must be that
 * build's: the init message says which, and only that glue is loaded. The
 * glue is imported by its file name (`.js`) so the page's renderer selector
 * (vite.config.ts) does not stand in for it.
 */

import type { RafRenderedBand } from '@lopsy/engine-pkg/lopsy_wasm.js';
import type { RafBandPixels, RafWorkerRequest, RafWorkerResponse } from './raw-worker-protocol';

/** What this worker calls: the same on both builds, unlike the glue's engine exports. */
type Glue = Pick<
  typeof import('@lopsy/engine-pkg/lopsy_wasm.js'),
  'rafAutoWhiteBalanceClipped' | 'rafDevelopDefaults' | 'rafDevelopProfiles' | 'rafPrepare' | 'rafRenderBand' | 'rafRenderLinearBand'
> & { initSync(module: { module: WebAssembly.Module }): unknown };

let glue: Promise<Glue> | null = null;

async function loadGlue(req: Extract<RafWorkerRequest, { kind: 'init' }>): Promise<Glue> {
  const loaded: Glue = req.renderer === 'wgpu' ? await import('@lopsy/engine-pkg-wgpu/lopsy_wasm.js') : await import('@lopsy/engine-pkg/lopsy_wasm.js');
  loaded.initSync({ module: req.module });
  return loaded;
}

declare const self: DedicatedWorkerGlobalScope;

function reply(message: RafWorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

function takeBand(band: RafRenderedBand): RafBandPixels {
  try {
    return { x: band.x, y: band.y, width: band.width, height: band.height, pixels: band.takePixels() };
  } finally {
    band.free();
  }
}

/** `metaJson`'s `clipLevels`, or none (then every pixel is measured). */
function clipLevelsOf(metaJson: string): Float32Array {
  const meta: unknown = JSON.parse(metaJson);
  const clip = typeof meta === 'object' && meta !== null ? (meta as Record<string, unknown>).clipLevels : undefined;
  const isLevels = Array.isArray(clip) && clip.length === 3 && clip.every((v) => typeof v === 'number' && Number.isFinite(v));
  return isLevels ? Float32Array.from(clip as number[]) : new Float32Array(0);
}

/**
 * Auto white balance of the binned frame without its clipped pixels: the
 * decode reconstructs clipped highlights, and those are not measurements
 * of a neutral.
 */
function autoWbRatio(wasm: Glue, binned: RafBandPixels | null, metaJson: string): [number, number, number] | null {
  if (!binned) return null;
  const [r = 1, g = 1, b = 1] = wasm.rafAutoWhiteBalanceClipped(binned.pixels, clipLevelsOf(metaJson));
  return [r, g, b];
}

function handle(wasm: Glue, req: Exclude<RafWorkerRequest, { kind: 'init' }>): void {
  if (req.kind === 'prepare') {
    const prepared = wasm.rafPrepare(req.data);
    try {
      const paramsJson = prepared.paramsJson;
      // Bin from the mosaic the prepared result still holds: binning after
      // takeMosaic would copy the 160 MB mosaic back into the module.
      const binned = req.binnedLongEdge === null ? null : takeBand(prepared.binnedLinear(req.binnedLongEdge));
      const mosaic = prepared.takeMosaic();
      const transfer: Transferable[] = [mosaic.buffer];
      if (binned) transfer.push(binned.pixels.buffer);
      const metaJson = prepared.metaJson;
      reply(
        {
          kind: 'prepared',
          metaJson,
          paramsJson,
          developDefaultsJson: wasm.rafDevelopDefaults(paramsJson),
          mosaic,
          binned,
          autoWbRatio: autoWbRatio(wasm, binned, metaJson),
          profilesJson: wasm.rafDevelopProfiles(paramsJson),
        },
        transfer,
      );
    } finally {
      prepared.free();
    }
    return;
  }
  const render = req.linear ? wasm.rafRenderLinearBand : wasm.rafRenderBand;
  const band = takeBand(render(req.src, req.paramsJson, req.y0, req.y1, req.srcY0, req.srcY1));
  reply({ kind: 'band', index: req.index, ...band }, [band.pixels.buffer]);
}

function replyError(err: unknown): void {
  reply({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
}

// Requests arrive before the glue has loaded; each waits for it, in order.
self.onmessage = (e: MessageEvent<RafWorkerRequest>) => {
  const req = e.data;
  if (req.kind === 'init') {
    glue = loadGlue(req);
    glue.catch(replyError);
    return;
  }
  if (!glue) {
    replyError(new Error('The RAF worker was asked to decode before it was given the engine'));
    return;
  }
  glue.then((wasm) => handle(wasm, req)).catch(replyError);
};
