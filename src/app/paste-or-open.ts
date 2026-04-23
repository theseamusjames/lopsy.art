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

  // Generate a layer ID up front so the WASM decoder can upload directly to it
  const layerId = crypto.randomUUID();

  const result = await decodeImageBlob(blob, layerId);

  if (store.documentReady && !forceNewDocument) {
    // Add as a new layer
    if (result.gpuUploaded) {
      store.pasteGpuLayer(layerId, result.width, result.height);
    } else if (result.imageData) {
      store.pasteImageData(result.imageData);
    }
  } else {
    // No document — open as a new document
    if (result.gpuUploaded) {
      // WASM already uploaded pixels; create document around the existing texture.
      // We open via openImageAsDocument with a dummy ImageData to set up the
      // document model, then the engine-sync will pick up the already-uploaded texture.
      // openImageAsDocument will create its own layer id and upload, but since the
      // WASM path already put pixels on layerId, we need a different approach.
      // Instead, use pasteGpuLayer after creating a blank document.
      store.createDocument(result.width, result.height, true);
      // Remove the default background layer and replace with our decoded layer
      const bgLayerId = useEditorStore.getState().document.layerOrder[0];
      if (bgLayerId) store.removeLayer(bgLayerId);
      store.pasteGpuLayer(layerId, result.width, result.height);
      // Clear undo stack and set name since this is a fresh open, not a user edit
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
