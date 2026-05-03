/**
 * Quick Mask Mode operations — enter/exit logic.
 *
 * Entering: copies the active selection mask to a GPU-side quick mask texture.
 * If no selection, starts with a fully-unselected (all-zero) texture.
 *
 * Exiting: reads back the quick mask texture from the GPU, converts to a
 * selection mask, and applies it.
 */

import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  enterQuickMaskMode as gpuEnterQuickMaskMode,
  exitQuickMaskMode as gpuExitQuickMaskMode,
  selectionBounds as wasmSelectionBounds,
} from '../../engine-wasm/wasm-bridge';

export function enterQuickMaskMode(): void {
  const editorState = useEditorStore.getState();

  // Clear the selection so only the mask overlay is active
  editorState.clearSelection();

  const engine = getEngine();
  if (engine) {
    gpuEnterQuickMaskMode(engine);
  }

  useUIStore.getState().toggleQuickMaskMode();
  editorState.notifyRender();
}

export function exitQuickMaskMode(): void {
  const editorState = useEditorStore.getState();
  const doc = editorState.document;

  const engine = getEngine();
  if (engine) {
    const maskData = gpuExitQuickMaskMode(engine);
    if (maskData && maskData.length > 0) {
      const bounds = wasmSelectionBounds(new Uint8Array(maskData), doc.width, doc.height);
      if (bounds.length === 4) {
        const bx = bounds[0]!;
        const by = bounds[1]!;
        const bw = bounds[2]!;
        const bh = bounds[3]!;
        editorState.setSelection(
          { x: bx, y: by, width: bw, height: bh },
          new Uint8ClampedArray(maskData),
          doc.width,
          doc.height,
        );
      } else {
        editorState.clearSelection();
      }
    } else {
      editorState.clearSelection();
    }
  }

  useUIStore.getState().toggleQuickMaskMode();
  editorState.notifyRender();
}

export function toggleQuickMaskMode(): void {
  const isActive = useUIStore.getState().isQuickMaskMode;
  if (isActive) {
    exitQuickMaskMode();
  } else {
    enterQuickMaskMode();
  }
}
