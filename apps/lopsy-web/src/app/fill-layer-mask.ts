import type { Color } from '../types';
import { useEditorStore } from './editor-store';
import { useUIStore } from './ui-store';
import { scheduleMaskDataRefresh } from './mask-data-sync';
import { getEngine } from '../engine-wasm/engine-state';
import { uploadLayerMaskIfChanged } from '../engine-wasm/engine-sync';
import { fillMaskWithValue, setSelectionMask } from '../engine-wasm/wasm-bridge';
import { maskValueForColor } from '../layers/mask-fill';

/**
 * In layer-mask edit mode, Edit → Fill and Delete write the active layer's
 * (or group's) mask instead of its pixels (#1034). The GPU mask is filled
 * within the selection, or entirely without one. Returns false when mask
 * edit mode is off or the active layer has no mask, so the caller falls
 * back to its pixel path.
 */
export function fillActiveLayerMask(color: Pick<Color, 'r' | 'g' | 'b'>, label: string): boolean {
  if (useUIStore.getState().maskMode !== 'layerMask') return false;
  const editor = useEditorStore.getState();
  const activeId = editor.document.activeLayerId;
  if (!activeId) return false;
  const layer = editor.document.layers.find((l) => l.id === activeId);
  if (!layer?.mask) return false;
  const engine = getEngine();
  if (!engine) return true;

  // The engine's selection texture only updates on the next frame; a
  // selection made this frame must constrain the fill now.
  const sel = editor.selection;
  if (sel.active && sel.mask) {
    const bytes = new Uint8Array(sel.mask.buffer, sel.mask.byteOffset, sel.mask.byteLength);
    setSelectionMask(engine, bytes, sel.maskWidth, sel.maskHeight);
  }

  editor.pushHistory(label);
  // Skip the upload when the engine already holds this mask array: the
  // GPU copy is current or newer than `mask.data` (#780).
  uploadLayerMaskIfChanged(engine, activeId, layer.mask.data, layer.mask.width, layer.mask.height);
  fillMaskWithValue(engine, activeId, maskValueForColor(color));
  scheduleMaskDataRefresh(activeId);
  editor.notifyRender();
  return true;
}
