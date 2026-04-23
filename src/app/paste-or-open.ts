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
import { seedBitmapFromBlob } from '../engine/bitmap-cache';
import { decodeImageBlob } from './decode-image';

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
    } else if (result.imageData) {
      store.pasteImageData(result.imageData);
    }
  } else {
    const layerId = crypto.randomUUID();
    const result = await decodeImageBlob(blob, layerId);
    if (result.gpuUploaded) {
      store.createDocument(result.width, result.height, true);
      const bgLayerId = useEditorStore.getState().document.layerOrder[0];
      if (bgLayerId) store.removeLayer(bgLayerId);
      store.pasteGpuLayer(layerId, result.width, result.height);
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
