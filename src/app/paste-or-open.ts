/**
 * Shared logic for pasting/dropping an image blob into the editor.
 *
 * - If a document is open, adds the image as a new layer.
 * - If no document is open, opens the image as a new document.
 *
 * Uses the WASM PNG decoder for 16-bit precision when available,
 * with a canvas 2D fallback for other formats.
 */
import { useEditorStore } from './editor-store';
import { useUIStore } from './ui-store';
import { seedBitmapFromBlob } from '../engine/bitmap-cache';
import { decodeImageBlob } from './decode-image';
import { selectLayerAlpha } from '../panels/LayerPanel/layer-selection';
import { flushLayerSync } from '../engine-wasm/engine-sync';
import { getEngine } from '../engine-wasm/engine-state';
import { scaleLayerTexture } from '../engine-wasm/wasm-bridge';
import { computeFit } from '../tools/move/move';
import type { Layer } from '../types';

function fitPastedLayerIfOversized(): void {
  const state = useEditorStore.getState();
  const { document: doc } = state;
  const pastedId = doc.activeLayerId;
  if (!pastedId) return;
  const pasted = doc.layers.find((l) => l.id === pastedId);
  if (!pasted || pasted.type !== 'raster') return;
  if (pasted.width <= doc.width && pasted.height <= doc.height) return;

  const engine = getEngine();
  if (!engine) return;

  const fit = computeFit(pasted.width, pasted.height, doc.width, doc.height);
  scaleLayerTexture(engine, pastedId, fit.width, fit.height);
  useEditorStore.setState((s) => ({
    document: {
      ...s.document,
      layers: s.document.layers.map((l): Layer =>
        l.id === pastedId && l.type === 'raster'
          ? { ...l, x: fit.x, y: fit.y, width: fit.width, height: fit.height }
          : l,
      ),
    },
    renderVersion: s.renderVersion + 1,
  }));
  flushLayerSync(useEditorStore.getState());
}

/**
 * Paste the internal clipboard in place and select what landed, the same way
 * an external paste does (#347): the pasted pixels become the selection and
 * the Move tool is activated, so the transform handles sit on the paste and
 * respond straight away. Without this the paste had no selection of its own —
 * at best the copy's marquee carried over — and a handle drag moved it instead.
 */
export function pasteInternalClipboard(): void {
  const pastedId = useEditorStore.getState().paste();
  if (!pastedId) return;
  useUIStore.getState().setActiveTool('move');
  // Register the new layer with the engine now instead of on the next frame,
  // so the selection is in place before any key that follows the paste.
  flushLayerSync(useEditorStore.getState());
  // No prefloat: it would grow the layer to the document at (0, 0), and a
  // paste in place keeps the copied size and offset. The first drag floats.
  selectLayerAlpha(pastedId, { prefloat: false });
}

export async function pasteOrOpenBlob(blob: Blob, fallbackName: string, forceNewDocument = false): Promise<void> {
  const store = useEditorStore.getState();

  if (forceNewDocument && store.documentReady) {
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;
    bitmap.close();
    store.createDocument(width, height, true);
    const bgLayerId = useEditorStore.getState().document.layerOrder[0];
    if (bgLayerId) store.removeLayer(bgLayerId);
    const layerId = crypto.randomUUID();
    const result = await decodeImageBlob(blob, layerId);
    if (result.gpuUploaded) {
      store.pasteGpuLayer(layerId, result.width, result.height);
      flushLayerSync(useEditorStore.getState());
    } else if (result.imageData) {
      store.pasteImageData(result.imageData);
    }
    const doc = useEditorStore.getState().document;
    useEditorStore.setState({
      undoStack: [],
      redoStack: [],
      isDirty: false,
      document: { ...doc, name: fallbackName },
    });
    useEditorStore.getState().fitToView();
  } else if (store.documentReady) {
    const layerId = crypto.randomUUID();
    const result = await decodeImageBlob(blob, layerId);
    if (result.gpuUploaded) {
      store.pasteGpuLayer(layerId, result.width, result.height);
      flushLayerSync(useEditorStore.getState());
    } else if (result.imageData) {
      store.pasteImageData(result.imageData);
    }

    // Issue #347 / #697: after a paste, put the user directly in Move so
    // the transform handles rendered by selectLayerAlpha respond to clicks
    // (transform-handlers.ts gates on activeTool === 'move').
    useUIStore.getState().setActiveTool('move');

    // Issue #697: a pasted image larger than the canvas gets a selection
    // clipped to the visible canvas — the transform handles only cover
    // that visible portion, so resizing the whole paste is impossible and
    // the off-canvas pixels are silently dropped by the first float.
    // Shrink oversized pastes to fit the canvas so the entire image is on
    // the artboard and every transform (resize, move) works normally.
    fitPastedLayerIfOversized();

    // Issue #347: select the pasted content so the user can immediately
    // transform it (resize, fit, etc.) via the move/transform tools.
    // Defer to the next frame so engine-sync registers the new layer
    // descriptor before selectLayerAlpha tries to float it.
    const pastedId = useEditorStore.getState().document.activeLayerId;
    if (pastedId) {
      requestAnimationFrame(() => selectLayerAlpha(pastedId));
    }
  } else {
    const layerId = crypto.randomUUID();
    const result = await decodeImageBlob(blob, layerId);
    if (result.gpuUploaded) {
      store.createDocument(result.width, result.height, true);
      const bgLayerId = useEditorStore.getState().document.layerOrder[0];
      if (bgLayerId) store.removeLayer(bgLayerId);
      store.pasteGpuLayer(layerId, result.width, result.height);
      flushLayerSync(useEditorStore.getState());
      const doc = useEditorStore.getState().document;
      useEditorStore.setState({
        undoStack: [],
        redoStack: [],
        isDirty: false,
        document: { ...doc, name: fallbackName },
      });
    } else if (result.imageData) {
      store.openImageAsDocument(result.imageData, fallbackName);
    }
  }

  // Seed bitmap cache for efficient thumbnail rendering
  const activeLayerId = useEditorStore.getState().document.activeLayerId;
  if (activeLayerId) seedBitmapFromBlob(activeLayerId, blob);
}
