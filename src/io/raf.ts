/**
 * RAF (Fujifilm RAW) image import. The decode runs on a pool of Web Workers
 * (see raf-decode.ts) and each finished band is uploaded straight into the
 * layer's GPU texture, so the full-size float image never exists in one
 * piece on the main thread.
 *
 * Supports uncompressed and lossless-compressed RAF.
 */

import { useEditorStore } from '../app/editor-store';
import { useUIStore } from '../app/ui-store';
import { getEngine } from '../engine-wasm/engine-state';
import { initWasm, uploadLayerPixelsF32Rect } from '../engine-wasm/wasm-bridge';
import { resetTrackedState } from '../engine-wasm/engine-sync';
import { pixelDataManager } from '../engine/pixel-data-manager';
import { notifyError } from '../app/notifications-store';
import { decodeRafInWorkers } from './raf-decode';

export async function importRafFile(data: Uint8Array, name: string): Promise<void> {
  const ui = useUIStore.getState();
  ui.openModal({ kind: 'loading', message: 'Opening RAF…' });

  try {
    await importRafFileInner(data, name);
  } finally {
    useUIStore.getState().closeModalOfKind('loading');
  }
}

async function importRafFileInner(data: Uint8Array, name: string): Promise<void> {
  await initWasm();

  useEditorStore.getState().createDocument(1, 1, true);

  const engine = await waitForEngine();
  if (!engine) {
    notifyError('Engine not ready');
    return;
  }

  const activeLayerId = useEditorStore.getState().document.activeLayerId;
  if (!activeLayerId) {
    notifyError('No active layer');
    return;
  }

  // Yield a frame so the render loop syncs the new 1x1 document before the
  // decode starts uploading into its layer texture.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  // The decode uploads straight into the GPU texture. Drop the 1x1
  // placeholder pixels first so engine-sync treats the texture as the
  // source of truth and never re-uploads the placeholder over it.
  pixelDataManager.remove(activeLayerId);

  const meta = await decodeRafInWorkers(data, (full, band) => {
    uploadLayerPixelsF32Rect(
      engine, activeLayerId, full.width, full.height,
      band.x, band.y, band.width, band.height, band.pixels,
    );
  });

  if (meta.width === 0 || meta.height === 0) {
    notifyError('RAF decode returned empty image');
    return;
  }

  useEditorStore.setState((s) => {
    const layers = s.document.layers.map((l) => {
      if (l.id === activeLayerId && l.type === 'raster') {
        return { ...l, width: meta.width, height: meta.height, name };
      }
      return l;
    });
    return {
      document: { ...s.document, width: meta.width, height: meta.height, layers, name },
    };
  });

  // No default adjustments — the Rust decoder produces the final "look"
  // (exposure, saturation, highlight rolloff baked in). Skipping this
  // leaves the document with a clean adjustments panel like any other
  // image, so users can start their own edits from a true baseline.

  // The texture changed without touching the JS cache, so tell its
  // subscribers (the layer thumbnail) to read it back.
  pixelDataManager.bumpVersion(activeLayerId);

  resetTrackedState(engine);
  useEditorStore.getState().fitToView();
}

async function waitForEngine(maxFrames = 60): Promise<ReturnType<typeof getEngine>> {
  for (let i = 0; i < maxFrames; i++) {
    const engine = getEngine();
    if (engine) return engine;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  return getEngine();
}

