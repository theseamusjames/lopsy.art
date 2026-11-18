/// <reference lib="webworker" />

/**
 * RAF decode worker (ported from lopsy-web's io/raf-worker.ts). Runs a
 * private instance of the engine's WASM module, instantiated from the
 * module the main thread compiled, and only calls its pure decode
 * functions: no engine, no GPU.
 */

import {
  initSync,
  rafAutoWhiteBalance,
  rafDevelopDefaults,
  rafDevelopProfiles,
  rafPrepare,
  rafRenderBand,
  rafRenderBinnedLinear,
  rafRenderLinearBand,
  type RafRenderedBand,
} from '@lopsy/engine-pkg/lopsy_wasm';
import type { RafBandPixels, RafWorkerRequest, RafWorkerResponse } from './raf-worker-protocol';

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

function autoWbRatio(binned: RafBandPixels | null): [number, number, number] | null {
  if (!binned) return null;
  const [r = 1, g = 1, b = 1] = rafAutoWhiteBalance(binned.pixels);
  return [r, g, b];
}

function handle(req: RafWorkerRequest): void {
  if (req.kind === 'init') {
    initSync({ module: req.module });
    return;
  }
  if (req.kind === 'prepare') {
    const prepared = rafPrepare(req.data);
    try {
      const paramsJson = prepared.paramsJson;
      const mosaic = prepared.takeMosaic();
      const binned = req.binnedLongEdge === null ? null : takeBand(rafRenderBinnedLinear(mosaic, paramsJson, req.binnedLongEdge));
      const transfer: Transferable[] = [mosaic.buffer];
      if (binned) transfer.push(binned.pixels.buffer);
      reply(
        {
          kind: 'prepared',
          metaJson: prepared.metaJson,
          paramsJson,
          developDefaultsJson: rafDevelopDefaults(paramsJson),
          mosaic,
          binned,
          autoWbRatio: autoWbRatio(binned),
          profilesJson: rafDevelopProfiles(paramsJson),
        },
        transfer,
      );
    } finally {
      prepared.free();
    }
    return;
  }
  const render = req.linear ? rafRenderLinearBand : rafRenderBand;
  const band = takeBand(render(req.src, req.paramsJson, req.y0, req.y1, req.srcY0, req.srcY1));
  reply({ kind: 'band', index: req.index, ...band }, [band.pixels.buffer]);
}

self.onmessage = (e: MessageEvent<RafWorkerRequest>) => {
  try {
    handle(e.data);
  } catch (err) {
    reply({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
