/**
 * RAF (Fujifilm RAW) image import — decodes RAF files via the Rust-side
 * decoder and uploads pixel data to the GPU.
 *
 * The pipeline mirrors the DNG import path: WASM decodes + uploads, then JS
 * sets up the document model and applies default raw adjustments.
 *
 * Currently supports uncompressed RAF only. Compressed RAF files (the default
 * on most Fujifilm cameras) will show a clear error asking the user to set
 * their camera to "Uncompressed" or convert to DNG.
 */

import { useEditorStore } from '../app/editor-store';
import { useUIStore } from '../app/ui-store';
import { getEngine } from '../engine-wasm/engine-state';
import { decodeAndUploadRaf, initWasm } from '../engine-wasm/wasm-bridge';
import { resetTrackedState } from '../engine-wasm/engine-sync';
import { pixelDataManager } from '../engine/pixel-data-manager';
import { notifyError } from '../app/notifications-store';

interface RafMeta {
  width: number;
  height: number;
}

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

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const metaJson = decodeAndUploadRaf(engine, activeLayerId, data);
  const meta: RafMeta = JSON.parse(metaJson);

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

  pixelDataManager.remove(activeLayerId);

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

