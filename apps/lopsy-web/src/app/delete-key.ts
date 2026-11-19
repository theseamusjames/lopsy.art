import { useEditorStore } from './editor-store';
import { useToolSettingsStore } from './tool-settings-store';
import { clearJsPixelData } from './store/clear-js-pixel-data';
import { fillActiveLayerMask } from './fill-layer-mask';
import { commitLiveFloat } from './interactions/live-float';
import { isUnmovedPrefloat, commitUnmovedPrefloat } from './interactions/prefloat';
import { getEngine } from '../engine-wasm/engine-state';
import { clearSelectedPixels, hasFloat, setSelectionMask } from '../engine-wasm/wasm-bridge';

/**
 * Delete in layer-mask edit mode: fills the active layer's mask with the
 * background colour, like Photoshop, instead of clearing pixels or deleting
 * the layer (#1034). False when mask edit mode is off or the active layer
 * has no mask.
 */
export function clearActiveLayerMask(): boolean {
  return fillActiveLayerMask(useToolSettingsStore.getState().backgroundColor, 'Mask Clear');
}

/**
 * Delete with a pixel selection: clears the selected pixels of `activeId`
 * ("Clear Selection"). `selectionMask` is the selection's mask when the key
 * was pressed. Returns whether it cleared.
 */
export function clearSelectedLayerPixels(activeId: string, selectionMask: Uint8ClampedArray): boolean {
  const editor = useEditorStore.getState();
  const engine = getEngine();
  if (!engine) return false;

  // Commit any active transform/move float before clearing. The selection
  // on screen is kept — the moved marquee, or the outline a pending
  // transform has carried the pixels to. Rebuilding it from the active
  // layer's alpha cleared every pixel on the layer (#801).
  // A ⌘-click prefloat that hasn't moved already matches the selection;
  // rebuilding from the active layer's alpha would clear all of it (#1055).
  if (isUnmovedPrefloat(selectionMask)) {
    commitUnmovedPrefloat();
  } else if (hasFloat(engine)) {
    commitLiveFloat();
  }

  // Re-read selection after potential mask rebuild
  const selNow = useEditorStore.getState().selection;
  if (!selNow.active || !selNow.mask) return false;

  // Force-sync the current selection mask to the GPU before clearing.
  // The GPU mask is otherwise only updated on the next render frame, so a
  // selection that was just nudged with the arrow keys (or floated) would
  // clear using a stale mask — clearing the original area instead of the
  // moved one.
  const maskBytes = new Uint8Array(selNow.mask.buffer, selNow.mask.byteOffset, selNow.mask.byteLength);
  setSelectionMask(engine, maskBytes, selNow.maskWidth, selNow.maskHeight);

  editor.pushHistory('Clear Selection');
  // Clear only — clipboardCut would also re-copy into the retained
  // internal clipboard as a side effect, clobbering a paste-in-place
  // copy made earlier with ⌘C/⌘X (see #870).
  clearSelectedPixels(engine, activeId, true);
  clearJsPixelData(activeId);
  editor.notifyRender();
  return true;
}

/**
 * The Delete/Backspace key outside text editing: in layer-mask edit mode it
 * clears the mask, with a pixel selection it clears the selected pixels,
 * and otherwise it removes the active layer ("Delete Layer"). Neither clear
 * checks the layer lock or the layer type.
 */
export function handleDeleteKey(): void {
  const editor = useEditorStore.getState();
  const sel = editor.selection;
  const activeId = editor.document.activeLayerId;
  if (!activeId) return;

  if (clearActiveLayerMask()) return;

  if (sel.active && sel.mask) {
    clearSelectedLayerPixels(activeId, sel.mask);
  } else {
    editor.removeLayer(activeId);
  }
}
