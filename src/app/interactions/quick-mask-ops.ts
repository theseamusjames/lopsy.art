/**
 * Quick Mask Mode operations — enter/exit logic.
 *
 * Entering: copies the active selection mask to a GPU-side quick mask texture.
 * If no selection, starts with a fully-unselected (all-zero) texture.
 *
 * Exiting: reads back the quick mask texture from the GPU, converts to a
 * selection mask, and applies it when the read answers.
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

/**
 * Leave Quick Mask mode. The mode ends at once; the selection the mask
 * painted is installed when the engine has read it, unless a selection was
 * made in the meantime.
 */
export async function exitQuickMaskMode(): Promise<void> {
  const editorState = useEditorStore.getState();
  const { width, height } = editorState.document;
  const engine = getEngine();
  const reading = engine ? gpuExitQuickMaskMode(engine) : null;

  useUIStore.getState().toggleQuickMaskMode();
  editorState.notifyRender();
  if (!reading) return;

  const selectionAtExit = editorState.selection.mask;
  const maskData = await reading.catch(() => undefined);
  const editor = useEditorStore.getState();
  if (editor.selection.mask !== selectionAtExit) return;
  const bounds = maskData && maskData.length > 0
    ? wasmSelectionBounds(new Uint8Array(maskData), width, height)
    : null;
  if (maskData && bounds && bounds.length === 4) {
    editor.setSelection(
      { x: bounds[0]!, y: bounds[1]!, width: bounds[2]!, height: bounds[3]! },
      new Uint8ClampedArray(maskData),
      width,
      height,
    );
  } else {
    editor.clearSelection();
  }
  editor.notifyRender();
}

export function toggleQuickMaskMode(): void {
  const isActive = useUIStore.getState().maskMode === 'quickMask';
  if (isActive) {
    void exitQuickMaskMode();
  } else {
    enterQuickMaskMode();
  }
}
