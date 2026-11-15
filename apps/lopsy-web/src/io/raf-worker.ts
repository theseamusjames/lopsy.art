/// <reference lib="webworker" />

/**
 * RAF decode worker. Runs a private instance of the engine's WASM module
 * (instantiated from the module the main thread compiled) and only calls
 * its pure decode functions — no engine, no GPU.
 */

import { initSync, rafPrepare, rafRenderBand } from '../engine-wasm/pkg/lopsy_wasm';
import type { RafWorkerRequest, RafWorkerResponse } from './raf-worker-protocol';

declare const self: DedicatedWorkerGlobalScope;

function reply(message: RafWorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

function handle(req: RafWorkerRequest): void {
  if (req.kind === 'init') {
    initSync({ module: req.module });
    return;
  }
  if (req.kind === 'prepare') {
    const prepared = rafPrepare(req.data);
    try {
      const mosaic = prepared.takeMosaic();
      reply(
        { kind: 'prepared', metaJson: prepared.metaJson, paramsJson: prepared.paramsJson, mosaic },
        [mosaic.buffer],
      );
    } finally {
      prepared.free();
    }
    return;
  }
  const band = rafRenderBand(req.src, req.paramsJson, req.y0, req.y1, req.srcY0, req.srcY1);
  try {
    const pixels = band.takePixels();
    reply(
      { kind: 'band', index: req.index, x: band.x, y: band.y, width: band.width, height: band.height, pixels },
      [pixels.buffer],
    );
  } finally {
    band.free();
  }
}

self.onmessage = (e: MessageEvent<RafWorkerRequest>) => {
  try {
    handle(e.data);
  } catch (err) {
    reply({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
